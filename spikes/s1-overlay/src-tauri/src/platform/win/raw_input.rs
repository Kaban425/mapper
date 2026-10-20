//! Self-check for C-6: after start-up the process must not be registered for raw input
//! (tao registers mice and keyboards by default; DeviceEventFilter::Always removes it).

use windows::Win32::UI::Input::{GetRegisteredRawInputDevices, RAWINPUTDEVICE};

pub fn registered_device_count() -> u32 {
    let mut count = 0u32;
    // SAFETY: size query with a null buffer; only `count` is written.
    unsafe {
        GetRegisteredRawInputDevices(None, &mut count, std::mem::size_of::<RAWINPUTDEVICE>() as u32);
    }
    count
}
