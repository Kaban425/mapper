//! The config file (plan/eng.md §6). Rust is its only owner: the UI gets a snapshot and
//! changes it only through commands. Unknown or out-of-range values are repaired on load
//! by `validate`, so the rest of the app can trust what it reads.

mod monitor_key;
mod store;
pub mod validate;

use std::collections::BTreeMap;

use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;

pub use monitor_key::MonitorKey;
pub use store::{ConfigStore, Notice, StoreError};
pub use validate::validate;

use crate::hotkeys::{DEFAULT_FAR, DEFAULT_NEAR};
use crate::logging;
use crate::preset::Preset;
use crate::update::github::FetchError;

pub const SCHEMA_VERSION: u32 = 2;
pub const MAX_MONITORS: usize = 16;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Language {
    Ru,
    #[default]
    En,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Config {
    pub schema_version: u32,
    pub first_run_done: bool,
    /// The wizard step to reopen on (1..=4) until it is finished or skipped.
    pub wizard_step: u8,
    /// The risk text of wizard step 2 was acknowledged.
    pub risk_accepted: bool,
    /// The "Mapper keeps running in the tray" dialog was shown once.
    pub tray_hint_shown: bool,
    /// Main window zoom (Ctrl+plus / minus / 0).
    pub ui_zoom: f64,
    pub language: Language,
    pub hotkeys: Hotkeys,
    pub speeds: Speeds,
    pub panel_opacity: f64,
    pub monitor: MonitorMode,
    pub autostart: bool,
    pub updates: UpdatePrefs,
    #[serde(deserialize_with = "lenient_calibrations")]
    pub calibrations: BTreeMap<MonitorKey, PresetCalibrations>,
}

/// One bad entry (a hand edit, a key from another version) drops itself, not the whole file:
/// the other monitors' scales survive.
fn lenient_calibrations<'de, D: Deserializer<'de>>(d: D) -> Result<BTreeMap<MonitorKey, PresetCalibrations>, D::Error> {
    let Value::Object(entries) = Value::deserialize(d)? else {
        logging::warn("config", "calibrations is not an object; dropped");
        return Ok(BTreeMap::new());
    };
    let mut calibrations = BTreeMap::new();
    for (text, value) in entries {
        match (MonitorKey::parse(&text), serde_json::from_value::<PresetCalibrations>(value)) {
            (Some(key), Ok(entry)) => {
                calibrations.insert(key, entry);
            }
            _ => {
                let shown: String = text.chars().take(24).collect();
                logging::warn("config", format!("calibration entry {shown:?} dropped"));
            }
        }
    }
    Ok(calibrations)
}

/// A preset whose scale does not parse is simply not calibrated.
fn lenient_calibration<'de, D: Deserializer<'de>>(d: D) -> Result<Option<Calibration>, D::Error> {
    Ok(serde_json::from_value(Value::deserialize(d)?).ok())
}

impl Default for Config {
    fn default() -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            first_run_done: false,
            wizard_step: 1,
            risk_accepted: false,
            tray_hint_shown: false,
            ui_zoom: UI_ZOOM.default,
            language: Language::default(),
            hotkeys: Hotkeys::default(),
            speeds: Speeds::default(),
            panel_opacity: PANEL_OPACITY.default,
            monitor: MonitorMode::Cursor,
            autostart: false,
            updates: UpdatePrefs::default(),
            calibrations: BTreeMap::new(),
        }
    }
}

impl Config {
    pub fn calibration(&self, key: &MonitorKey, preset: Preset) -> Option<&Calibration> {
        self.calibrations.get(key)?.get(preset)
    }
}

/// A setting's allowed range and default.
#[derive(Debug, Clone, Copy)]
pub struct Range {
    pub min: f64,
    pub max: f64,
    pub default: f64,
}

pub const SPRINT_MPS: Range = Range { min: 3.0, max: 10.0, default: 6.3 };
/// Dacia without boost: 100 km/h is the author's placeholder until it is timed in game (U-3).
pub const DACIA_KMH: Range = Range { min: 20.0, max: 200.0, default: 100.0 };
/// Glass density of overlay panels and the HUD. The author chose lighter glass (2026-10-22);
/// text keeps a dark shadow so it stays readable over a light map below WCAG's 0.78.
pub const PANEL_OPACITY: Range = Range { min: 0.5, max: 0.94, default: 0.65 };
/// Version 1's default, replaced by the migration to version 2.
pub const PANEL_OPACITY_V1_DEFAULT: f64 = 0.86;
/// 80–200 %: at 200 % the main window still has no horizontal scrolling (plan/ux.md §7).
pub const UI_ZOOM: Range = Range { min: 0.8, max: 2.0, default: 1.0 };
pub const WIZARD_STEPS: u8 = 4;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct Hotkeys {
    pub near: String,
    pub far: String,
}

impl Default for Hotkeys {
    fn default() -> Self {
        Self { near: DEFAULT_NEAR.into(), far: DEFAULT_FAR.into() }
    }
}

impl Hotkeys {
    pub fn get(&self, preset: Preset) -> &str {
        match preset {
            Preset::Near => &self.near,
            Preset::Far => &self.far,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Speeds {
    pub sprint_mps: f64,
    pub dacia_kmh: f64,
    pub dacia_verified: bool,
}

impl Default for Speeds {
    fn default() -> Self {
        Self { sprint_mps: SPRINT_MPS.default, dacia_kmh: DACIA_KMH.default, dacia_verified: false }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "mode", rename_all = "lowercase")]
pub enum MonitorMode {
    Cursor,
    Pinned { pinned: MonitorRef },
}

/// A pinned monitor: found by name (`\\.\DISPLAY2`) first, then by position and size.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MonitorRef {
    pub name: String,
    pub x: i32,
    pub y: i32,
    pub w: u32,
    pub h: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct UpdatePrefs {
    pub enabled: bool,
    pub last_check_unix: i64,
    pub etag: Option<String>,
    pub latest: Option<String>,
    /// "Later" on Home for this version: its banner stays away until a newer one appears.
    pub dismissed: Option<String>,
    /// How the last check failed: Settings says so after a restart too.
    #[serde(skip_serializing_if = "Option::is_none", deserialize_with = "lenient_failure")]
    pub failed: Option<FetchError>,
}

impl Default for UpdatePrefs {
    fn default() -> Self {
        // On by default (author's answer О-6): once a day, said in the wizard and About.
        Self { enabled: true, last_check_unix: 0, etag: None, latest: None, dismissed: None, failed: None }
    }
}

/// A failure this Mapper does not know reads as none, instead of setting the config aside.
fn lenient_failure<'de, D: Deserializer<'de>>(d: D) -> Result<Option<FetchError>, D::Error> {
    Ok(serde_json::from_value(Value::deserialize(d)?).ok())
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct PresetCalibrations {
    #[serde(skip_serializing_if = "Option::is_none", deserialize_with = "lenient_calibration")]
    pub near: Option<Calibration>,
    #[serde(skip_serializing_if = "Option::is_none", deserialize_with = "lenient_calibration")]
    pub far: Option<Calibration>,
}

impl PresetCalibrations {
    pub fn get(&self, preset: Preset) -> Option<&Calibration> {
        match preset {
            Preset::Near => self.near.as_ref(),
            Preset::Far => self.far.as_ref(),
        }
    }

    pub fn set(&mut self, preset: Preset, value: Option<Calibration>) {
        match preset {
            Preset::Near => self.near = value,
            Preset::Far => self.far = value,
        }
    }

    pub fn is_empty(&self) -> bool {
        self.near.is_none() && self.far.is_none()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

/// One grid match: `cell_px` CSS px are `cell_meters` on the map. `w`, `h` and `scale` are the
/// overlay it was made on; it only applies to an overlay of the same size (±1 px).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Calibration {
    pub cell_meters: u32,
    pub cell_px: f64,
    pub origin: Point,
    pub w: f64,
    pub h: f64,
    pub scale: f64,
    pub created_at: String,
}

impl Calibration {
    pub fn fits(&self, w: f64, h: f64, scale: f64) -> bool {
        (self.w - w).abs() < 1.0 && (self.h - h).abs() < 1.0 && (self.scale - scale).abs() < 0.005
    }
}
