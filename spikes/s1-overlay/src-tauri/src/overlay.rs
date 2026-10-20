//! Overlay window lifecycle: Hidden → Activating → Active → Deactivating → Hidden.
//!
//! The controller lock is never held across a Win32 or Tauri window call: activation
//! messages can be dispatched synchronously and re-enter `on_window_event`.

use std::sync::{mpsc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, Emitter, Manager, Monitor, PhysicalPosition, PhysicalSize, WebviewWindow, Window,
    WindowEvent,
};

use crate::log;
use crate::platform::win::focus::{self, RawHwnd};
use crate::platform::win::{webview_power, window_style};
use crate::stats::Samples;

pub const OVERLAY: &str = "overlay";
pub const HUD: &str = "hud";

const FOCUS_ATTEMPTS: u32 = 4;
const FOCUS_RETRY_DELAY: Duration = Duration::from_millis(30);
const BLANK_ACK_TIMEOUT: Duration = Duration::from_millis(150);
const CLICK_TO_START_TIMEOUT: Duration = Duration::from_secs(3);
/// Upper bound for the UI to report that every key is released before we hand focus back.
const EXIT_REQUEST_TIMEOUT: Duration = Duration::from_millis(1000);
const HUD_VISIBLE_FOR: Duration = Duration::from_secs(10);
const HUD_TOP_MARGIN: f64 = 24.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Phase {
    Hidden,
    Activating,
    Active,
    Deactivating,
}

/// How the overlay rests between measurements (spike S-2 variants V1..V3).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum HideMode {
    /// V1: ShowWindow(SW_HIDE) after a blank frame.
    Hide,
    /// V2: window stays shown but DWM-cloaked.
    Cloak,
    /// V3: window stays shown, click-through and blank.
    Always,
}

/// Which fixed map zoom the player measures on; each has its own one-time scale.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Preset {
    /// Map zoomed in all the way (short distances).
    Near,
    /// Map zoomed out all the way (long distances).
    Far,
}

impl HideMode {
    pub fn parse(text: &str) -> Option<Self> {
        match text {
            "hide" => Some(Self::Hide),
            "cloak" => Some(Self::Cloak),
            "always" => Some(Self::Always),
            _ => None,
        }
    }
}

pub enum CycleAck {
    Painted(u64, Instant),
    Blanked(u64, Instant),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HudPayload {
    pub title: String,
    pub lines: Vec<String>,
    #[serde(default)]
    pub tone: String,
}

#[derive(Clone, Serialize)]
struct PresetEvent {
    preset: Preset,
}

#[derive(Clone, Serialize)]
struct ActivatingEvent {
    seq: u64,
    mode: HideMode,
    preset: Preset,
    /// Overlay size in CSS pixels; the page may not have seen the resize yet.
    width: f64,
    height: f64,
}

#[derive(Clone, Serialize)]
struct ActivatedEvent {
    seq: u64,
    ok: bool,
    attempts: u32,
    ms: f64,
}

#[derive(Clone, Serialize)]
struct SeqEvent {
    seq: u64,
}

struct Controller {
    phase: Phase,
    mode: HideMode,
    preset: Preset,
    prev_foreground: RawHwnd,
    activation_seq: u64,
    blank_seq: u64,
    pressed_at: Option<Instant>,
    focused: bool,
    monitor_key: Option<(i32, i32, u32, u32)>,
    focus_latency: Samples,
    hud_generation: u64,
    hud_pinned: bool,
    low_memory: bool,
    cycle: Option<mpsc::Sender<CycleAck>>,
}

pub struct Shared(Mutex<Controller>);

impl Default for Shared {
    fn default() -> Self {
        Self(Mutex::new(Controller {
            phase: Phase::Hidden,
            mode: HideMode::Hide,
            preset: Preset::Near,
            prev_foreground: 0,
            activation_seq: 0,
            blank_seq: 0,
            pressed_at: None,
            focused: false,
            monitor_key: None,
            focus_latency: Samples::default(),
            hud_generation: 0,
            hud_pinned: false,
            low_memory: false,
            cycle: None,
        }))
    }
}

fn with<R>(app: &AppHandle, f: impl FnOnce(&mut Controller) -> R) -> R {
    let shared = app.state::<Shared>();
    let mut guard = shared.0.lock().unwrap_or_else(|e| e.into_inner());
    f(&mut guard)
}

fn hwnd_of(win: &WebviewWindow) -> Option<RawHwnd> {
    win.hwnd().ok().map(focus::to_raw)
}

fn overlay(app: &AppHandle) -> Option<(WebviewWindow, RawHwnd)> {
    let win = app.get_webview_window(OVERLAY)?;
    let hwnd = hwnd_of(&win)?;
    Some((win, hwnd))
}

pub fn mode(app: &AppHandle) -> HideMode {
    with(app, |c| c.mode)
}

fn rest_state(app: &AppHandle) -> (HideMode, bool) {
    with(app, |c| (c.mode, c.low_memory))
}

/// S-3 experiment switch: idle WebView2 while the windows are hidden.
pub fn set_low_memory(app: &AppHandle, enabled: bool) {
    with(app, |c| c.low_memory = enabled);
    if !enabled {
        return;
    }
    for label in [OVERLAY, HUD] {
        if let Some(win) = app.get_webview_window(label) {
            webview_power::set_idle(&win, true);
        }
    }
    log::line("low-memory idle enabled for hidden webviews");
}

// ---------------------------------------------------------------- activation

/// Entry point for the measure hotkey (and the tray item). Runs on the main thread.
pub fn on_hotkey(app: &AppHandle, pressed_at: Instant, preset: Preset) {
    let (phase, cycling, current) = with(app, |c| (c.phase, c.cycle.is_some(), c.preset));
    if cycling {
        log::line("hotkey ignored: S-2 cycle test is running");
        return;
    }
    match phase {
        Phase::Hidden => {
            with(app, |c| c.preset = preset);
            begin_activation(app, pressed_at);
        }
        Phase::Activating => deactivate(app, "hotkey", true),
        // The other zoom's hotkey while measuring: the player picked the wrong one, so
        // switch the scale instead of closing.
        Phase::Active if preset != current => switch_preset(app, preset),
        Phase::Active => request_exit(app),
        Phase::Deactivating => log::line("hotkey ignored: overlay is deactivating"),
    }
}

fn switch_preset(app: &AppHandle, preset: Preset) {
    with(app, |c| c.preset = preset);
    let _ = app.emit_to(OVERLAY, "overlay-preset", PresetEvent { preset });
    log::line(format!("preset switched to {preset:?} while measuring"));
}

/// The hotkey's key-up (and any held modifier) still has to arrive. Handing focus back
/// now would deliver those releases to the game, so the UI finishes the exit once every
/// key is up; the timer covers a UI that never answers.
fn request_exit(app: &AppHandle) {
    let seq = with(app, |c| c.activation_seq);
    let _ = app.emit_to(OVERLAY, "overlay-exit-request", SeqEvent { seq });
    log::line(format!("exit requested #{seq}: waiting for keys to be released"));
    let handle = app.clone();
    thread::spawn(move || {
        thread::sleep(EXIT_REQUEST_TIMEOUT);
        let inner = handle.clone();
        let _ = handle.run_on_main_thread(move || {
            let pending = with(&inner, |c| c.phase == Phase::Active && c.activation_seq == seq);
            if pending {
                deactivate(&inner, "exit request timed out", true);
            }
        });
    });
}

fn begin_activation(app: &AppHandle, pressed_at: Instant) {
    let Some((win, hwnd)) = overlay(app) else { return };
    let prev = focus::foreground();
    let (seq, mode, low_memory, preset) = with(app, |c| {
        c.phase = Phase::Activating;
        c.prev_foreground = prev;
        c.activation_seq += 1;
        c.pressed_at = Some(pressed_at);
        c.focused = false;
        (c.activation_seq, c.mode, c.low_memory, c.preset)
    });
    let (width, height) = place_on_cursor_monitor(app, &win).unwrap_or_default();
    let _ = win.set_ignore_cursor_events(false);
    let _ = win.set_always_on_top(true);
    window_style::set_tool_window(hwnd);
    let _ = app.emit_to(OVERLAY, "overlay-activating", ActivatingEvent { seq, mode, preset, width, height });
    reveal(&win, hwnd, (mode, low_memory));
    log::line(format!(
        "activate #{seq}: preset={preset:?}, mode={mode:?}, previous foreground {}",
        if prev == 0 { "none" } else { "kept" }
    ));
    attempt_focus(app.clone(), seq, 1);
}

fn attempt_focus(app: AppHandle, seq: u64, attempt: u32) {
    let current = with(&app, |c| c.phase == Phase::Activating && c.activation_seq == seq);
    if !current {
        return;
    }
    let Some((_, hwnd)) = overlay(&app) else { return };
    if focus::try_activate(hwnd) {
        finish_activation(&app, seq, attempt, true);
        return;
    }
    if attempt >= FOCUS_ATTEMPTS {
        finish_activation(&app, seq, attempt, false);
        schedule_click_to_start_timeout(app, seq);
        return;
    }
    thread::spawn(move || {
        thread::sleep(FOCUS_RETRY_DELAY);
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || attempt_focus(handle, seq, attempt + 1));
    });
}

fn finish_activation(app: &AppHandle, seq: u64, attempts: u32, ok: bool) {
    let ms = with(app, |c| {
        c.phase = Phase::Active;
        let ms = c.pressed_at.map_or(0.0, |t| t.elapsed().as_secs_f64() * 1000.0);
        if ok {
            c.focused = true;
            c.focus_latency.push(ms);
        } else {
            c.focus_latency.fail();
        }
        ms
    });
    let _ = app.emit_to(OVERLAY, "overlay-activated", ActivatedEvent { seq, ok, attempts, ms });
    log::line(format!(
        "activate #{seq}: focus {} after {attempts} attempt(s), {ms:.1} ms since WM_HOTKEY",
        if ok { "OK" } else { "NOT TAKEN, waiting for a click" }
    ));
}

fn schedule_click_to_start_timeout(app: AppHandle, seq: u64) {
    thread::spawn(move || {
        thread::sleep(CLICK_TO_START_TIMEOUT);
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || {
            let expired =
                with(&handle, |c| c.phase == Phase::Active && c.activation_seq == seq && !c.focused);
            if expired {
                deactivate(&handle, "no click within 3 s", false);
            }
        });
    });
}

// -------------------------------------------------------------- deactivation

pub fn deactivate(app: &AppHandle, reason: &str, restore_previous: bool) {
    let next = with(app, |c| {
        if !matches!(c.phase, Phase::Activating | Phase::Active) {
            return None;
        }
        c.phase = Phase::Deactivating;
        c.blank_seq += 1;
        c.focused = false;
        // Used at most once: a handle kept longer could be reused by an unrelated window.
        Some((c.blank_seq, std::mem::take(&mut c.prev_foreground)))
    });
    let Some((seq, prev)) = next else { return };
    if let Some((win, hwnd)) = overlay(app) {
        let _ = win.set_ignore_cursor_events(true);
        window_style::set_tool_window(hwnd);
    }
    let restored = restore_previous && focus::restore(prev);
    log::line(format!("deactivate ({reason}): focus given back = {restored}"));
    let _ = app.emit_to(OVERLAY, "overlay-blank-request", SeqEvent { seq });
    let handle = app.clone();
    thread::spawn(move || {
        thread::sleep(BLANK_ACK_TIMEOUT);
        let inner = handle.clone();
        let _ = handle.run_on_main_thread(move || finish_hide(&inner, seq, "timeout"));
    });
}

/// Called when the UI confirms an empty frame (or the timeout fires).
pub fn finish_hide(app: &AppHandle, seq: u64, via: &str) {
    let rest = with(app, |c| {
        if c.phase != Phase::Deactivating || c.blank_seq != seq {
            return None;
        }
        c.phase = Phase::Hidden;
        Some((c.mode, c.low_memory))
    });
    let Some(rest) = rest else { return };
    if let Some((win, hwnd)) = overlay(app) {
        conceal(&win, hwnd, rest);
    }
    log::line(format!("hidden #{seq} via {via} (mode={:?})", rest.0));
}

pub fn on_window_event(window: &Window, event: &WindowEvent) {
    if window.label() != OVERLAY {
        return;
    }
    let WindowEvent::Focused(focused) = event else { return };
    let app = window.app_handle().clone();
    if *focused {
        let notify = with(&app, |c| {
            let newly = !c.focused;
            c.focused = true;
            newly && c.phase == Phase::Active
        });
        log::line("overlay focused");
        if notify {
            let _ = app.emit_to(OVERLAY, "overlay-focused", ());
        }
    } else {
        let lost_while_active = with(&app, |c| {
            let had = c.focused;
            c.focused = false;
            had && c.phase == Phase::Active
        });
        log::line("overlay lost focus");
        if lost_while_active {
            deactivate(&app, "focus lost", false);
        }
    }
}

// ------------------------------------------------------------ window states

fn reveal(win: &WebviewWindow, hwnd: RawHwnd, (mode, low_memory): (HideMode, bool)) {
    if low_memory {
        webview_power::set_idle(win, false);
    }
    match mode {
        HideMode::Hide => {
            let _ = win.show();
        }
        HideMode::Cloak => {
            window_style::set_cloaked(hwnd, false);
        }
        HideMode::Always => {}
    }
    window_style::set_tool_window(hwnd);
}

fn conceal(win: &WebviewWindow, hwnd: RawHwnd, (mode, low_memory): (HideMode, bool)) {
    match mode {
        HideMode::Hide => {
            let _ = win.hide();
        }
        HideMode::Cloak => {
            window_style::set_cloaked(hwnd, true);
        }
        HideMode::Always => {}
    }
    if low_memory {
        webview_power::set_idle(win, true);
    }
}

/// Switches the resting state. Only allowed while hidden and not cycling.
pub fn set_mode(app: &AppHandle, mode: HideMode) -> bool {
    let old = with(app, |c| {
        if c.phase != Phase::Hidden || c.cycle.is_some() {
            return None;
        }
        let old = c.mode;
        c.mode = mode;
        Some(old)
    });
    let Some(old) = old else { return false };
    let Some((win, hwnd)) = overlay(app) else { return false };
    if old == HideMode::Cloak {
        window_style::set_cloaked(hwnd, false);
    }
    match mode {
        HideMode::Hide => {
            let _ = win.hide();
        }
        HideMode::Cloak => {
            window_style::set_cloaked(hwnd, true);
            place_on_cursor_monitor(app, &win);
            let _ = win.show();
        }
        HideMode::Always => {
            place_on_cursor_monitor(app, &win);
            let _ = win.show();
        }
    }
    let _ = win.set_ignore_cursor_events(true);
    let _ = win.set_always_on_top(true);
    window_style::set_tool_window(hwnd);
    log::line(format!("rest mode {old:?} -> {mode:?}"));
    true
}

fn cursor_monitor(app: &AppHandle) -> Option<Monitor> {
    app.cursor_position()
        .ok()
        .and_then(|p| app.monitor_from_point(p.x, p.y).ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten())
}

/// Moves the overlay onto the monitor under the cursor and returns its size in CSS px.
fn place_on_cursor_monitor(app: &AppHandle, win: &WebviewWindow) -> Option<(f64, f64)> {
    let Some(monitor) = cursor_monitor(app) else {
        log::line("no monitor found for the cursor");
        return None;
    };
    let pos = *monitor.position();
    let size = *monitor.size();
    // One pixel short of the monitor height: full-monitor transparent WebView2 windows
    // render black on some drivers.
    let target = PhysicalSize::new(size.width, size.height.saturating_sub(1));
    let scale = monitor.scale_factor();
    let css_size = (f64::from(target.width) / scale, f64::from(target.height) / scale);
    let key = (pos.x, pos.y, size.width, size.height);
    let changed = with(app, |c| c.monitor_key.replace(key) != Some(key));
    if !changed {
        return Some(css_size);
    }
    let _ = win.set_size(target);
    let _ = win.set_position(PhysicalPosition::new(pos.x, pos.y));
    // WM_DPICHANGED applies its own rectangle when crossing monitors with other scaling.
    let _ = win.set_size(target);
    log::line(format!(
        "overlay placed on {}x{} monitor at ({}, {}), scale {scale:.2}",
        size.width, size.height, pos.x, pos.y
    ));
    Some(css_size)
}

// ---------------------------------------------------------------------- HUD

pub fn show_hud(app: &AppHandle, payload: HudPayload, pinned: bool) {
    let Some(hud) = app.get_webview_window(HUD) else { return };
    position_hud(app, &hud);
    let (generation, low_memory) = with(app, |c| {
        c.hud_generation += 1;
        c.hud_pinned = pinned;
        (c.hud_generation, c.low_memory)
    });
    if low_memory {
        webview_power::set_idle(&hud, false);
    }
    let _ = app.emit_to(HUD, "hud-update", payload);
    let _ = hud.show();
    if let Some(hwnd) = hwnd_of(&hud) {
        window_style::set_tool_window(hwnd);
    }
    if pinned {
        return;
    }
    let handle = app.clone();
    thread::spawn(move || {
        thread::sleep(HUD_VISIBLE_FOR);
        let inner = handle.clone();
        let _ = handle.run_on_main_thread(move || {
            let expired = with(&inner, |c| c.hud_generation == generation && !c.hud_pinned);
            if expired {
                conceal_hud(&inner);
            }
        });
    });
}

pub fn hide_hud(app: &AppHandle) {
    with(app, |c| {
        c.hud_pinned = false;
        c.hud_generation += 1;
    });
    conceal_hud(app);
}

fn conceal_hud(app: &AppHandle) {
    let Some(hud) = app.get_webview_window(HUD) else { return };
    let _ = hud.hide();
    if with(app, |c| c.low_memory) {
        webview_power::set_idle(&hud, true);
    }
}

fn position_hud(app: &AppHandle, hud: &WebviewWindow) {
    let monitor = app
        .get_webview_window(OVERLAY)
        .and_then(|w| w.current_monitor().ok().flatten())
        .or_else(|| cursor_monitor(app));
    let Some(monitor) = monitor else { return };
    let size = hud.outer_size().unwrap_or(PhysicalSize::new(380, 140));
    let x = monitor.position().x + (monitor.size().width as i32 - size.width as i32) / 2;
    let y = monitor.position().y + (HUD_TOP_MARGIN * monitor.scale_factor()).round() as i32;
    let _ = hud.set_position(PhysicalPosition::new(x, y));
}

pub fn focus_stats(app: &AppHandle) -> String {
    with(app, |c| c.focus_latency.describe("hotkey→focus"))
}

// ------------------------------------------------------- S-2 cycle support

pub fn begin_cycle(app: &AppHandle, sender: mpsc::Sender<CycleAck>) -> bool {
    with(app, |c| {
        if c.phase != Phase::Hidden || c.cycle.is_some() {
            return false;
        }
        c.cycle = Some(sender);
        true
    })
}

pub fn end_cycle(app: &AppHandle) {
    with(app, |c| c.cycle = None);
}

pub fn cycle_show(app: &AppHandle, seq: u64) {
    let Some((win, hwnd)) = overlay(app) else { return };
    place_on_cursor_monitor(app, &win);
    reveal(&win, hwnd, rest_state(app));
    let _ = app.emit_to(OVERLAY, "cycle-show", SeqEvent { seq });
}

pub fn cycle_blank(app: &AppHandle, seq: u64) {
    let _ = app.emit_to(OVERLAY, "cycle-blank", SeqEvent { seq });
}

pub fn cycle_conceal(app: &AppHandle) {
    let Some((win, hwnd)) = overlay(app) else { return };
    conceal(&win, hwnd, rest_state(app));
}

pub fn cycle_ack(app: &AppHandle, kind: &str, seq: u64) {
    let Some(sender) = with(app, |c| c.cycle.clone()) else { return };
    let now = Instant::now();
    let ack = match kind {
        "painted" => CycleAck::Painted(seq, now),
        "blanked" => CycleAck::Blanked(seq, now),
        _ => return,
    };
    let _ = sender.send(ack);
}
