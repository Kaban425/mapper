//! App commands. Each one checks the calling window (second line of defence after the
//! per-window capability ACL) and validates its input.

use serde::Serialize;
use tauri::{AppHandle, WebviewWindow};

use crate::app::windows::{MAIN, OVERLAY};
use crate::logging::{self, Level, MAX_LINE_CHARS};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    InvalidInput,
    NotAllowed,
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
