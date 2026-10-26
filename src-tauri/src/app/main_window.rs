//! Main window lifecycle: closing hides it to the tray (hotkeys keep working); the first time
//! the window explains that in a dialog instead. Shown without tao's focus helper.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use super::timers::{TimerId, Timers};
use super::tray;
use super::windows::MAIN;
use crate::config::ConfigStore;
use crate::hotkeys::{HotkeyService, HotkeysState};
use crate::logging;
use crate::platform::win::focus::{self, OwnHwnd};
use crate::platform::win::webview;

/// Sent instead of hiding on the first close: the window shows "Mapper keeps running in the tray".
pub const TRAY_HINT: &str = "tray-hint";
/// Hotkeys paused for the recorder come back on their own after this.
const SUSPEND_LIMIT: Duration = Duration::from_secs(30);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct TrayHint {}

/// The recorder's pause and the main window's own flags.
#[derive(Default)]
pub struct MainWindowState {
    suspended: AtomicBool,
    /// The 30 s safety resume of the current pause.
    resume_timer: Mutex<Option<TimerId>>,
    /// The tray dialog was asked for in this run: a second close hides even if the page never
    /// answered or the config is read-only.
    hint_sent: AtomicBool,
}

pub fn show(app: &AppHandle) {
    let Some(win) = app.get_webview_window(MAIN) else { return };
    webview::set_idle(&win, false);
    let _ = win.show();
    let _ = win.unminimize();
    // Not tao's focus helper: its fallback synthesises an Alt key press.
    if let Some(hwnd) = OwnHwnd::of(&win) {
        focus::try_activate(hwnd);
    }
    // Another program may have released a busy hotkey since.
    if let Some(service) = app.try_state::<HotkeyService>() {
        service.retry_failed();
        tray::refresh(app);
    }
    super::snapshot::publish(app);
}

pub fn hide(app: &AppHandle) {
    let Some(win) = app.get_webview_window(MAIN) else { return };
    let _ = win.hide();
    webview::set_idle(&win, true);
}

/// X or Alt+F4. The first time the window stays and shows the tray dialog.
pub fn on_close_requested(app: &AppHandle) {
    let state = app.state::<MainWindowState>();
    let shown_before = app.state::<ConfigStore>().get().tray_hint_shown;
    if shown_before || state.hint_sent.swap(true, Ordering::SeqCst) {
        hide(app);
        return;
    }
    if let Err(err) = app.emit_to(MAIN, TRAY_HINT, TrayHint {}) {
        logging::warn("main", format!("{TRAY_HINT} not delivered: {err}; hiding"));
        hide(app);
    }
}

/// "Got it" in the tray dialog: remembered, then hidden like any later close.
pub fn hide_to_tray(app: &AppHandle) {
    if let Err(err) = app.state::<ConfigStore>().update(|c| c.tray_hint_shown = true) {
        logging::warn("main", format!("tray dialog not remembered: {err}"));
    }
    hide(app);
}

/// The hotkey recorder: both hotkeys off until `resume`, the window losing focus, or 30 s.
/// A pause already running is not extended. The flag and the safety resume are set before the
/// hotkey thread is asked, so a late answer cannot leave the hotkeys off for good.
pub fn suspend_hotkeys(app: &AppHandle) -> Option<HotkeysState> {
    let service = app.try_state::<HotkeyService>()?;
    let state = app.state::<MainWindowState>();
    if state.suspended.swap(true, Ordering::SeqCst) {
        return service.state();
    }
    let handle = app.clone();
    let timer = app.state::<Timers>().schedule(SUSPEND_LIMIT, move || {
        let inner = handle.clone();
        let _ = handle.run_on_main_thread(move || {
            logging::info("hotkeys", "recording took longer than 30 s: hotkeys back on");
            resume_hotkeys(&inner);
            super::snapshot::publish(&inner);
        });
    });
    *state.resume_timer.lock().unwrap_or_else(|e| e.into_inner()) = Some(timer);
    let answer = service.suspend();
    if answer.is_none() {
        resume_hotkeys(app);
    }
    answer
}

pub fn resume_hotkeys(app: &AppHandle) -> Option<HotkeysState> {
    let state = app.state::<MainWindowState>();
    state.suspended.store(false, Ordering::SeqCst);
    if let Some(timer) = state.resume_timer.lock().unwrap_or_else(|e| e.into_inner()).take() {
        app.state::<Timers>().cancel(timer);
    }
    let answer = app.try_state::<HotkeyService>()?.resume();
    tray::refresh(app);
    answer
}

/// Losing focus ends a recording: hotkeys must work again before the player is in game.
pub fn on_focus_lost(app: &AppHandle) {
    if app.state::<MainWindowState>().suspended.load(Ordering::SeqCst) {
        resume_hotkeys(app);
        super::snapshot::publish(app);
    }
}
