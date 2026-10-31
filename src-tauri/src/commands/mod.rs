//! App commands. Each one checks the calling window (second line of defence after the
//! per-window capability ACL) and validates its input.

pub mod main_window;
pub mod overlay;

use serde::Serialize;
use tauri::{AppHandle, WebviewWindow};

use crate::app::windows::{MAIN, OVERLAY};
use crate::config::StoreError;
use crate::logging::{self, Level, MAX_LINE_CHARS};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    InvalidInput,
    NotAllowed,
    /// The command belongs to an older overlay session or another phase.
    StaleSession,
    /// The config was written by a newer Mapper and is read-only.
    ReadOnly,
    Io,
    /// Not a combination the recorder accepts (plan/ux.md §6.4).
    HotkeyInvalid,
    /// Another program holds the combination.
    HotkeyBusy,
    /// The other preset already uses it.
    HotkeyConflict,
    /// Mapper's path is too long for a Windows start-up entry.
    PathTooLong,
    /// "Check now" again within a minute.
    RateLimited,
}

/// Commands return only a code; the UI picks the message in its own language.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct IpcError {
    pub code: ErrorCode,
}

impl IpcError {
    const fn new(code: ErrorCode) -> Self {
        Self { code }
    }
}

impl From<StoreError> for IpcError {
    fn from(err: StoreError) -> Self {
        match err {
            StoreError::ReadOnly => IpcError::new(ErrorCode::ReadOnly),
            StoreError::Io(io) => {
                logging::error("config", format!("saving failed: {io}"));
                IpcError::new(ErrorCode::Io)
            }
        }
    }
}

fn expect_window(window: &WebviewWindow, allowed: &[&str]) -> Result<(), IpcError> {
    if allowed.contains(&window.label()) {
        Ok(())
    } else {
        Err(IpcError::new(ErrorCode::NotAllowed))
    }
}

#[tauri::command]
pub fn log_line(window: WebviewWindow, level: Level, msg: String) -> Result<(), IpcError> {
    expect_window(&window, &[MAIN, OVERLAY])?;
    if msg.chars().count() > MAX_LINE_CHARS {
        return Err(IpcError::new(ErrorCode::InvalidInput));
    }
    logging::ui(window.label(), level, &msg);
    Ok(())
}

#[tauri::command]
pub fn quit_app(window: WebviewWindow, app: AppHandle) -> Result<(), IpcError> {
    expect_window(&window, &[MAIN])?;
    crate::app::quit(&app);
    Ok(())
}
