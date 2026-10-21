//! Last-resort error box for start-up failures (before or without any webview).

use windows::core::{w, HSTRING};
use windows::Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_ICONERROR, MB_OK};

pub fn fatal(message: &str) {
    crate::logging::error("app", message);
    // SAFETY: modal message box without an owner window.
    unsafe {
        MessageBoxW(None, &HSTRING::from(message), w!("Mapper"), MB_OK | MB_ICONERROR);
    }
}
