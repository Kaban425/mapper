//! Styling tweaks for our own windows that tao does not expose.

use std::ffi::c_void;

use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::Graphics::Dwm::{DwmSetWindowAttribute, DWMWA_CLOAK};
use windows::Win32::UI::Shell::{DefSubclassProc, SetWindowSubclass};
use windows::Win32::UI::WindowsAndMessaging::{
    GetWindowLongPtrW, SetWindowLongPtrW, SetWindowPos, GWL_EXSTYLE, SC_KEYMENU, SWP_FRAMECHANGED,
    SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, WM_SYSCOMMAND, WS_EX_APPWINDOW,
    WS_EX_TOOLWINDOW,
};

use super::focus::{to_hwnd, RawHwnd};

const KEYMENU_SUBCLASS_ID: usize = 0x4D41_5050; // "MAPP"

/// Keeps the window out of Alt+Tab. Tao rewrites the whole extended style on every flag
/// change, so this must be re-applied after `set_ignore_cursor_events` / `set_always_on_top`.
pub fn set_tool_window(raw: RawHwnd) {
    let hwnd = to_hwnd(raw);
    // SAFETY: reading and writing the extended style of our own window.
    unsafe {
        let current = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        let wanted = (current | WS_EX_TOOLWINDOW.0 as isize) & !(WS_EX_APPWINDOW.0 as isize);
        if wanted != current {
            SetWindowLongPtrW(hwnd, GWL_EXSTYLE, wanted);
            // Make the shell re-read the style (Alt+Tab, taskbar) without moving or activating.
            let flags = SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED;
            let _ = SetWindowPos(hwnd, None, 0, 0, 0, 0, flags);
        }
    }
}

/// Stops Alt (released after Alt+Q) from putting the window into system-menu mode,
/// which would swallow the next Esc. Must run on the window's own (main) thread.
pub fn suppress_key_menu(raw: RawHwnd) -> bool {
    // SAFETY: subclassing our own window with a procedure that forwards everything else.
    unsafe { SetWindowSubclass(to_hwnd(raw), Some(key_menu_proc), KEYMENU_SUBCLASS_ID, 0).as_bool() }
}

unsafe extern "system" fn key_menu_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _id: usize,
    _data: usize,
) -> LRESULT {
    if msg == WM_SYSCOMMAND && (wparam.0 & 0xFFF0) == SC_KEYMENU as usize {
        return LRESULT(0);
    }
    DefSubclassProc(hwnd, msg, wparam, lparam)
}

/// DWM cloak: the window keeps its state but is not drawn. Used for the S-2 "cloak" variant.
pub fn set_cloaked(raw: RawHwnd, cloaked: bool) -> bool {
    let value: i32 = i32::from(cloaked);
    // SAFETY: DWMWA_CLOAK takes a BOOL (4 bytes) and is allowed on our own windows.
    unsafe {
        DwmSetWindowAttribute(
            to_hwnd(raw),
            DWMWA_CLOAK,
            (&value as *const i32).cast::<c_void>(),
            std::mem::size_of::<i32>() as u32,
        )
        .is_ok()
    }
}
