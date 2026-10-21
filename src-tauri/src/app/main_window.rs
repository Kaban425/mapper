//! Main window lifecycle: closing hides it to the tray (hotkeys keep working).

use tauri::{AppHandle, Manager};

use super::windows::MAIN;
use crate::platform::win::focus::{self, OwnHwnd};
use crate::platform::win::webview;

pub fn show(app: &AppHandle) {
    let Some(win) = app.get_webview_window(MAIN) else { return };
    webview::set_idle(&win, false);
    let _ = win.show();
    let _ = win.unminimize();
    // Not tao's focus helper: its fallback synthesises an Alt key press.
    if let Some(hwnd) = OwnHwnd::of(&win) {
        focus::try_activate(hwnd);
    }
}

pub fn hide(app: &AppHandle) {
    let Some(win) = app.get_webview_window(MAIN) else { return };
    let _ = win.hide();
    webview::set_idle(&win, true);
}
