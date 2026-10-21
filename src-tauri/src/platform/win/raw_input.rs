//! C-6 self-check. tao registers every mouse and keyboard for raw input when the event loop
//! starts; `DeviceEventFilter::Always` removes it. Mapper refuses to run if anything is
//! still registered (or the check itself fails), so it can never receive global input in
//! the background.

use std::fmt;

use windows::Win32::UI::Input::{GetRegisteredRawInputDevices, RAWINPUTDEVICE};

#[derive(Debug)]
pub enum RawInputError {
    Registered(u32),
    /// The count could not be read; treated as a failure, never as "none".
    QueryFailed(windows::core::Error),
}

impl fmt::Display for RawInputError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Registered(n) => write!(f, "{n} raw input device(s) are registered for this process"),
            Self::QueryFailed(e) => write!(f, "could not check raw input registrations: {e}"),
        }
    }
}

impl std::error::Error for RawInputError {}

pub fn registered_device_count() -> windows::core::Result<u32> {
    let mut count = 0u32;
    // SAFETY: size query with a null buffer; only `count` is written.
    let result =
        unsafe { GetRegisteredRawInputDevices(None, &mut count, std::mem::size_of::<RAWINPUTDEVICE>() as u32) };
    // (UINT)-1 signals an error; with a null buffer success returns 0 and fills `count`.
    if result == u32::MAX {
        return Err(windows::core::Error::from_thread());
    }
    Ok(count)
}

pub fn ensure_none() -> Result<(), RawInputError> {
    match registered_device_count().map_err(RawInputError::QueryFailed)? {
        0 => Ok(()),
        n => Err(RawInputError::Registered(n)),
    }
}
