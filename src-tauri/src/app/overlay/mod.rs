//! Overlay controller: feeds inputs to `phase::step` and carries out the effects. The lock is
//! never held across a window call: activation can dispatch window messages synchronously
//! and re-enter `on_focus` (spike rule).

pub mod events;
pub mod phase;
pub mod placement;
pub mod result;

use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

use self::events::{Calibrations, MonitorInfo, OverlayActivating, OverlaySettings, Start};
use self::phase::{Effect, Input, State};
use self::placement::Placement;
use self::result::MeasurementResult;
use super::timers::Timers;
use super::windows::{HUD, MAIN, OVERLAY};
use crate::config::{Calibration, ConfigStore, MonitorKey, Point, StoreError};
use crate::logging;
use crate::platform::win::focus::{self, Foreground, ForeignHwnd, OwnHwnd};
use crate::platform::win::{dialog, raw_input, webview, window_style};
use crate::preset::Preset;

const FOCUS_RETRY_DELAY: Duration = Duration::from_millis(30);
const CLICK_TO_START_TIMEOUT: Duration = Duration::from_secs(3);
/// Upper bound for the UI to report that every key is released.
const EXIT_TIMEOUT: Duration = Duration::from_millis(1000);
const BLANK_TIMEOUT: Duration = Duration::from_millis(150);

#[derive(Default)]
struct Inner {
    state: State,
    /// The window that was active before the hotkey; handed focus back once, then dropped.
    foreground: Option<ForeignHwnd>,
    placement: Option<Placement>,
    pressed_at: Option<Instant>,
    /// Opened from the tray menu: the window in front is the menu's own, nothing to hand back.
    from_tray: bool,
    /// Submitted by the UI while blanking; shown in the HUD once the overlay is hidden.
    result: Option<MeasurementResult>,
    /// The route was parked for this zoom: the HUD says how to continue instead of a result.
    route_kept_for: Option<Preset>,
}

#[derive(Default)]
pub struct Overlay(Mutex<Inner>);

impl Overlay {
    fn lock(&self) -> MutexGuard<'_, Inner> {
        self.0.lock().unwrap_or_else(|e| e.into_inner())
    }
}

#[derive(Debug)]
pub enum OverlayError {
    /// An older session, or the overlay is not in the phase the command belongs to.
    Stale,
    /// The scale would be dropped on the next load (e.g. a viewport out of range).
    Invalid,
    Store(StoreError),
}

fn window(app: &AppHandle) -> Option<(WebviewWindow, OwnHwnd)> {
    let win = app.get_webview_window(OVERLAY)?;
    let hwnd = OwnHwnd::of(&win)?;
    Some((win, hwnd))
}

/// Runs one input through the phase machine; true if it was accepted.
fn dispatch(app: &AppHandle, input: Input) -> bool {
    let outcome = {
        let overlay = app.state::<Overlay>();
        let mut inner = overlay.lock();
        let outcome = phase::step(&inner.state, input);
        inner.state = outcome.state.clone();
        outcome
    };
    for effect in outcome.effects {
        run(app, effect);
    }
    outcome.accepted
}

fn later(app: &AppHandle, delay: Duration, input: Input) {
    let handle = app.clone();
    app.state::<Timers>().schedule(delay, move || {
        let inner = handle.clone();
        let _ = handle.run_on_main_thread(move || {
            dispatch(&inner, input);
        });
    });
}

fn emit<T: serde::Serialize + Clone>(app: &AppHandle, event: &str, payload: T) {
    if let Err(err) = app.emit_to(OVERLAY, event, payload) {
        logging::error("overlay", format!("{event} not delivered: {err}"));
    }
}

fn run(app: &AppHandle, effect: Effect) {
    match effect {
        Effect::HideHud => super::hud::hide(app),
        Effect::Show { seq, preset } => show(app, seq, preset),
        Effect::TryFocus { seq, attempt } => {
            let ok = window(app).is_some_and(|(_, hwnd)| focus::try_activate(hwnd));
            dispatch(app, Input::FocusResult { seq, attempt, ok });
        }
        Effect::RetryFocusLater { seq, attempt } => later(app, FOCUS_RETRY_DELAY, Input::FocusRetry { seq, attempt }),
        Effect::Activated { seq, ok, attempts } => activated(app, seq, ok, attempts),
        Effect::ClickTimeoutLater { seq } => later(app, CLICK_TO_START_TIMEOUT, Input::ClickTimeout { seq }),
        Effect::Focused { seq } => emit(app, events::FOCUSED, events::Seq { seq }),
        Effect::SwitchPreset { seq, preset } => {
            logging::info("overlay", format!("#{seq}: {} hotkey while measuring: parking the route", preset.as_str()));
            emit(app, events::PRESET, events::PresetSwitch { seq, preset });
        }
        Effect::RequestExit { seq } => emit(app, events::EXIT_REQUEST, events::Seq { seq }),
        Effect::ExitTimeoutLater { seq } => later(app, EXIT_TIMEOUT, Input::ExitTimeout { seq }),
        Effect::ClickThrough => {
            if let Some((win, hwnd)) = window(app) {
                let _ = win.set_ignore_cursor_events(true);
                window_style::set_tool_window(hwnd);
            }
        }
        Effect::RestoreForeground => {
            // Out of the lock first: SetForegroundWindow sends focus messages synchronously.
            let foreground = app.state::<Overlay>().lock().foreground.take();
            let restored = foreground.is_some_and(ForeignHwnd::restore);
            logging::info("overlay", format!("focus given back: {restored}"));
        }
        Effect::ForgetForeground => drop(app.state::<Overlay>().lock().foreground.take()),
        Effect::RequestBlank { blank_seq, reason } => {
            emit(app, events::BLANK_REQUEST, events::BlankRequest { seq: blank_seq, reason });
        }
        Effect::BlankTimeoutLater { blank_seq } => later(app, BLANK_TIMEOUT, Input::Blanked { blank_seq }),
        Effect::Hide { hud } => hide(app, hud),
        Effect::ExitApp => super::exit_now(app),
    }
}

fn own_windows(app: &AppHandle) -> Vec<OwnHwnd> {
    [MAIN, OVERLAY, HUD].iter().filter_map(|label| OwnHwnd::of(&app.get_webview_window(label)?)).collect()
}

fn show(app: &AppHandle, seq: u64, preset: Preset) {
    // C-6 self-check before every activation: raw input must still be unregistered.
    if let Err(err) = raw_input::ensure_none() {
        dialog::fatal(&format!("Mapper stopped: {err}"));
        std::process::exit(2);
    }
    let Some((win, hwnd)) = window(app) else {
        logging::error("overlay", "the overlay window is gone");
        return shown(app, seq, false);
    };
    let config = app.state::<ConfigStore>().get();
    let (previous, from_tray) = {
        let overlay = app.state::<Overlay>();
        let inner = overlay.lock();
        (inner.placement.clone(), inner.from_tray)
    };
    let Some(placement) = placement::place(app, &win, &config.monitor, previous.as_ref()) else {
        return shown(app, seq, false);
    };
    let foreground = match focus::capture_foreground(&own_windows(app)) {
        Foreground::Foreign(other) if !from_tray => Some(other),
        Foreground::Foreign(_) | Foreground::None | Foreground::Own(_) => None,
    };
    let payload = activating(seq, preset, &placement, &config);
    {
        let overlay = app.state::<Overlay>();
        let mut inner = overlay.lock();
        inner.foreground = foreground;
        inner.placement = Some(placement);
        inner.result = None;
        inner.route_kept_for = None;
    }
    let _ = win.set_ignore_cursor_events(false);
    let _ = win.set_always_on_top(true);
    window_style::set_tool_window(hwnd);
    webview::set_idle(&win, false);
    logging::info("overlay", format!("activate #{seq}: {}, {:?}", preset.as_str(), payload.start));
    emit(app, events::ACTIVATING, payload);
    let _ = win.show();
    window_style::set_tool_window(hwnd);
    shown(app, seq, true);
}

fn shown(app: &AppHandle, seq: u64, ok: bool) {
    dispatch(app, Input::Shown { seq, ok });
}

fn activating(seq: u64, preset: Preset, p: &Placement, config: &crate::config::Config) -> OverlayActivating {
    let fitting = |preset| {
        config.calibration(&p.key, preset).filter(|c| c.fits(p.viewport.w, p.viewport.h, p.viewport.scale)).cloned()
    };
    let calibrations = Calibrations { near: fitting(Preset::Near), far: fitting(Preset::Far) };
    let start = if calibrations_for(&calibrations, preset).is_some() { Start::Measure } else { Start::Calibrate };
    OverlayActivating {
        seq,
        preset,
        start,
        viewport: p.viewport,
        monitor: MonitorInfo { key: p.key.to_string(), label: p.key.label() },
        calibrations,
        settings: OverlaySettings {
            language: config.language,
            panel_opacity: config.panel_opacity,
            speeds: config.speeds,
            hotkeys: config.hotkeys.clone(),
        },
    }
}

fn calibrations_for(c: &Calibrations, preset: Preset) -> Option<&Calibration> {
    match preset {
        Preset::Near => c.near.as_ref(),
        Preset::Far => c.far.as_ref(),
    }
}

fn activated(app: &AppHandle, seq: u64, ok: bool, attempts: u32) {
    let ms = app.state::<Overlay>().lock().pressed_at.map_or(0.0, |t| t.elapsed().as_secs_f64() * 1000.0);
    let outcome = if ok { "focus OK" } else { "focus NOT taken, waiting for a click" };
    logging::info("overlay", format!("activate #{seq}: {outcome} after {attempts} attempt(s), {ms:.1} ms"));
    emit(app, events::ACTIVATED, events::Activated { seq, ok, attempts, ms });
}

fn hide(app: &AppHandle, hud: bool) {
    let (result, route_kept_for, placement) = {
        let overlay = app.state::<Overlay>();
        let mut inner = overlay.lock();
        (inner.result.take(), inner.route_kept_for.take(), inner.placement.clone())
    };
    if let Some((win, _)) = window(app) {
        let _ = win.hide();
        webview::set_idle(&win, true);
    }
    if !hud {
        return;
    }
    if let Some(to) = route_kept_for {
        super::hud::show_route_kept(app, to, placement.as_ref());
    } else if let Some(result) = result {
        super::hud::show_result(app, result, placement.as_ref());
    }
}

// ------------------------------------------------------------------ entry points

/// A measure hotkey. Main thread.
pub fn on_hotkey(app: &AppHandle, preset: Preset, pressed_at: Instant) {
    press(app, preset, pressed_at, false);
}

/// The tray's measure item, the fallback for a hotkey another program has taken.
pub fn on_tray(app: &AppHandle, preset: Preset) {
    press(app, preset, Instant::now(), true);
}

fn press(app: &AppHandle, preset: Preset, pressed_at: Instant, from_tray: bool) {
    {
        let overlay = app.state::<Overlay>();
        let mut inner = overlay.lock();
        if inner.state.phase == phase::Phase::Hidden {
            inner.pressed_at = Some(pressed_at);
            inner.from_tray = from_tray;
        }
    }
    if !dispatch(app, Input::Hotkey(preset)) {
        logging::info("overlay", format!("{} hotkey ignored in this phase", preset.as_str()));
    }
}

pub fn on_focus(app: &AppHandle, focused: bool) {
    dispatch(app, Input::WindowFocus(focused));
}

/// `overlay_exit`: every key is released, focus may go back to the game. `route_kept`: the
/// UI parked the route for the other zoom (its hotkey was pressed).
pub fn exit(app: &AppHandle, seq: u64, route_kept: bool) -> Result<(), OverlayError> {
    let accepted = dispatch(app, Input::Exit { seq });
    let overlay = app.state::<Overlay>();
    let mut inner = overlay.lock();
    // Late, after the exit timeout closed the session: the HUD still says the route is kept.
    if !accepted && !inner.state.closing(seq) {
        return Err(OverlayError::Stale);
    }
    if route_kept {
        inner.route_kept_for = Some(inner.state.preset.other());
    }
    Ok(())
}

/// `overlay_blank`: the UI painted an empty frame.
pub fn blanked(app: &AppHandle, blank_seq: u64) -> Result<(), OverlayError> {
    dispatch(app, Input::Blanked { blank_seq }).then_some(()).ok_or(OverlayError::Stale)
}

pub fn submit_result(app: &AppHandle, seq: u64, result: MeasurementResult) -> Result<(), OverlayError> {
    let placement = {
        let overlay = app.state::<Overlay>();
        let mut inner = overlay.lock();
        if !inner.state.may_save(seq) {
            return Err(OverlayError::Stale);
        }
        if inner.state.phase != phase::Phase::Hidden {
            inner.result = Some(result);
            return Ok(());
        }
        if inner.state.quitting {
            return Ok(());
        }
        inner.placement.clone()
    };
    // The blank timeout came first and the overlay is hidden already: show the result now.
    super::hud::show_result(app, result, placement.as_ref());
    Ok(())
}

/// Monitor, size and scale come from the session, never from the UI.
pub fn save_calibration(app: &AppHandle, seq: u64, preset: Preset, scale: GridInput) -> Result<(), OverlayError> {
    let placement = {
        let overlay = app.state::<Overlay>();
        let inner = overlay.lock();
        if !inner.state.may_save(seq) {
            return Err(OverlayError::Stale);
        }
        inner.placement.clone().ok_or(OverlayError::Stale)?
    };
    let calibration = Calibration {
        cell_meters: scale.cell_meters,
        cell_px: scale.cell_px,
        origin: scale.origin,
        w: placement.viewport.w,
        h: placement.viewport.h,
        scale: placement.viewport.scale,
        created_at: logging::utc_timestamp(std::time::SystemTime::now()),
    };
    // Checked here, not only on load: a scale the next start would drop must not report "saved".
    if !crate::config::validate::is_valid_calibration(&calibration) {
        return Err(OverlayError::Invalid);
    }
    let key: MonitorKey = placement.key;
    let label = key.label();
    app.state::<ConfigStore>()
        .update(|config| config.calibrations.entry(key).or_default().set(preset, Some(calibration)))
        .map_err(OverlayError::Store)?;
    logging::info("overlay", format!("{} scale saved for {label}", preset.as_str()));
    Ok(())
}

/// What the UI decides about a scale; the rest of a `Calibration` is filled in here.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct GridInput {
    pub cell_meters: u32,
    pub cell_px: f64,
    pub origin: Point,
}

/// App exit: an open overlay closes by the normal rules (focus back), then the app exits.
pub fn quit(app: &AppHandle) {
    dispatch(app, Input::Quit);
}
