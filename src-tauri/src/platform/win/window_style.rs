//! Styling tweaks for our own windows that tao does not expose. Only `OwnHwnd` is accepted,
//! so a typo cannot restyle the game's window.

use std::ffi::c_void;

use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::Graphics::Dwm::{
    DwmSetWindowAttribute, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_ROUND, DWM_WINDOW_CORNER_PREFERENCE,
};
use windows::Win32::UI::Shell::{DefSubclassProc, SetWindowSubclass};
use windows::Win32::UI::WindowsAndMessaging::{
    GetWindowLongPtrW, SetWindowLongPtrW, SetWindowPos, ShowWindow, GWL_EXSTYLE, HWND_TOPMOST, SC_KEYMENU,
    SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, SW_HIDE, SW_SHOWNOACTIVATE, WM_SYSCOMMAND,
    WS_EX_APPWINDOW, WS_EX_TOOLWINDOW,
};

use super::focus::OwnHwnd;

const KEYMENU_SUBCLASS_ID: usize = 0x4D41_5050; // "MAPP"

/// Which Alt-menu activations to swallow.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KeyMenu {
    /// Overlay: releasing Alt after Alt+Q must not enter menu mode and eat the next Esc.
    All,
    /// Main window: plain Alt is swallowed, Alt+Space (system menu) still works.
    PlainAlt,
}

/// Keeps the window out of Alt+Tab. Tao rewrites the whole extended style on every flag
/// change, so this is re-applied after `set_ignore_cursor_events` / `set_always_on_top`.
pub fn set_tool_window(win: OwnHwnd) {
    let hwnd = win.hwnd();
    // SAFETY: reading and writing the extended style of our own window.
    unsafe {
        let current = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        let wanted = (current | WS_EX_TOOLWINDOW.0 as isize) & !(WS_EX_APPWINDOW.0 as isize);
        if wanted != current {
            SetWindowLongPtrW(hwnd, GWL_EXSTYLE, wanted);
            // Make the shell re-read the style without moving or activating the window.
            let flags = SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED;
            let _ = SetWindowPos(hwnd, None, 0, 0, 0, 0, flags);
        }
    }
}

/// Shows the window on top without activating it. tao's `show()` uses SW_SHOW once the window
/// exists, and right after the overlay had the focus that can take it away from the game.
/// tao's own visibility flag stays off, so such a window is hidden with `hide` below too.
pub fn show_no_activate(win: OwnHwnd) {
    let hwnd = win.hwnd();
    // SAFETY: showing and raising our own window; neither call activates it.
    unsafe {
        let _ = ShowWindow(hwnd, SW_SHOWNOACTIVATE);
        let _ = SetWindowPos(hwnd, Some(HWND_TOPMOST), 0, 0, 0, 0, SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE);
    }
}

pub fn hide(win: OwnHwnd) {
    // SAFETY: hiding our own window.
    unsafe {
        let _ = ShowWindow(win.hwnd(), SW_HIDE);
    }
}

/// Must run on the window's own (main) thread.
pub fn suppress_key_menu(win: OwnHwnd, mode: KeyMenu) -> bool {
    let data = usize::from(mode == KeyMenu::PlainAlt);
    // SAFETY: subclassing our own window with a procedure that forwards everything else.
    unsafe { SetWindowSubclass(win.hwnd(), Some(key_menu_proc), KEYMENU_SUBCLASS_ID, data).as_bool() }
}

unsafe extern "system" fn key_menu_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _id: usize,
    plain_alt_only: usize,
) -> LRESULT {
    if msg == WM_SYSCOMMAND && (wparam.0 & 0xFFF0) == SC_KEYMENU as usize {
        // lParam is the character pressed with Alt; 0 means Alt alone.
        let swallow = plain_alt_only == 0 || lparam.0 == 0;
        if swallow {
            return LRESULT(0);
        }
    }
    // SAFETY: forwarding to the next procedure in the subclass chain.
    unsafe { DefSubclassProc(hwnd, msg, wparam, lparam) }
}

/// Windows 11 rounded corners for small undecorated windows; ignored on Windows 10.
pub fn set_round_corners(win: OwnHwnd) {
    let preference: DWM_WINDOW_CORNER_PREFERENCE = DWMWCP_ROUND;
    // SAFETY: DWMWA_WINDOW_CORNER_PREFERENCE takes a 4-byte enum value for our own window.
    unsafe {
        let _ = DwmSetWindowAttribute(
            win.hwnd(),
            DWMWA_WINDOW_CORNER_PREFERENCE,
            (&preference as *const DWM_WINDOW_CORNER_PREFERENCE).cast::<c_void>(),
            std::mem::size_of::<DWM_WINDOW_CORNER_PREFERENCE>() as u32,
        );
    }
}
