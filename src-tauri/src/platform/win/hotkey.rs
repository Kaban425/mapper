//! Win32 side of the hotkey thread: its message queue and RegisterHotKey itself.
//! No window, no hooks, no keyboard polling — key release is never tracked.

use std::time::Instant;

use windows::Win32::Foundation::{LPARAM, WPARAM};
use windows::Win32::System::Threading::GetCurrentThreadId;
use windows::Win32::UI::Input::KeyboardAndMouse::{RegisterHotKey, UnregisterHotKey, HOT_KEY_MODIFIERS, MOD_NOREPEAT};
use windows::Win32::UI::WindowsAndMessaging::{
    GetMessageW, PeekMessageW, PostThreadMessageW, MSG, PM_NOREMOVE, WM_APP, WM_HOTKEY, WM_USER,
};

use crate::hotkeys::{HotkeySpec, Registrar};

/// Requests are waiting in the channel.
const WM_WAKE: u32 = WM_APP;
/// Leave the loop; preferred over posting WM_QUIT to a thread.
const WM_STOP: u32 = WM_APP + 1;

pub enum Event {
    Hotkey(i32, Instant),
    Wake,
    Quit,
}

/// Handle for posting to the hotkey thread's own queue.
#[derive(Clone, Copy)]
pub struct Queue {
    thread_id: u32,
}

impl Queue {
    pub fn wake(&self) -> bool {
        self.post(WM_WAKE)
    }

    pub fn quit(&self) -> bool {
        self.post(WM_STOP)
    }

    fn post(&self, msg: u32) -> bool {
        // SAFETY: posting a private message to our own hotkey thread.
        unsafe { PostThreadMessageW(self.thread_id, msg, WPARAM(0), LPARAM(0)).is_ok() }
    }
}

/// Creates the calling thread's message queue (so nothing posted early is lost) and returns
/// a handle other threads can post to.
pub fn current_thread_queue() -> Queue {
    let mut msg = MSG::default();
    // SAFETY: plain calls on the current thread with a valid out-pointer.
    unsafe {
        let _ = PeekMessageW(&mut msg, None, WM_USER, WM_USER, PM_NOREMOVE);
        Queue { thread_id: GetCurrentThreadId() }
    }
}

/// Blocks until the next hotkey press or control message for this thread.
pub fn wait_event() -> Event {
    let mut msg = MSG::default();
    loop {
        // SAFETY: valid out-pointer; messages for the current thread only.
        let status = unsafe { GetMessageW(&mut msg, None, 0, 0) };
        if status.0 <= 0 {
            return Event::Quit; // WM_QUIT (0) or error (-1)
        }
        match msg.message {
            WM_HOTKEY => return Event::Hotkey(msg.wParam.0 as i32, Instant::now()),
            WM_WAKE => return Event::Wake,
            WM_STOP => return Event::Quit,
            _ => {}
        }
    }
}

/// Registers against the calling thread's queue; must be used on the hotkey thread only.
pub struct Win32Registrar;

impl Registrar for Win32Registrar {
    fn register(&mut self, id: i32, spec: HotkeySpec) -> Result<(), String> {
        let modifiers = HOT_KEY_MODIFIERS(spec.modifiers) | MOD_NOREPEAT;
        // SAFETY: thread-bound registration without a window.
        unsafe { RegisterHotKey(None, id, modifiers, spec.vk) }.map_err(|e| e.to_string())
    }

    fn unregister(&mut self, id: i32) {
        // SAFETY: unregisters an id this thread registered (no-op otherwise).
        unsafe {
            let _ = UnregisterHotKey(None, id);
        }
    }
}
