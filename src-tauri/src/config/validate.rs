//! Repairs a loaded config: values outside their range are clamped, invalid entries are
//! dropped or reset to defaults. Never fails, so a hand-edited file cannot stop Mapper.

use super::{
    Calibration, Config, Hotkeys, MonitorMode, Range, UpdatePrefs, DACIA_KMH, MAX_MONITORS, PANEL_OPACITY,
    SCHEMA_VERSION, SPRINT_MPS, UI_ZOOM, WIZARD_STEPS,
};
use crate::hotkeys::spec;
use crate::update::github;

pub const MIN_CELL_PX: f64 = 6.0;
pub const MAX_CELL_PX: f64 = 8000.0;
const MAX_VIEWPORT_PX: f64 = 20_000.0;
const MIN_VIEWPORT_PX: f64 = 100.0;
const MAX_ORIGIN_PX: f64 = 100_000.0;
const MAX_NAME_CHARS: usize = 64;
/// 9999-12-31: a later "last check" is no date JavaScript can show.
const MAX_UNIX: i64 = 253_402_300_799;

fn clamp(value: f64, range: Range) -> f64 {
    if value.is_finite() {
        value.clamp(range.min, range.max)
    } else {
        range.default
    }
}

pub fn validate(mut config: Config) -> Config {
    config.schema_version = SCHEMA_VERSION;
    config.speeds.sprint_mps = clamp(config.speeds.sprint_mps, SPRINT_MPS);
    config.speeds.dacia_kmh = clamp(config.speeds.dacia_kmh, DACIA_KMH);
    config.panel_opacity = clamp(config.panel_opacity, PANEL_OPACITY);
    config.ui_zoom = clamp(config.ui_zoom, UI_ZOOM);
    config.wizard_step = config.wizard_step.clamp(1, WIZARD_STEPS);
    config.hotkeys = valid_hotkeys(&config.hotkeys);
    if let MonitorMode::Pinned { pinned } = &config.monitor {
        if pinned.name.chars().count() > MAX_NAME_CHARS || pinned.w == 0 || pinned.h == 0 {
            config.monitor = MonitorMode::Cursor;
        }
    }
    config.updates = valid_updates(config.updates);
    keep_valid_calibrations(&mut config);
    config
}

/// Canonical spelling; an unparsable or duplicate pair goes back to Alt+Q / Alt+W.
fn valid_hotkeys(hotkeys: &Hotkeys) -> Hotkeys {
    let canonical = |text: &str| spec::parse(text).ok().map(spec::format);
    match (canonical(&hotkeys.near), canonical(&hotkeys.far)) {
        (Some(near), Some(far)) if near != far => Hotkeys { near, far },
        _ => Hotkeys::default(),
    }
}

fn valid_updates(mut updates: UpdatePrefs) -> UpdatePrefs {
    if !(0..=MAX_UNIX).contains(&updates.last_check_unix) {
        updates.last_check_unix = 0;
    }
    // An ETag goes back into a request header.
    if !updates.etag.as_deref().is_some_and(github::usable_etag) {
        updates.etag = None;
    }
    if !updates.latest.as_deref().is_some_and(is_version_tag) {
        updates.latest = None;
    }
    if !updates.dismissed.as_deref().is_some_and(is_version_tag) {
        updates.dismissed = None;
    }
    updates
}

/// `v1.2.3` (the update check stores only tags of this shape).
fn is_version_tag(text: &str) -> bool {
    crate::update::version::parse_tag(text).is_some()
}

pub fn is_valid_calibration(c: &Calibration) -> bool {
    let within = |value: f64, min: f64, max: f64| value.is_finite() && (min..=max).contains(&value);
    matches!(c.cell_meters, 100 | 1000)
        && within(c.cell_px, MIN_CELL_PX, MAX_CELL_PX)
        && within(c.w, MIN_VIEWPORT_PX, MAX_VIEWPORT_PX)
        && within(c.h, MIN_VIEWPORT_PX, MAX_VIEWPORT_PX)
        && within(c.scale, 0.5, 5.0)
        && within(c.origin.x, -MAX_ORIGIN_PX, MAX_ORIGIN_PX)
        && within(c.origin.y, -MAX_ORIGIN_PX, MAX_ORIGIN_PX)
        && c.created_at.len() <= 40
}

/// Drops invalid scales and empty monitors; keeps the 16 most recently calibrated monitors.
fn keep_valid_calibrations(config: &mut Config) {
    for entry in config.calibrations.values_mut() {
        for preset in crate::preset::Preset::ALL {
            if entry.get(preset).is_some_and(|c| !is_valid_calibration(c)) {
                entry.set(preset, None);
            }
        }
    }
    config.calibrations.retain(|_, entry| !entry.is_empty());
    while config.calibrations.len() > MAX_MONITORS {
        let newest = |entry: &super::PresetCalibrations| {
            [entry.near.as_ref(), entry.far.as_ref()].into_iter().flatten().map(|c| c.created_at.clone()).max()
        };
        let oldest = config.calibrations.iter().min_by_key(|(_, entry)| newest(entry)).map(|(key, _)| key.clone());
        if let Some(key) = oldest {
            config.calibrations.remove(&key);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{MonitorKey, MonitorRef, Point, PresetCalibrations};

    fn key(width: u32, height: u32, scale: f64) -> MonitorKey {
        MonitorKey::new(width, height, scale).unwrap()
    }

    fn calibration(created_at: &str) -> Calibration {
        Calibration {
            cell_meters: 100,
            cell_px: 170.4,
            origin: Point { x: 10.0, y: 20.0 },
            w: 2048.0,
            h: 1151.2,
            scale: 1.25,
            created_at: created_at.into(),
        }
    }

    #[test]
    fn clamps_numbers_and_repairs_non_finite_values() {
        let mut config = Config::default();
        config.speeds.sprint_mps = 50.0;
        config.speeds.dacia_kmh = f64::NAN;
        config.panel_opacity = 0.1;
        config.schema_version = 0;
        config.ui_zoom = 9.0;
        config.wizard_step = 0;
        let fixed = validate(config);
        assert_eq!(fixed.ui_zoom, UI_ZOOM.max);
        assert_eq!(fixed.wizard_step, 1);
        assert_eq!(fixed.speeds.sprint_mps, SPRINT_MPS.max);
        assert_eq!(fixed.speeds.dacia_kmh, DACIA_KMH.default);
        assert_eq!(fixed.panel_opacity, PANEL_OPACITY.min);
        assert_eq!(fixed.schema_version, SCHEMA_VERSION);
    }

    #[test]
    fn hotkeys_are_canonical_and_never_equal() {
        let with = |near: &str, far: &str| Config {
            hotkeys: Hotkeys { near: near.into(), far: far.into() },
            ..Config::default()
        };
        let canonical = Hotkeys { near: "Alt+Shift+Q".into(), far: "Ctrl+F9".into() };
        assert_eq!(validate(with("alt+shift+q", "Ctrl+F9")).hotkeys, canonical);
        assert_eq!(validate(with("Alt+W", "alt+w")).hotkeys, Hotkeys::default());
        assert_eq!(validate(with("Q", "Alt+W")).hotkeys, Hotkeys::default());
    }

    #[test]
    fn drops_broken_calibrations_and_empty_monitors() {
        let mut config = Config::default();
        let monitor = key(2560, 1440, 1.25);
        let mut bad = calibration("2026-10-20T00:00:00Z");
        bad.cell_meters = 500;
        let entry = PresetCalibrations { near: Some(calibration("2026-10-20T00:00:00Z")), far: Some(bad) };
        config.calibrations.insert(monitor.clone(), entry);
        let mut nan = calibration("x");
        nan.cell_px = f64::INFINITY;
        config.calibrations.insert(key(1920, 1080, 1.0), PresetCalibrations { near: Some(nan), far: None });
        let fixed = validate(config);
        assert_eq!(fixed.calibrations.len(), 1);
        assert!(fixed.calibrations[&monitor].near.is_some());
        assert!(fixed.calibrations[&monitor].far.is_none());
    }

    #[test]
    fn keeps_the_sixteen_most_recent_monitors() {
        let mut config = Config::default();
        for i in 0..20u32 {
            let entry =
                PresetCalibrations { near: Some(calibration(&format!("2026-10-{:02}T00:00:00Z", i + 1))), far: None };
            config.calibrations.insert(key(1000 + i, 1000, 1.0), entry);
        }
        let fixed = validate(config);
        assert_eq!(fixed.calibrations.len(), MAX_MONITORS);
        assert!(!fixed.calibrations.contains_key(&key(1000, 1000, 1.0)), "the oldest went first");
        assert!(fixed.calibrations.contains_key(&key(1019, 1000, 1.0)));
    }

    #[test]
    fn repairs_update_and_monitor_settings() {
        let mut config = Config::default();
        config.updates.latest = Some("https://evil.example".into());
        config.updates.last_check_unix = -5;
        config.updates.etag = Some("\"abc\"\r\nX-Injected: 1".into());
        let mut far = validate(Config::default());
        far.updates.last_check_unix = 9_007_199_254_740_993;
        assert_eq!(validate(far).updates.last_check_unix, 0, "not a date JavaScript can show");
        config.monitor = MonitorMode::Pinned { pinned: MonitorRef { name: "x".repeat(100), x: 0, y: 0, w: 1, h: 1 } };
        let fixed = validate(config);
        assert_eq!(fixed.updates.latest, None);
        assert_eq!(fixed.updates.last_check_unix, 0);
        assert_eq!(fixed.updates.etag, None, "control characters never reach a header");
        assert_eq!(fixed.monitor, MonitorMode::Cursor);
        assert!(is_version_tag("v1.10.0"));
        assert!(!is_version_tag("1.0.0"));
        assert!(!is_version_tag("v1.0"));
    }
}
