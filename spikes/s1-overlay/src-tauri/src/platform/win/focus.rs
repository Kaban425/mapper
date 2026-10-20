//! The only place that touches the foreground window.
//!
//! Rules: the previous foreground window is kept as an opaque handle and never queried
//! (no title, class, process). Activation uses SetForegroundWindow directly, which Windows
//! allows right after our WM_HOTKEY. Tao's own focus helper is never used because its
//! fallback synthesises an Alt key press.

use std::ffi::c_void;

use windows::Win32::Foundation::HWND;
use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, IsWindow, SetForegroundWindow};

/// Window handle stored as an integer so it can live in `Send` state.
pub type RawHwnd = isize;

pub fn to_hwnd(raw: RawHwnd) -> HWND {
    HWND(raw as *mut c_void)
}

pub fn to_raw(hwnd: HWND) -> RawHwnd {
    hwnd.0 as RawHwnd
}

pub fn foreground() -> RawHwnd {
    // SAFETY: no arguments, returns a handle value or null.
    to_raw(unsafe { GetForegroundWindow() })
}

/// Tries to make `raw` the foreground window and reports whether it actually is now.
pub fn try_activate(raw: RawHwnd) -> bool {
    let hwnd = to_hwnd(raw);
    // SAFETY: `hwnd` is one of our own top-level windows.
    unsafe {
        let _ = SetForegroundWindow(hwnd);
        GetForegroundWindow() == hwnd
    }
}

/// Gives the foreground back to the window that had it before the hotkey.
/// Returns false when there was none or it no longer exists.
pub fn restore(raw: RawHwnd) -> bool {
    if raw == 0 {
        return false;
    }
    let hwnd = to_hwnd(raw);
    // SAFETY: IsWindow tolerates stale handles; SetForegroundWindow is allowed because
    // our overlay is the foreground window at this point.
    unsafe { IsWindow(Some(hwnd)).as_bool() && SetForegroundWindow(hwnd).as_bool() }
}
