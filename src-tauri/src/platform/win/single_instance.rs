//! One copy of Mapper. The first copy owns a named mutex and waits on a named event; a second
//! copy signals that event (so the first shows its window) and exits. No window lookup —
//! tauri-plugin-single-instance is not used because it calls FindWindowW.

use std::io;
use std::thread::{self, JoinHandle};
use std::time::Duration;

use windows::core::{w, PCWSTR};
use windows::Win32::Foundation::{
    CloseHandle, GetLastError, ERROR_ACCESS_DENIED, ERROR_ALREADY_EXISTS, HANDLE, WAIT_OBJECT_0,
};
use windows::Win32::System::Threading::{
    CreateEventW, CreateMutexW, OpenEventW, SetEvent, WaitForSingleObject, EVENT_MODIFY_STATE, INFINITE,
};
use windows::Win32::UI::WindowsAndMessaging::{AllowSetForegroundWindow, ASFW_ANY};

const MUTEX_NAME: PCWSTR = w!("Local\\Mapper.Instance.{8F3C2A61-5B7E-4D19-9C0A-3E6F1B2D4A57}");
const EVENT_NAME: PCWSTR = w!("Local\\Mapper.ShowMain.{8F3C2A61-5B7E-4D19-9C0A-3E6F1B2D4A57}");
const OPEN_EVENT_ATTEMPTS: u32 = 10;
const OPEN_EVENT_RETRY: Duration = Duration::from_millis(50);

/// Kernel handles as integers so they can move to the listener thread. Neither is ever
/// closed: the named mutex must exist until the process exits, and Windows closes both then.
pub struct Instance {
    _mutex: isize,
    event: isize,
}

pub enum Acquire {
    First(Instance),
    /// Another copy runs and was asked to show its window.
    Second,
    /// Mapper's name is taken (an elevated copy, or another program squatting the name),
    /// but no copy could be asked to show itself; the caller tells the user instead of
    /// exiting silently.
    Unreachable,
}

pub fn acquire() -> windows::core::Result<Acquire> {
    // SAFETY: named kernel objects in the session namespace; handles are owned below.
    unsafe {
        let mutex = match CreateMutexW(None, false, MUTEX_NAME) {
            Ok(mutex) => mutex,
            // An elevated first copy owns the mutex and a normal copy may not open it.
            Err(err) if err.code() == ERROR_ACCESS_DENIED.to_hresult() => return Ok(Acquire::Unreachable),
            Err(err) => return Err(err),
        };
        if GetLastError() == ERROR_ALREADY_EXISTS {
            let _ = CloseHandle(mutex);
            return Ok(if signal_first() { Acquire::Second } else { Acquire::Unreachable });
        }
        let event = match CreateEventW(None, false, false, EVENT_NAME) {
            Ok(event) => event,
            Err(err) => {
                let _ = CloseHandle(mutex);
                return Err(err);
            }
        };
        Ok(Acquire::First(Instance { _mutex: mutex.0 as isize, event: event.0 as isize }))
    }
}

/// True if the first copy's event was signalled. A first copy that is starting right now
/// creates its event just after the mutex, so opening it is retried for half a second.
fn signal_first() -> bool {
    let event = (0..OPEN_EVENT_ATTEMPTS).find_map(|attempt| {
        if attempt > 0 {
            thread::sleep(OPEN_EVENT_RETRY);
        }
        // SAFETY: opens the first copy's event for signalling only.
        unsafe { OpenEventW(EVENT_MODIFY_STATE, false, EVENT_NAME) }.ok()
    });
    let Some(event) = event else { return false };
    // SAFETY: signals and closes the handle opened above.
    unsafe {
        // The first copy may then bring its window to the front. ASFW_ANY because its PID is
        // unknown here (no process lookup); the right lapses at the user's next input.
        let _ = AllowSetForegroundWindow(ASFW_ANY);
        let signalled = SetEvent(event).is_ok();
        let _ = CloseHandle(event);
        signalled
    }
}

impl Instance {
    /// Waits for second copies on a dedicated thread (0 % CPU) for the life of the process.
    pub fn listen(self, on_signal: impl Fn() + Send + 'static) -> io::Result<JoinHandle<()>> {
        let event = self.event;
        thread::Builder::new().name("mapper-instance".into()).spawn(move || {
            let event = HANDLE(event as *mut std::ffi::c_void);
            // SAFETY: waits on our own auto-reset event handle, which is never closed.
            while unsafe { WaitForSingleObject(event, INFINITE) } == WAIT_OBJECT_0 {
                on_signal();
            }
        })
    }
}
