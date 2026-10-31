//! What the main window shows (plan/eng.md §4 `AppSnapshot`): settings, hotkeys, monitors and
//! their scales, the overlay right now, the last measurement, autostart. Commands of the main
//! window answer with it; `snapshot-changed` brings it while the window is visible, so a
//! hidden window costs nothing while the player is in game.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use super::overlay::{self, LastMeasurement, OverlayNow};
use super::timers::Timers;
use super::windows::MAIN;
use crate::config::{Calibration, Config, ConfigStore, Hotkeys, Language, MonitorKey, MonitorMode, Notice, Speeds};
use crate::hotkeys::{HotkeyService, HotkeyStatus, HotkeysState};
use crate::logging;
use crate::platform::win::autostart::{self, AutostartStatus};
use crate::update::{self, UpdateView};

pub const CHANGED: &str = "snapshot-changed";
/// `publish_soon` waits this long, so a burst of changes sends one snapshot.
const SOON: Duration = Duration::from_millis(50);

/// Increases with every snapshot built: the window drops one older than what it shows (a
/// command answer and an event can arrive out of order).
static REVISION: AtomicU64 = AtomicU64::new(0);
static PENDING: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSnapshot {
    pub revision: u64,
    pub version: String,
    pub read_only: bool,
    pub notices: Vec<Notice>,
    pub settings: Settings,
    pub hotkeys: HotkeysState,
    /// Connected monitors, for "always on this monitor".
    pub displays: Vec<Display>,
    /// Every monitor key with a scale, plus the connected ones, for the status cards.
    pub scales: Vec<MonitorScales>,
    /// A pinned monitor is set but not connected: the ruler opens under the cursor.
    pub pinned_missing: bool,
    /// The next press of this hotkey opens the scale setup instead of measuring.
    pub armed: Option<crate::preset::Preset>,
    /// An overlay session is open (wizard step 4 follows it).
    pub overlay: Option<OverlayNow>,
    pub last_measurement: Option<LastMeasurement>,
    pub autostart: AutostartStatus,
    pub update: UpdateView,
}

/// The config without bookkeeping fields (ETag, check times, raw calibrations).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub language: Language,
    pub hotkeys: Hotkeys,
    pub speeds: Speeds,
    pub panel_opacity: f64,
    pub monitor: MonitorMode,
    pub updates_enabled: bool,
    pub first_run_done: bool,
    pub wizard_step: u8,
    pub risk_accepted: bool,
    pub tray_hint_shown: bool,
    pub ui_zoom: f64,
}

impl From<&Config> for Settings {
    fn from(c: &Config) -> Self {
        Self {
            language: c.language,
            hotkeys: c.hotkeys.clone(),
            speeds: c.speeds,
            panel_opacity: c.panel_opacity,
            monitor: c.monitor.clone(),
            updates_enabled: c.updates.enabled,
            first_run_done: c.first_run_done,
            wizard_step: c.wizard_step,
            risk_accepted: c.risk_accepted,
            tray_hint_shown: c.tray_hint_shown,
            ui_zoom: c.ui_zoom,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Display {
    /// Windows' device name (`\\.\DISPLAY2`), what pinning stores.
    pub name: String,
    pub key: String,
    pub label: String,
    pub primary: bool,
    pub pinned: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorScales {
    pub key: String,
    pub label: String,
    pub connected: bool,
    pub primary: bool,
    pub near: Option<Calibration>,
    pub far: Option<Calibration>,
}

/// Connected monitors with their keys; one without a key (an absurd size) is left out.
fn displays(app: &AppHandle, monitor: &MonitorMode) -> Vec<(Display, MonitorKey)> {
    let primary = app.primary_monitor().ok().flatten().and_then(|m| m.name().cloned());
    let pinned = match monitor {
        MonitorMode::Pinned { pinned } => Some(pinned.name.clone()),
        MonitorMode::Cursor => None,
    };
    let monitors = app.available_monitors().unwrap_or_default();
    monitors
        .iter()
        .filter_map(|m| {
            let size = m.size();
            let key = MonitorKey::new(size.width, size.height, m.scale_factor())?;
            let name = m.name().cloned().unwrap_or_default();
            let display = Display {
                primary: primary.as_deref() == Some(name.as_str()),
                pinned: pinned.as_deref() == Some(name.as_str()),
                key: key.to_string(),
                label: key.label(),
                name,
            };
            Some((display, key))
        })
        .collect()
}

fn scales(config: &Config, displays: &[(Display, MonitorKey)]) -> Vec<MonitorScales> {
    let mut keys: Vec<MonitorKey> = displays.iter().map(|(_, key)| key.clone()).collect();
    keys.extend(config.calibrations.keys().cloned());
    keys.sort();
    keys.dedup();
    keys.into_iter()
        .map(|key| {
            let on = |d: &&(Display, MonitorKey)| d.1 == key;
            let entry = config.calibrations.get(&key);
            MonitorScales {
                connected: displays.iter().any(|d| on(&d)),
                primary: displays.iter().filter(on).any(|(d, _)| d.primary),
                near: entry.and_then(|e| e.near.clone()),
                far: entry.and_then(|e| e.far.clone()),
                label: key.label(),
                key: key.to_string(),
            }
        })
        .collect()
}

fn hotkeys(app: &AppHandle, config: &Config) -> HotkeysState {
    let fallback = |accelerator: &str| HotkeyStatus { accelerator: accelerator.into(), registered: false, error: None };
    app.try_state::<HotkeyService>().and_then(|s| s.state()).unwrap_or_else(|| HotkeysState {
        near: fallback(&config.hotkeys.near),
        far: fallback(&config.hotkeys.far),
        suspended: false,
    })
}

pub fn build(app: &AppHandle) -> AppSnapshot {
    let store = app.state::<ConfigStore>();
    let config = store.get();
    let shown = displays(app, &config.monitor);
    let pinned_missing = matches!(config.monitor, MonitorMode::Pinned { .. }) && !shown.iter().any(|(d, _)| d.pinned);
    let now = overlay::view(app);
    let exe = std::env::current_exe().unwrap_or_default();
    AppSnapshot {
        revision: REVISION.fetch_add(1, Ordering::SeqCst) + 1,
        version: app.package_info().version.to_string(),
        read_only: store.read_only(),
        notices: store.notices(),
        settings: Settings::from(&config),
        hotkeys: hotkeys(app, &config),
        scales: scales(&config, &shown),
        displays: shown.into_iter().map(|(d, _)| d).collect(),
        pinned_missing,
        armed: now.armed,
        overlay: now.session,
        last_measurement: now.last,
        autostart: autostart::status(&exe),
        update: update::view(app),
    }
}

/// Sends a fresh snapshot to the main window if it is on screen; a hidden one asks for it
/// with `get_snapshot` when it is shown again.
pub fn publish(app: &AppHandle) {
    let Some(win) = app.get_webview_window(MAIN) else { return };
    if !win.is_visible().unwrap_or(false) {
        return;
    }
    if let Err(err) = app.emit_to(MAIN, CHANGED, build(app)) {
        logging::warn("main", format!("{CHANGED} not delivered: {err}"));
    }
}

/// From code that must not be slowed down (the overlay activating). On the main thread
/// `run_on_main_thread` would run the closure at once, so the timer thread posts it a moment
/// later; calls in between are folded into that one snapshot.
pub fn publish_soon(app: &AppHandle) {
    if PENDING.swap(true, Ordering::SeqCst) {
        return;
    }
    let handle = app.clone();
    app.state::<Timers>().schedule(SOON, move || {
        let inner = handle.clone();
        let _ = handle.run_on_main_thread(move || {
            PENDING.store(false, Ordering::SeqCst);
            publish(&inner);
        });
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app::overlay::events::fixtures;
    use crate::app::overlay::result::sample;
    use crate::config::{MonitorRef, Point, PresetCalibrations};
    use crate::preset::Preset;

    fn calibration() -> Calibration {
        Calibration {
            cell_meters: 100,
            cell_px: 170.4,
            origin: Point { x: 512.0, y: 300.0 },
            w: 2048.0,
            h: 1151.2,
            scale: 1.25,
            created_at: "2026-10-21T18:04:11.512Z".into(),
        }
    }

    fn display(name: &str, key: &str, primary: bool) -> (Display, MonitorKey) {
        let key = MonitorKey::parse(key).unwrap();
        (Display { name: name.into(), key: key.to_string(), label: key.label(), primary, pinned: false }, key)
    }

    #[test]
    fn scales_list_connected_and_calibrated_monitors_once() {
        let mut config = Config::default();
        let old = MonitorKey::parse("1920x1080@100").unwrap();
        config.calibrations.insert(old, PresetCalibrations { near: Some(calibration()), far: None });
        let shown = [display(r"\\.\DISPLAY1", "2560x1440@125", true), display(r"\\.\DISPLAY2", "2560x1440@125", false)];
        let list = scales(&config, &shown);
        assert_eq!(list.len(), 2, "two identical monitors share one key");
        let current = list.iter().find(|s| s.key == "2560x1440@125").unwrap();
        assert!(current.connected && current.primary && current.near.is_none());
        let kept = list.iter().find(|s| s.key == "1920x1080@100").unwrap();
        assert!(!kept.connected && kept.near.is_some(), "a scale for an unplugged monitor is kept");
    }

    #[test]
    fn payload_matches_the_fixture() {
        let config = Config {
            language: Language::Ru,
            monitor: MonitorMode::Pinned {
                pinned: MonitorRef { name: r"\\.\DISPLAY2".into(), x: 2560, y: -480, w: 1080, h: 1920 },
            },
            ..Config::default()
        };
        let shown = [display(r"\\.\DISPLAY1", "2560x1440@125", true)];
        let snapshot = AppSnapshot {
            revision: 7,
            version: "0.1.0".into(),
            read_only: false,
            notices: vec![Notice::ConfigReset],
            settings: Settings::from(&config),
            hotkeys: HotkeysState {
                near: HotkeyStatus { accelerator: "Alt+Q".into(), registered: true, error: None },
                far: HotkeyStatus {
                    accelerator: "Alt+W".into(),
                    registered: false,
                    error: Some(crate::hotkeys::StatusError::Busy),
                },
                suspended: false,
            },
            scales: scales(&config, &shown),
            displays: shown.into_iter().map(|(d, _)| d).collect(),
            pinned_missing: true,
            armed: Some(Preset::Far),
            overlay: Some(OverlayNow { preset: Preset::Near, start: crate::app::overlay::events::Start::Calibrate }),
            last_measurement: Some(LastMeasurement {
                result: sample(),
                monitor_key: "2560x1440@125".into(),
                at: 1_792_919_290_104,
            }),
            autostart: AutostartStatus { enabled: true, approved_by_windows: false, path_matches: true },
            update: UpdateView {
                state: crate::update::UpdateState::Available,
                latest: Some("v1.1.0".into()),
                current: "0.1.0".into(),
                checked_at: Some(1_792_919_290),
                dismissed: false,
            },
        };
        fixtures::check("snapshot-changed", &snapshot);
    }
}
