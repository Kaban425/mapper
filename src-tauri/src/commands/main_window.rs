//! Commands of the main window (plan/eng.md §4). Each answers with the new `AppSnapshot`, so
//! the window always shows what Rust holds. Values out of range are refused, not clamped:
//! the window says so under the field and nothing is saved (plan/ux.md M-6).

use serde::Deserialize;
use tauri::{AppHandle, Manager, WebviewWindow};

use super::{expect_window, ErrorCode, IpcError};
use crate::app::snapshot::{self, AppSnapshot};
use crate::app::windows::MAIN;
use crate::app::{main_window, overlay, tray};
use crate::config::{
    Config, ConfigStore, Language, MonitorKey, MonitorMode, MonitorRef, Range, Speeds, DACIA_KMH, PANEL_OPACITY,
    SPRINT_MPS, UI_ZOOM, WIZARD_STEPS,
};
use crate::hotkeys::{spec, HotkeyError, HotkeyService, DEFAULT_FAR, DEFAULT_NEAR};
use crate::logging;
use crate::platform::win::autostart::{self, AutostartError};
use crate::platform::win::shell::{self, Link, OwnFolder};
use crate::preset::Preset;
use crate::update::{self, CheckRefused};

/// Longest accelerator text accepted ("Ctrl+Alt+Shift+PageDown" is 23).
const MAX_ACCELERATOR_CHARS: usize = 32;
const MAX_DISPLAY_NAME_CHARS: usize = 64;

/// What the window may change in one call; hotkeys and autostart have their own commands.
#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SettingsPatch {
    pub language: Option<Language>,
    pub sprint_mps: Option<f64>,
    /// A value the player typed: the "not verified" mark goes away.
    pub dacia_kmh: Option<f64>,
    /// Back to the default speeds (Dacia "not verified" again).
    pub reset_speeds: Option<bool>,
    pub panel_opacity: Option<f64>,
    pub monitor: Option<MonitorChoice>,
    pub updates_enabled: Option<bool>,
    pub first_run_done: Option<bool>,
    pub wizard_step: Option<u8>,
    pub risk_accepted: Option<bool>,
    pub ui_zoom: Option<f64>,
    /// "Later" on the update banner, with the version it showed: only that one is put off.
    pub dismiss_update: Option<String>,
}

/// A pinned monitor is named; Rust fills in its position and size from the connected ones.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(tag = "mode", rename_all = "lowercase", deny_unknown_fields)]
pub enum MonitorChoice {
    Cursor,
    Pinned { name: String },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ResetTarget {
    Near,
    Far,
    Both,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Folder {
    Config,
    Logs,
}

fn in_range(value: Option<f64>, range: Range) -> bool {
    value.is_none_or(|v| v.is_finite() && (range.min..=range.max).contains(&v))
}

impl SettingsPatch {
    fn is_valid(&self) -> bool {
        in_range(self.sprint_mps, SPRINT_MPS)
            && in_range(self.dacia_kmh, DACIA_KMH)
            && in_range(self.panel_opacity, PANEL_OPACITY)
            && in_range(self.ui_zoom, UI_ZOOM)
            && self.wizard_step.is_none_or(|s| (1..=WIZARD_STEPS).contains(&s))
            && self.reset_speeds.is_none_or(|r| r)
            && self.dismiss_update.as_deref().is_none_or(|tag| update::version::parse_tag(tag).is_some())
            && match &self.monitor {
                Some(MonitorChoice::Pinned { name }) => {
                    !name.is_empty() && name.chars().count() <= MAX_DISPLAY_NAME_CHARS
                }
                _ => true,
            }
    }

    /// `pinned`: the connected monitor a `Pinned` choice names.
    fn apply(self, config: &mut Config, pinned: Option<MonitorRef>) {
        if let Some(language) = self.language {
            config.language = language;
        }
        if self.reset_speeds == Some(true) {
            config.speeds = Speeds::default();
        }
        if let Some(sprint) = self.sprint_mps {
            config.speeds.sprint_mps = sprint;
        }
        if let Some(dacia) = self.dacia_kmh {
            config.speeds.dacia_kmh = dacia;
            config.speeds.dacia_verified = true;
        }
        if let Some(opacity) = self.panel_opacity {
            config.panel_opacity = opacity;
        }
        match self.monitor {
            Some(MonitorChoice::Cursor) => config.monitor = MonitorMode::Cursor,
            Some(MonitorChoice::Pinned { .. }) => {
                if let Some(pinned) = pinned {
                    config.monitor = MonitorMode::Pinned { pinned };
                }
            }
            None => {}
        }
        if let Some(enabled) = self.updates_enabled {
            config.updates.enabled = enabled;
        }
        if let Some(done) = self.first_run_done {
            config.first_run_done = done;
        }
        if let Some(step) = self.wizard_step {
            config.wizard_step = step;
        }
        if let Some(accepted) = self.risk_accepted {
            config.risk_accepted = accepted;
        }
        if let Some(zoom) = self.ui_zoom {
            config.ui_zoom = zoom;
        }
        // A check that finished meanwhile may have found a newer version: that one stays offered.
        if let Some(tag) = self.dismiss_update.filter(|tag| config.updates.latest.as_ref() == Some(tag)) {
            config.updates.dismissed = Some(tag);
        }
    }
}

const fn invalid() -> IpcError {
    IpcError::new(ErrorCode::InvalidInput)
}

fn io_error(action: &str, err: impl std::fmt::Display) -> IpcError {
    logging::error("main", format!("{action} failed: {err}"));
    IpcError::new(ErrorCode::Io)
}

fn connected_monitor(app: &AppHandle, name: &str) -> Option<MonitorRef> {
    let monitors = app.available_monitors().ok()?;
    let m = monitors.iter().find(|m| m.name().is_some_and(|n| n == name))?;
    let (p, s) = (m.position(), m.size());
    Some(MonitorRef { name: name.to_string(), x: p.x, y: p.y, w: s.width, h: s.height })
}

#[tauri::command]
pub fn get_snapshot(window: WebviewWindow, app: AppHandle) -> Result<AppSnapshot, IpcError> {
    expect_window(&window, &[MAIN])?;
    Ok(snapshot::build(&app))
}

#[tauri::command]
pub fn update_settings(window: WebviewWindow, app: AppHandle, patch: SettingsPatch) -> Result<AppSnapshot, IpcError> {
    expect_window(&window, &[MAIN])?;
    if !patch.is_valid() {
        return Err(invalid());
    }
    let pinned = match &patch.monitor {
        Some(MonitorChoice::Pinned { name }) => Some(connected_monitor(&app, name).ok_or_else(invalid)?),
        _ => None,
    };
    let store = app.state::<ConfigStore>();
    let before = store.get();
    // The wizard is done only after the risk text was acknowledged (wizard step 2).
    let risk_accepted = patch.risk_accepted.unwrap_or(before.risk_accepted);
    if patch.first_run_done == Some(true) && !risk_accepted {
        return Err(invalid());
    }
    let config = store.update(|c| patch.apply(c, pinned))?;
    if config.updates.enabled && !before.updates.enabled {
        update::check_if_due(&app);
    }
    if config.language != before.language {
        logging::info("main", format!("language: {:?}", config.language));
        tray::refresh(&app);
    }
    // WebView2's own zoom: the layout adapts like browser zoom (CSS zoom would not shrink 100vh).
    if config.ui_zoom != before.ui_zoom {
        if let Err(err) = window.set_zoom(config.ui_zoom) {
            logging::warn("main", format!("zoom not applied: {err}"));
        }
    }
    Ok(snapshot::build(&app))
}

#[tauri::command]
pub fn set_hotkey(
    window: WebviewWindow,
    app: AppHandle,
    preset: Preset,
    accelerator: String,
) -> Result<AppSnapshot, IpcError> {
    expect_window(&window, &[MAIN])?;
    if accelerator.chars().count() > MAX_ACCELERATOR_CHARS {
        return Err(invalid());
    }
    let hotkey_invalid = IpcError::new(ErrorCode::HotkeyInvalid);
    let parsed = spec::parse(&accelerator).map_err(|_| hotkey_invalid)?;
    spec::check_recordable(parsed).map_err(|_| hotkey_invalid)?;
    let store = app.state::<ConfigStore>();
    if store.read_only() {
        return Err(IpcError::new(ErrorCode::ReadOnly));
    }
    let service = app.try_state::<HotkeyService>().ok_or(IpcError::new(ErrorCode::Io))?;
    let old = store.get().hotkeys;
    service.set(preset, parsed).map_err(hotkey_error)?;
    let text = spec::format(parsed);
    let saved = store.update(|c| match preset {
        Preset::Near => c.hotkeys.near = text.clone(),
        Preset::Far => c.hotkeys.far = text.clone(),
    });
    if let Err(err) = saved {
        // Not saved: the old combination comes back, so the next start agrees with the window.
        if let Ok(previous) = spec::parse(old.get(preset)) {
            let _ = service.set(preset, previous);
        }
        return Err(err.into());
    }
    logging::info("hotkeys", format!("{} is now {text}", preset.as_str()));
    tray::refresh(&app);
    Ok(snapshot::build(&app))
}

fn hotkey_error(err: HotkeyError) -> IpcError {
    match err {
        HotkeyError::Busy => IpcError::new(ErrorCode::HotkeyBusy),
        HotkeyError::Conflict => IpcError::new(ErrorCode::HotkeyConflict),
        HotkeyError::Unavailable => io_error("hotkeys", "the hotkey thread did not answer"),
    }
}

/// "Defaults": Alt+Q and Alt+W together, so a swapped pair can come back too.
#[tauri::command]
pub fn reset_hotkeys(window: WebviewWindow, app: AppHandle) -> Result<AppSnapshot, IpcError> {
    expect_window(&window, &[MAIN])?;
    let store = app.state::<ConfigStore>();
    if store.read_only() {
        return Err(IpcError::new(ErrorCode::ReadOnly));
    }
    let defaults = [spec::parse(DEFAULT_NEAR), spec::parse(DEFAULT_FAR)];
    let [Ok(near), Ok(far)] = defaults else { return Err(io_error("reset_hotkeys", "defaults do not parse")) };
    let service = app.try_state::<HotkeyService>().ok_or(IpcError::new(ErrorCode::Io))?;
    service.set_both([near, far]).map_err(hotkey_error)?;
    store.update(|c| c.hotkeys = crate::config::Hotkeys::default())?;
    logging::info("hotkeys", "back to the defaults");
    tray::refresh(&app);
    Ok(snapshot::build(&app))
}

#[tauri::command]
pub fn suspend_hotkeys(window: WebviewWindow, app: AppHandle, suspended: bool) -> Result<AppSnapshot, IpcError> {
    expect_window(&window, &[MAIN])?;
    // A pause only while the player is at Mapper's window: a background page cannot keep the
    // hotkeys off during a match.
    if suspended && !window.is_focused().unwrap_or(false) {
        return Err(IpcError::new(ErrorCode::NotAllowed));
    }
    let answered = if suspended { main_window::suspend_hotkeys(&app) } else { main_window::resume_hotkeys(&app) };
    answered.ok_or_else(|| io_error("suspend_hotkeys", "the hotkey thread did not answer"))?;
    Ok(snapshot::build(&app))
}

#[tauri::command]
pub fn arm_calibration(window: WebviewWindow, app: AppHandle, preset: Option<Preset>) -> Result<AppSnapshot, IpcError> {
    expect_window(&window, &[MAIN])?;
    overlay::arm(&app, preset);
    Ok(snapshot::build(&app))
}

#[tauri::command]
pub fn reset_calibration(
    window: WebviewWindow,
    app: AppHandle,
    monitor_key: String,
    preset: ResetTarget,
) -> Result<AppSnapshot, IpcError> {
    expect_window(&window, &[MAIN])?;
    let key = MonitorKey::parse(&monitor_key).ok_or_else(invalid)?;
    let store = app.state::<ConfigStore>();
    let held = store.get().calibrations.get(&key).cloned().unwrap_or_default();
    let exists = match preset {
        ResetTarget::Near => held.near.is_some(),
        ResetTarget::Far => held.far.is_some(),
        ResetTarget::Both => !held.is_empty(),
    };
    if !exists {
        return Err(invalid());
    }
    store.update(|c| {
        if let Some(entry) = c.calibrations.get_mut(&key) {
            if preset != ResetTarget::Far {
                entry.near = None;
            }
            if preset != ResetTarget::Near {
                entry.far = None;
            }
        }
    })?;
    logging::info("main", format!("scale reset: {key} {preset:?}"));
    Ok(snapshot::build(&app))
}

#[tauri::command]
pub fn set_autostart(window: WebviewWindow, app: AppHandle, enabled: bool) -> Result<AppSnapshot, IpcError> {
    expect_window(&window, &[MAIN])?;
    let exe = std::env::current_exe().map_err(|err| io_error("set_autostart", err))?;
    autostart::set(&exe, enabled).map_err(|err| match err {
        AutostartError::TooLong => IpcError::new(ErrorCode::PathTooLong),
        AutostartError::Os(err) => io_error("set_autostart", err),
    })?;
    logging::info("main", format!("start with Windows: {enabled}"));
    // The registry is the source of truth; the config only mirrors it.
    if let Err(err) = app.state::<ConfigStore>().update(|c| c.autostart = enabled) {
        logging::warn("config", format!("autostart not mirrored: {err}"));
    }
    Ok(snapshot::build(&app))
}

/// "Check now": at most once a minute; the answer comes with `snapshot-changed`.
#[tauri::command]
pub fn check_update_now(window: WebviewWindow, app: AppHandle) -> Result<AppSnapshot, IpcError> {
    expect_window(&window, &[MAIN])?;
    update::check_now(&app).map_err(|refused| match refused {
        CheckRefused::NoRepository => IpcError::new(ErrorCode::NotAllowed),
        CheckRefused::TooSoon => IpcError::new(ErrorCode::RateLimited),
    })?;
    Ok(snapshot::build(&app))
}

#[tauri::command]
pub fn open_link(window: WebviewWindow, link: Link) -> Result<(), IpcError> {
    expect_window(&window, &[MAIN])?;
    shell::open_link(link).map_err(|err| io_error("open_link", err))
}

#[tauri::command]
pub fn open_folder(window: WebviewWindow, app: AppHandle, folder: Folder) -> Result<(), IpcError> {
    expect_window(&window, &[MAIN])?;
    let own = match folder {
        Folder::Config => OwnFolder::config(&app),
        Folder::Logs => OwnFolder::logs(&app),
    }
    .map_err(|err| io_error("open_folder", err))?;
    shell::open_folder(&own).map_err(|err| io_error("open_folder", err))
}

/// "Got it" in the tray dialog.
#[tauri::command]
pub fn hide_main_window(window: WebviewWindow, app: AppHandle) -> Result<(), IpcError> {
    expect_window(&window, &[MAIN])?;
    main_window::hide_to_tray(&app);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn patch(json: &str) -> SettingsPatch {
        serde_json::from_str(json).unwrap()
    }

    #[test]
    fn a_patch_changes_only_what_it_names() {
        let mut config = Config::default();
        patch(r#"{"language":"ru","daciaKmh":95,"wizardStep":3}"#).apply(&mut config, None);
        assert_eq!(config.language, Language::Ru);
        assert_eq!(config.speeds.dacia_kmh, 95.0);
        assert!(config.speeds.dacia_verified, "the player's own value");
        assert_eq!(config.wizard_step, 3);
        assert_eq!(config.panel_opacity, PANEL_OPACITY.default);
        patch(r#"{"resetSpeeds":true}"#).apply(&mut config, None);
        assert_eq!(config.speeds, Speeds::default());
        config.updates.latest = Some("v1.1.0".into());
        patch(r#"{"dismissUpdate":"v1.0.9"}"#).apply(&mut config, None);
        assert_eq!(config.updates.dismissed, None, "not the version found now");
        patch(r#"{"dismissUpdate":"v1.1.0"}"#).apply(&mut config, None);
        assert_eq!(config.updates.dismissed.as_deref(), Some("v1.1.0"));
    }

    #[test]
    fn out_of_range_values_are_refused() {
        for bad in [
            r#"{"sprintMps":11}"#,
            r#"{"daciaKmh":-1}"#,
            r#"{"panelOpacity":0.2}"#,
            r#"{"uiZoom":3}"#,
            r#"{"wizardStep":5}"#,
            r#"{"wizardStep":0}"#,
            r#"{"resetSpeeds":false}"#,
            r#"{"dismissUpdate":"latest"}"#,
            r#"{"monitor":{"mode":"pinned","name":""}}"#,
        ] {
            assert!(!patch(bad).is_valid(), "{bad}");
        }
        assert!(patch(r#"{"sprintMps":6.3,"panelOpacity":0.5,"uiZoom":2}"#).is_valid());
    }

    #[test]
    fn unknown_fields_and_values_are_refused() {
        for bad in [
            r#"{"hotkeys":{"near":"Alt+Q"}}"#,
            r#"{"monitor":{"mode":"pinned","name":"x","x":5}}"#,
            r#"{"monitor":{"mode":"everywhere"}}"#,
            r#"{"language":"de"}"#,
            r#"{"autostart":true}"#,
        ] {
            assert!(serde_json::from_str::<SettingsPatch>(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn a_pinned_choice_takes_the_connected_monitor() {
        let mut config = Config::default();
        let pinned = MonitorRef { name: r"\\.\DISPLAY2".into(), x: 2560, y: -480, w: 1080, h: 1920 };
        patch(r#"{"monitor":{"mode":"pinned","name":"\\\\.\\DISPLAY2"}}"#).apply(&mut config, Some(pinned.clone()));
        assert_eq!(config.monitor, MonitorMode::Pinned { pinned });
        patch(r#"{"monitor":{"mode":"cursor"}}"#).apply(&mut config, None);
        assert_eq!(config.monitor, MonitorMode::Cursor);
    }
}
