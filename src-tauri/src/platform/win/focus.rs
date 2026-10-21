//! The only file that touches the foreground window.
//!
//! The game's window is held as a `ForeignHwnd`: no getters, no copies, no Debug — the only
//! thing Mapper can do with it is hand the focus back once. Our own windows are `OwnHwnd`,
//! which can only be made from a Tauri window. Activation uses SetForegroundWindow directly
//! (allowed right after our WM_HOTKEY); tao's focus helper is never used because its
//! fallback synthesises an Alt key press.

use std::ffi::c_void;
use std::num::NonZeroIsize;

use tauri::{Runtime, WebviewWindow};
use windows::Win32::Foundation::HWND;
use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, IsWindow, SetForegroundWindow};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct OwnHwnd(isize);

impl OwnHwnd {
    pub fn of<R: Runtime>(win: &WebviewWindow<R>) -> Option<Self> {
        win.hwnd().ok().map(|h| Self(h.0 as isize))
    }

    pub(crate) fn hwnd(self) -> HWND {
        HWND(self.0 as *mut c_void)
    }
}

/// A window that is not ours, captured when the hotkey fired.
pub struct ForeignHwnd(NonZeroIsize);

impl ForeignHwnd {
    /// Gives the focus back, at most once (the handle is consumed). False when the window
    /// no longer exists or Windows refused.
    pub fn restore(self) -> bool {
        let hwnd = HWND(self.0.get() as *mut c_void);
        // SAFETY: IsWindow tolerates stale handles; SetForegroundWindow is allowed because
        // one of our windows is the foreground window at this point.
        unsafe { IsWindow(Some(hwnd)).as_bool() && SetForegroundWindow(hwnd).as_bool() }
    }
}

pub enum Foreground {
    None,
    Own(OwnHwnd),
    Foreign(ForeignHwnd),
}

pub fn capture_foreground(own: &[OwnHwnd]) -> Foreground {
    // SAFETY: no arguments; returns a handle value or null.
    let raw = unsafe { GetForegroundWindow() }.0 as isize;
    match NonZeroIsize::new(raw) {
        None => Foreground::None,
        Some(_) if own.iter().any(|w| w.0 == raw) => Foreground::Own(OwnHwnd(raw)),
        Some(value) => Foreground::Foreign(ForeignHwnd(value)),
    }
}

/// Tries to make our window the foreground window and reports whether it actually is now.
pub fn try_activate(win: OwnHwnd) -> bool {
    let hwnd = win.hwnd();
    // SAFETY: `hwnd` is one of our own top-level windows.
    unsafe {
        let _ = SetForegroundWindow(hwnd);
        GetForegroundWindow() == hwnd
    }
}
