//! Global hotkeys through RegisterHotKey only.
//!
//! A dedicated thread owns a message queue, registers the hotkeys against that queue
//! (no window, no hooks, no keyboard polling) and reports WM_HOTKEY presses through a
//! callback. Key release is not tracked: Mapper only needs "pressed".

use std::io;
use std::sync::mpsc;
use std::thread::{self, JoinHandle};
use std::time::Instant;

use windows::Win32::Foundation::{LPARAM, WPARAM};
use windows::Win32::System::Threading::GetCurrentThreadId;
use windows::Win32::UI::Input::KeyboardAndMouse::{
    RegisterHotKey, UnregisterHotKey, HOT_KEY_MODIFIERS, MOD_NOREPEAT,
};
use windows::Win32::UI::WindowsAndMessaging::{
    GetMessageW, PeekMessageW, PostThreadMessageW, MSG, PM_NOREMOVE, WM_HOTKEY, WM_QUIT, WM_USER,
};

use crate::hotkey_spec::HotkeySpec;

#[derive(Debug, Clone)]
pub struct Binding {
    pub id: i32,
    pub label: String,
    pub spec: HotkeySpec,
}

#[derive(Debug, Clone)]
pub struct Registration {
    pub id: i32,
    pub label: String,
    /// `None` when the hotkey was registered, otherwise the Windows error text
    /// (typically "Hot key is already registered").
    pub error: Option<String>,
}

pub struct HotkeyThread {
    thread_id: u32,
    join: Option<JoinHandle<()>>,
}

impl HotkeyThread {
    pub fn spawn<F>(bindings: Vec<Binding>, on_press: F) -> io::Result<(Self, Vec<Registration>)>
    where
        F: Fn(i32, Instant) + Send + 'static,
    {
        let (ready_tx, ready_rx) = mpsc::channel();
        let join = thread::Builder::new()
            .name("mapper-hotkeys".into())
            .spawn(move || run(bindings, on_press, ready_tx))?;
        let (thread_id, registrations) = ready_rx
            .recv()
            .map_err(|_| io::Error::other("hotkey thread exited before registering"))?;
        Ok((Self { thread_id, join: Some(join) }, registrations))
    }
}

impl Drop for HotkeyThread {
    fn drop(&mut self) {
        // Posting to our own hotkey thread; it unregisters everything before exiting.
        unsafe {
            let _ = PostThreadMessageW(self.thread_id, WM_QUIT, WPARAM(0), LPARAM(0));
        }
        if let Some(join) = self.join.take() {
            let _ = join.join();
        }
    }
}

fn run<F>(bindings: Vec<Binding>, on_press: F, ready_tx: mpsc::Sender<(u32, Vec<Registration>)>)
where
    F: Fn(i32, Instant),
{
    let mut msg = MSG::default();
    // SAFETY: plain Win32 calls on the current thread with valid out-pointers.
    unsafe {
        // Force creation of the thread message queue before anyone can post to it.
        let _ = PeekMessageW(&mut msg, None, WM_USER, WM_USER, PM_NOREMOVE);
        let thread_id = GetCurrentThreadId();
        let registrations = bindings
            .iter()
            .map(|b| {
                let modifiers = HOT_KEY_MODIFIERS(b.spec.modifiers) | MOD_NOREPEAT;
                let error = RegisterHotKey(None, b.id, modifiers, b.spec.vk)
                    .err()
                    .map(|e| e.to_string());
                Registration { id: b.id, label: b.label.clone(), error }
            })
            .collect();
        if ready_tx.send((thread_id, registrations)).is_err() {
            return;
        }
        loop {
            let status = GetMessageW(&mut msg, None, 0, 0);
            if status.0 <= 0 {
                break; // WM_QUIT (0) or error (-1)
            }
            if msg.message == WM_HOTKEY {
                on_press(msg.wParam.0 as i32, Instant::now());
            }
        }
        for b in &bindings {
            let _ = UnregisterHotKey(None, b.id);
        }
    }
}
