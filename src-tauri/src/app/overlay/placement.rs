//! Which monitor the overlay opens on and how it covers it: the pinned monitor, else the one
//! under the cursor, else the primary. The window is one physical pixel shorter than the
//! monitor (a full-monitor transparent WebView2 renders black on some drivers).

use tauri::{AppHandle, Monitor, PhysicalPosition, PhysicalSize, WebviewWindow};

use super::events::Viewport;
use crate::config::{MonitorKey, MonitorMode, MonitorRef};
use crate::logging;

#[derive(Debug, Clone, PartialEq)]
pub struct Placement {
    pub key: MonitorKey,
    pub viewport: Viewport,
    /// The monitor's top-left corner and size, physical px.
    pub position: PhysicalPosition<i32>,
    pub size: PhysicalSize<u32>,
}

/// Window size and CSS viewport for a monitor of `size` at `scale`.
pub fn layout(size: PhysicalSize<u32>, scale: f64) -> (PhysicalSize<u32>, Viewport) {
    let target = PhysicalSize::new(size.width, size.height.saturating_sub(1));
    let viewport = Viewport { w: f64::from(target.width) / scale, h: f64::from(target.height) / scale, scale };
    (target, viewport)
}

fn pinned_monitor(monitors: &[Monitor], pinned: &MonitorRef) -> Option<Monitor> {
    let by_name = monitors.iter().find(|m| m.name().is_some_and(|name| *name == pinned.name));
    let by_rect = || {
        monitors.iter().find(|m| {
            let (p, s) = (m.position(), m.size());
            p.x == pinned.x && p.y == pinned.y && s.width == pinned.w && s.height == pinned.h
        })
    };
    by_name.or_else(by_rect).cloned()
}

fn choose(app: &AppHandle, mode: &MonitorMode) -> Option<Monitor> {
    if let MonitorMode::Pinned { pinned } = mode {
        let monitors = app.available_monitors().unwrap_or_default();
        match pinned_monitor(&monitors, pinned) {
            Some(monitor) => return Some(monitor),
            None => logging::warn("overlay", "pinned monitor not found; using the monitor under the cursor"),
        }
    }
    app.cursor_position()
        .ok()
        .and_then(|p| app.monitor_from_point(p.x, p.y).ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten())
}

/// Moves the overlay onto the chosen monitor. `previous` skips the move when nothing changed.
pub fn place(
    app: &AppHandle,
    win: &WebviewWindow,
    mode: &MonitorMode,
    previous: Option<&Placement>,
) -> Option<Placement> {
    let Some(monitor) = choose(app, mode) else {
        logging::error("overlay", "no monitor found");
        return None;
    };
    let (position, size, scale) = (*monitor.position(), *monitor.size(), monitor.scale_factor());
    let (target, viewport) = layout(size, scale);
    let Some(key) = MonitorKey::new(size.width, size.height, scale) else {
        logging::error("overlay", format!("monitor size {}x{} is out of range", size.width, size.height));
        return None;
    };
    let placement = Placement { key, viewport, position, size };
    if previous == Some(&placement) {
        return Some(placement);
    }
    let _ = win.set_size(target);
    let _ = win.set_position(position);
    // WM_DPICHANGED applies its own rectangle when crossing monitors with another scale.
    let _ = win.set_size(target);
    logging::info("overlay", format!("placed on {} at ({}, {})", placement.key.label(), position.x, position.y));
    Some(placement)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn covers_the_monitor_minus_one_pixel() {
        let (target, viewport) = layout(PhysicalSize::new(2560, 1440), 1.25);
        assert_eq!(target, PhysicalSize::new(2560, 1439));
        assert_eq!(viewport.w, 2048.0);
        assert!((viewport.h - 1151.2).abs() < 1e-9);
        assert_eq!(viewport.scale, 1.25);
    }

    #[test]
    fn portrait_monitors_work_too() {
        let (target, viewport) = layout(PhysicalSize::new(1080, 1920), 1.0);
        assert_eq!(target, PhysicalSize::new(1080, 1919));
        assert_eq!((viewport.w, viewport.h), (1080.0, 1919.0));
    }
}
