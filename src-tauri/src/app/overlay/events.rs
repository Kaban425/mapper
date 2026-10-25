//! Payloads Rust sends to the overlay (plan/eng.md §4), always with `emit_to("overlay", …)`.
//! Their JSON shape is pinned by fixtures in `src-tauri/tests/ipc-fixtures`, which the
//! TypeScript validators are tested against too.

use serde::Serialize;

use super::phase::BlankReason;
use crate::config::{Calibration, Hotkeys, Language, Speeds};
use crate::preset::Preset;

pub const ACTIVATING: &str = "overlay-activating";
pub const ACTIVATED: &str = "overlay-activated";
pub const FOCUSED: &str = "overlay-focused";
pub const PRESET: &str = "overlay-preset";
pub const EXIT_REQUEST: &str = "overlay-exit-request";
pub const BLANK_REQUEST: &str = "overlay-blank-request";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Start {
    Measure,
    Calibrate,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct Viewport {
    /// Overlay size in CSS px; the page may not have seen the resize yet.
    pub w: f64,
    pub h: f64,
    pub scale: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct MonitorInfo {
    pub key: String,
    pub label: String,
}

/// Only the scales that fit this monitor and overlay size; `null` otherwise.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Calibrations {
    pub near: Option<Calibration>,
    pub far: Option<Calibration>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlaySettings {
    pub language: Language,
    pub panel_opacity: f64,
    pub speeds: Speeds,
    pub hotkeys: Hotkeys,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct OverlayActivating {
    pub seq: u64,
    pub preset: Preset,
    pub start: Start,
    pub viewport: Viewport,
    pub monitor: MonitorInfo,
    pub calibrations: Calibrations,
    pub settings: OverlaySettings,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct Activated {
    pub seq: u64,
    pub ok: bool,
    pub attempts: u32,
    /// From WM_HOTKEY to the end of the activation.
    pub ms: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct Seq {
    pub seq: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct PresetSwitch {
    pub seq: u64,
    pub preset: Preset,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct BlankRequest {
    pub seq: u64,
    pub reason: BlankReason,
}

#[cfg(test)]
pub(crate) mod fixtures {
    //! Rust writes the canonical payloads; `UPDATE_FIXTURES=1 cargo test` refreshes them.

    use std::path::PathBuf;

    use serde::Serialize;

    pub fn check<T: Serialize>(name: &str, value: &T) {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/ipc-fixtures").join(format!("{name}.json"));
        let json = serde_json::to_string_pretty(value).unwrap() + "\n";
        if std::env::var_os("UPDATE_FIXTURES").is_some() {
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(&path, &json).unwrap();
            return;
        }
        let expected = std::fs::read_to_string(&path)
            .unwrap_or_else(|_| panic!("{} is missing: run UPDATE_FIXTURES=1 cargo test", path.display()));
        assert_eq!(expected.replace("\r\n", "\n"), json, "{name}.json is outdated: run UPDATE_FIXTURES=1 cargo test");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::Point;

    pub(crate) fn activating() -> OverlayActivating {
        let near = Calibration {
            cell_meters: 100,
            cell_px: 170.4,
            origin: Point { x: 512.0, y: 300.0 },
            w: 2048.0,
            h: 1151.2,
            scale: 1.25,
            created_at: "2026-10-21T18:04:11.512Z".into(),
        };
        OverlayActivating {
            seq: 12,
            preset: Preset::Near,
            start: Start::Measure,
            viewport: Viewport { w: 2048.0, h: 1151.2, scale: 1.25 },
            monitor: MonitorInfo { key: "2560x1440@125".into(), label: "2560×1440 · 125 %".into() },
            calibrations: Calibrations { near: Some(near), far: None },
            settings: OverlaySettings {
                language: Language::Ru,
                panel_opacity: 0.86,
                speeds: Speeds::default(),
                hotkeys: Hotkeys::default(),
            },
        }
    }

    #[test]
    fn payloads_match_the_fixtures() {
        fixtures::check("overlay-activating", &activating());
        fixtures::check("overlay-activated", &Activated { seq: 12, ok: true, attempts: 1, ms: 26.5 });
        fixtures::check("overlay-preset", &PresetSwitch { seq: 12, preset: Preset::Far });
        fixtures::check("overlay-blank-request", &BlankRequest { seq: 3, reason: BlankReason::FocusLost });
    }
}
