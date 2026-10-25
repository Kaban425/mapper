//! `config.json` on disk. Writes are atomic (tmp → sync → rename); a broken file is kept as
//! `config.broken-<unix>.json` and Mapper starts with defaults; a file from a newer Mapper is
//! read but never overwritten. A file that is there but cannot be read or moved (a backup or
//! antivirus lock) is moved aside before the first write, never written over.

use std::fs::{self, File};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use serde_json::Value;

use super::{validate, Config, PANEL_OPACITY, PANEL_OPACITY_V1_DEFAULT, SCHEMA_VERSION};
use crate::logging;

const FILE_NAME: &str = "config.json";
const MAX_FILE_BYTES: u64 = 256 * 1024;

/// Shown once to the player (main window, Phase 3).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Notice {
    /// The file was broken; it was kept aside and the defaults are used.
    ConfigReset,
    /// Written by a newer Mapper: settings are read-only so it is not damaged.
    ConfigNewer,
    /// The file could not be read; the defaults are used and the file is kept aside before
    /// anything is saved.
    ConfigUnreadable,
}

/// Whether the file on disk may be written.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Access {
    Write,
    /// Written by a newer Mapper.
    ReadOnly,
    /// Still on disk but not read or not moved aside yet: moved before the first write.
    MoveFirst,
}

#[derive(Debug)]
pub enum StoreError {
    ReadOnly,
    Io(io::Error),
}

impl std::fmt::Display for StoreError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::ReadOnly => f.write_str("the config is read-only (written by a newer Mapper)"),
            Self::Io(err) => write!(f, "could not write the config: {err}"),
        }
    }
}

struct Inner {
    config: Config,
    access: Access,
    notices: Vec<Notice>,
}

pub struct ConfigStore {
    path: PathBuf,
    inner: Mutex<Inner>,
}

impl ConfigStore {
    /// Never fails: whatever is wrong with the file is logged and repaired.
    pub fn load(dir: &Path, defaults: Config) -> Self {
        let path = dir.join(FILE_NAME);
        let (config, access, notices) = read(&path, defaults);
        Self { path, inner: Mutex::new(Inner { config, access, notices }) }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn get(&self) -> Config {
        self.lock().config.clone()
    }

    pub fn read_only(&self) -> bool {
        self.lock().access == Access::ReadOnly
    }

    pub fn notices(&self) -> Vec<Notice> {
        self.lock().notices.clone()
    }

    /// Applies `change`, repairs the result and writes it before the new config is used.
    pub fn update(&self, change: impl FnOnce(&mut Config)) -> Result<Config, StoreError> {
        let mut inner = self.lock();
        match inner.access {
            Access::ReadOnly => return Err(StoreError::ReadOnly),
            Access::MoveFirst => {
                move_aside(&self.path).map_err(StoreError::Io)?;
                inner.access = Access::Write;
            }
            Access::Write => {}
        }
        let mut next = inner.config.clone();
        change(&mut next);
        let next = validate(next);
        write_atomic(&self.path, &next).map_err(StoreError::Io)?;
        inner.config = next.clone();
        Ok(next)
    }
}

type Loaded = (Config, Access, Vec<Notice>);

fn read(path: &Path, defaults: Config) -> Loaded {
    let text = match fs::metadata(path) {
        Err(err) if err.kind() == io::ErrorKind::NotFound => return (defaults, Access::Write, Vec::new()),
        Err(err) => return unreadable(defaults, &err),
        Ok(meta) if meta.len() > MAX_FILE_BYTES => return set_aside(path, defaults, "larger than 256 KiB"),
        Ok(_) => match fs::read_to_string(path) {
            Ok(text) => text,
            // Not broken, maybe only locked for a moment: left in place until the first write.
            Err(err) if err.kind() != io::ErrorKind::InvalidData => return unreadable(defaults, &err),
            Err(err) => return set_aside(path, defaults, &err.to_string()),
        },
    };
    let value: Value = match serde_json::from_str(&text) {
        Ok(value) => value,
        Err(err) => return set_aside(path, defaults, &err.to_string()),
    };
    let version = value.get("schemaVersion").and_then(Value::as_u64).unwrap_or(0);
    if version > u64::from(SCHEMA_VERSION) {
        logging::warn("config", format!("schema {version} is newer than {SCHEMA_VERSION}: read-only"));
        let config = serde_json::from_value(value).map(validate).unwrap_or(defaults);
        return (config, Access::ReadOnly, vec![Notice::ConfigNewer]);
    }
    match serde_json::from_value::<Config>(migrate(value, version)) {
        Ok(config) => (validate(config), Access::Write, Vec::new()),
        Err(err) => set_aside(path, defaults, &err.to_string()),
    }
}

/// Upgrades older schemas step by step; a file without a version counts as version 1.
fn migrate(value: Value, from: u64) -> Value {
    if from <= 1 {
        v1_to_v2(value)
    } else {
        value
    }
}

/// v2: lighter panels. A file that still holds version 1's default never had it changed by
/// the player (there was no setting yet), so it takes the new default.
fn v1_to_v2(mut value: Value) -> Value {
    if let Some(object) = value.as_object_mut() {
        let old_default = object
            .get("panelOpacity")
            .and_then(Value::as_f64)
            .is_some_and(|v| (v - PANEL_OPACITY_V1_DEFAULT).abs() < 1e-9);
        if old_default {
            object.insert("panelOpacity".into(), Value::from(PANEL_OPACITY.default));
        }
        object.insert("schemaVersion".into(), Value::from(2));
    }
    value
}

fn unreadable(defaults: Config, err: &io::Error) -> Loaded {
    logging::error("config", format!("cannot read the config ({err}); defaults until it can be moved aside"));
    (defaults, Access::MoveFirst, vec![Notice::ConfigUnreadable])
}

fn set_aside(path: &Path, defaults: Config, why: &str) -> Loaded {
    match move_aside(path) {
        Ok(()) => (defaults, Access::Write, vec![Notice::ConfigReset]),
        Err(err) => {
            logging::error("config", format!("config is broken ({why}) and could not be moved yet: {err}"));
            (defaults, Access::MoveFirst, vec![Notice::ConfigReset])
        }
    }
}

/// Keeps the current file as `config.broken-<unix>.json`; nothing to keep is fine too.
fn move_aside(path: &Path) -> io::Result<()> {
    let unix = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs());
    let backup = path.with_file_name(format!("config.broken-{unix}.json"));
    match fs::rename(path, &backup) {
        Ok(()) => {
            logging::warn("config", format!("previous config kept as {}", logging::display_path(&backup)));
            Ok(())
        }
        Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(err),
    }
}

fn write_atomic(path: &Path, config: &Config) -> io::Result<()> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    let tmp = path.with_extension("json.tmp");
    let bytes = serde_json::to_vec_pretty(config).map_err(io::Error::other)?;
    {
        let mut file = File::create(&tmp)?;
        file.write_all(&bytes)?;
        file.sync_all()?;
    }
    fs::rename(&tmp, path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{Language, MonitorKey};

    struct TempDir(PathBuf);

    impl TempDir {
        fn new(name: &str) -> Self {
            let dir = std::env::temp_dir().join(format!("mapper-config-{name}-{}", std::process::id()));
            let _ = fs::remove_dir_all(&dir);
            fs::create_dir_all(&dir).unwrap();
            Self(dir)
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn russian() -> Config {
        Config { language: Language::Ru, ..Config::default() }
    }

    #[test]
    fn a_missing_file_gives_the_defaults_without_writing() {
        let dir = TempDir::new("missing");
        let store = ConfigStore::load(&dir.0, russian());
        assert_eq!(store.get(), russian());
        assert!(!store.read_only());
        assert!(store.notices().is_empty());
        assert!(!dir.0.join(FILE_NAME).exists());
    }

    #[test]
    fn updates_are_written_validated_and_read_back() {
        let dir = TempDir::new("roundtrip");
        let store = ConfigStore::load(&dir.0, russian());
        let saved = store.update(|c| c.panel_opacity = 5.0).unwrap();
        assert_eq!(saved.panel_opacity, super::super::PANEL_OPACITY.max);
        assert!(!dir.0.join("config.json.tmp").exists(), "the temporary file is renamed");
        let again = ConfigStore::load(&dir.0, Config::default());
        assert_eq!(again.get(), saved);
    }

    #[test]
    fn a_broken_file_is_kept_aside_and_defaults_are_used() {
        let dir = TempDir::new("broken");
        fs::write(dir.0.join(FILE_NAME), "{ not json").unwrap();
        let store = ConfigStore::load(&dir.0, russian());
        assert_eq!(store.get(), russian());
        assert_eq!(store.notices(), vec![Notice::ConfigReset]);
        let backups: Vec<_> = fs::read_dir(&dir.0)
            .unwrap()
            .filter_map(|e| e.ok()?.file_name().into_string().ok())
            .filter(|name| name.starts_with("config.broken-"))
            .collect();
        assert_eq!(backups.len(), 1);
    }

    #[test]
    fn wrong_types_count_as_broken() {
        let dir = TempDir::new("types");
        fs::write(dir.0.join(FILE_NAME), r#"{"schemaVersion":1,"panelOpacity":"high"}"#).unwrap();
        assert_eq!(ConfigStore::load(&dir.0, russian()).notices(), vec![Notice::ConfigReset]);
    }

    #[test]
    fn an_oversized_file_counts_as_broken() {
        let dir = TempDir::new("big");
        fs::write(dir.0.join(FILE_NAME), " ".repeat(MAX_FILE_BYTES as usize + 1)).unwrap();
        assert_eq!(ConfigStore::load(&dir.0, russian()).notices(), vec![Notice::ConfigReset]);
    }

    #[test]
    fn a_newer_schema_is_read_only_and_left_untouched() {
        let dir = TempDir::new("newer");
        let text = r#"{"schemaVersion":99,"language":"ru","panelOpacity":0.8,"futureField":true}"#;
        fs::write(dir.0.join(FILE_NAME), text).unwrap();
        let store = ConfigStore::load(&dir.0, Config::default());
        assert!(store.read_only());
        assert_eq!(store.notices(), vec![Notice::ConfigNewer]);
        assert_eq!(store.get().panel_opacity, 0.8);
        assert!(matches!(store.update(|c| c.autostart = true), Err(StoreError::ReadOnly)));
        assert_eq!(fs::read_to_string(dir.0.join(FILE_NAME)).unwrap(), text);
    }

    fn backups(dir: &Path) -> Vec<PathBuf> {
        fs::read_dir(dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.path())
            .filter(|p| p.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.starts_with("config.broken-")))
            .collect()
    }

    #[test]
    fn a_locked_file_is_moved_aside_before_the_first_write_never_written_over() {
        use std::os::windows::fs::OpenOptionsExt;
        let dir = TempDir::new("locked");
        let file = dir.0.join(FILE_NAME);
        let text = r#"{"schemaVersion":2,"language":"ru","panelOpacity":0.8}"#;
        fs::write(&file, text).unwrap();
        // No sharing: what a backup tool or an antivirus scan can hold for a moment.
        let lock = fs::OpenOptions::new().read(true).share_mode(0).open(&file).unwrap();
        let store = ConfigStore::load(&dir.0, russian());
        assert_eq!(store.get(), russian());
        assert_eq!(store.notices(), vec![Notice::ConfigUnreadable]);
        assert!(!store.read_only());
        assert!(matches!(store.update(|c| c.autostart = true), Err(StoreError::Io(_))));
        drop(lock);
        assert_eq!(fs::read_to_string(&file).unwrap(), text, "untouched while it could not be kept");
        store.update(|c| c.autostart = true).unwrap();
        let kept = backups(&dir.0);
        assert_eq!(kept.len(), 1);
        assert_eq!(fs::read_to_string(&kept[0]).unwrap(), text);
        assert!(ConfigStore::load(&dir.0, Config::default()).get().autostart);
    }

    #[test]
    fn one_bad_calibration_drops_only_itself() {
        let dir = TempDir::new("lenient");
        let good = r#"{"cellMeters":100,"cellPx":170.4,"origin":{"x":1,"y":2},"w":2048,"h":1151.2,"scale":1.25,"createdAt":"2026-10-20T00:00:00Z"}"#;
        let text = format!(
            r#"{{"schemaVersion":2,"language":"ru","calibrations":{{
                "2560x1440@125":{{"near":{good},"far":{{"cellMeters":"big"}}}},
                "1920x1080@100":{{"near":{good}}},
                "huge-monitor":{{"near":{good}}},
                "1280x720@100":7
            }}}}"#
        );
        fs::write(dir.0.join(FILE_NAME), text).unwrap();
        let store = ConfigStore::load(&dir.0, Config::default());
        let config = store.get();
        assert!(store.notices().is_empty(), "not a broken file");
        assert_eq!(config.language, Language::Ru);
        assert_eq!(config.calibrations.len(), 2);
        let key = MonitorKey::parse("2560x1440@125").unwrap();
        assert!(config.calibration(&key, crate::preset::Preset::Near).is_some());
        assert!(config.calibration(&key, crate::preset::Preset::Far).is_none());
        let other = MonitorKey::parse("1920x1080@100").unwrap();
        assert!(config.calibration(&other, crate::preset::Preset::Near).is_some());
    }

    #[test]
    fn version_1_moves_to_the_lighter_panel_default_unless_changed() {
        let dir = TempDir::new("v1");
        fs::write(dir.0.join(FILE_NAME), r#"{"schemaVersion":1,"panelOpacity":0.86}"#).unwrap();
        let config = ConfigStore::load(&dir.0, Config::default()).get();
        assert_eq!(config.panel_opacity, PANEL_OPACITY.default);
        assert_eq!(config.schema_version, SCHEMA_VERSION);
        fs::write(dir.0.join(FILE_NAME), r#"{"schemaVersion":1,"panelOpacity":0.9}"#).unwrap();
        assert_eq!(ConfigStore::load(&dir.0, Config::default()).get().panel_opacity, 0.9);
    }

    #[test]
    fn missing_fields_take_their_defaults() {
        let dir = TempDir::new("partial");
        fs::write(dir.0.join(FILE_NAME), r#"{"language":"ru"}"#).unwrap();
        let config = ConfigStore::load(&dir.0, Config::default()).get();
        assert_eq!(config.language, Language::Ru);
        assert_eq!(config.speeds, super::super::Speeds::default());
        assert!(config.updates.enabled);
    }
}
