//! "Is there a new version?" (plan/eng.md §3 `update`, ux F-12): at most one request a day while
//! the player leaves it on (the first 30 s after start, then an hourly look at the clock), and
//! "Check now" at most once a minute. A failed check waits a day too, and what went wrong is
//! kept. Mapper only says that a version exists; the link opens the releases page, nothing is
//! downloaded.

pub mod github;
pub mod version;

use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Manager};

use self::github::{FetchError, Fetched};
use crate::app::timers::Timers;
use crate::app::{snapshot, tray};
use crate::config::{ConfigStore, UpdatePrefs};
use crate::logging;

const FIRST_CHECK: Duration = Duration::from_secs(30);
const TICK: Duration = Duration::from_secs(3600);
const DAY_S: i64 = 24 * 3600;
const MANUAL_GAP: Duration = Duration::from_secs(60);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum UpdateState {
    /// The repository is still the placeholder: no request is ever made.
    NoRepository,
    /// Automatic checks are off and none was made.
    Off,
    /// On, not checked yet.
    Idle,
    Checking,
    UpToDate,
    Available,
    Offline,
    RateLimited,
    BadResponse,
}

/// What the main window and the tray show (`AppSnapshot.update`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateView {
    pub state: UpdateState,
    /// The newest release seen (`v1.1.0`), when it is newer than this Mapper; offered on Home
    /// and in the tray also while a later check fails.
    pub latest: Option<String>,
    pub current: String,
    /// Unix seconds of the last answer or failure.
    pub checked_at: Option<i64>,
    /// "Later" on Home: the banner stays away until a newer version appears.
    pub dismissed: bool,
}

#[derive(Default)]
pub struct Updates(Mutex<Inner>);

#[derive(Default)]
struct Inner {
    checking: bool,
    last_manual: Option<Instant>,
    /// The last result when the config could not save it (read-only or locked). It still counts,
    /// so a failed write neither repeats the request every hour nor loses the answer.
    unsaved: Option<UpdatePrefs>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CheckRefused {
    NoRepository,
    /// "Check now" within a minute of the previous one.
    TooSoon,
}

impl Updates {
    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        self.0.lock().unwrap_or_else(|e| e.into_inner())
    }
}

fn now_s() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| i64::try_from(d.as_secs()).unwrap_or(i64::MAX))
}

/// A day since the last check, or a last check "in the future" (the clock was set back, or the
/// config came from another machine): that must not stop the checks until the clock catches up.
fn due(last_check_unix: i64, now: i64) -> bool {
    !(0..DAY_S).contains(&now.saturating_sub(last_check_unix))
}

/// The update settings, with a newer result that only this run knows.
fn prefs(app: &AppHandle) -> UpdatePrefs {
    let mut prefs = app.state::<ConfigStore>().get().updates;
    let updates = app.state::<Updates>();
    let inner = updates.lock();
    if let Some(memo) = inner.unsaved.as_ref().filter(|m| m.last_check_unix > prefs.last_check_unix) {
        prefs.last_check_unix = memo.last_check_unix;
        prefs.latest.clone_from(&memo.latest);
        prefs.etag.clone_from(&memo.etag);
        prefs.failed = memo.failed;
    }
    prefs
}

/// The state Settings shows: a failure is named first (a version found earlier is still offered
/// on Home and in the tray through `latest`).
fn state(prefs: &UpdatePrefs, newer: bool, checking: bool, repository_set: bool) -> UpdateState {
    if !repository_set {
        UpdateState::NoRepository
    } else if checking {
        UpdateState::Checking
    } else if let Some(failed) = prefs.failed {
        match failed {
            FetchError::Offline => UpdateState::Offline,
            FetchError::RateLimited => UpdateState::RateLimited,
            FetchError::BadResponse => UpdateState::BadResponse,
        }
    } else if newer {
        UpdateState::Available
    } else if prefs.last_check_unix > 0 {
        UpdateState::UpToDate
    } else if prefs.enabled {
        UpdateState::Idle
    } else {
        UpdateState::Off
    }
}

pub fn view(app: &AppHandle) -> UpdateView {
    let prefs = prefs(app);
    let current = env!("CARGO_PKG_VERSION").to_string();
    let latest = prefs.latest.clone().filter(|tag| version::is_newer(tag, &current));
    let checking = app.state::<Updates>().lock().checking;
    let state = state(&prefs, latest.is_some(), checking, github::repository_set());
    let checked = prefs.last_check_unix > 0;
    let dismissed = latest.is_some() && prefs.dismissed == latest;
    UpdateView { state, latest, current, checked_at: checked.then_some(prefs.last_check_unix), dismissed }
}

/// Starts the schedule, and shows a version found earlier in the tray: a start with Windows
/// opens no window that would refresh it.
pub fn start(app: &AppHandle) {
    tray::refresh(app);
    schedule(app, FIRST_CHECK);
}

fn schedule(app: &AppHandle, delay: Duration) {
    let handle = app.clone();
    app.state::<Timers>().schedule(delay, move || {
        let inner = handle.clone();
        let _ = handle.run_on_main_thread(move || {
            check_if_due(&inner);
            schedule(&inner, TICK);
        });
    });
}

/// An automatic check when one is due: from the schedule, and when the player turns checks on.
pub fn check_if_due(app: &AppHandle) {
    let prefs = prefs(app);
    if prefs.enabled && github::repository_set() && due(prefs.last_check_unix, now_s()) {
        begin(app);
    }
}

/// "Check now" in Settings.
pub fn check_now(app: &AppHandle) -> Result<(), CheckRefused> {
    if !github::repository_set() {
        return Err(CheckRefused::NoRepository);
    }
    let too_soon = app.state::<Updates>().lock().last_manual.is_some_and(|at| at.elapsed() < MANUAL_GAP);
    if too_soon {
        return Err(CheckRefused::TooSoon);
    }
    // A check already under way answers this click too; only a request that starts counts.
    if begin(app) {
        app.state::<Updates>().lock().last_manual = Some(Instant::now());
    }
    Ok(())
}

/// Starts a check on its own short-lived thread; false when one is already running.
fn begin(app: &AppHandle) -> bool {
    {
        let updates = app.state::<Updates>();
        let mut inner = updates.lock();
        if inner.checking {
            return false;
        }
        inner.checking = true;
    }
    snapshot::publish_soon(app);
    let etag = prefs(app).etag;
    let handle = app.clone();
    let spawned = std::thread::Builder::new().name("mapper-update".into()).spawn(move || {
        let outcome = github::fetch(etag.as_deref());
        let inner = handle.clone();
        let _ = handle.run_on_main_thread(move || finish(&inner, outcome));
    });
    if let Err(err) = spawned {
        logging::error("update", format!("check not started: {err}"));
        finish(app, Err(FetchError::Offline));
    }
    true
}

fn finish(app: &AppHandle, outcome: Result<Fetched, FetchError>) {
    let mut result = prefs(app);
    result.last_check_unix = now_s();
    result.failed = outcome.as_ref().err().copied();
    if let Ok(Fetched::Release { tag, etag }) = &outcome {
        result.latest.clone_from(tag);
        result.etag.clone_from(etag);
    }
    let saved = app.state::<ConfigStore>().update(|c| {
        c.updates.last_check_unix = result.last_check_unix;
        c.updates.latest.clone_from(&result.latest);
        c.updates.etag.clone_from(&result.etag);
        c.updates.failed = result.failed;
    });
    if let Err(err) = &saved {
        logging::warn("update", format!("check result kept for this run only (config not saved: {err})"));
    }
    {
        let updates = app.state::<Updates>();
        let mut inner = updates.lock();
        inner.checking = false;
        inner.unsaved = saved.is_err().then_some(result);
    }
    match &outcome {
        Ok(Fetched::NotModified) => logging::info("update", "no change since the last check (304)"),
        Ok(Fetched::Release { tag, .. }) => {
            logging::info("update", format!("latest release: {}", tag.as_deref().unwrap_or("none usable")));
        }
        Err(err) => logging::warn("update", format!("check failed: {err:?}; the next automatic one in a day")),
    }
    tray::refresh(app);
    snapshot::publish(app);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_check_is_due_after_a_day_or_after_the_clock_went_back() {
        let now = 1_800_000_000;
        assert!(due(0, now), "never checked");
        assert!(!due(now - 60, now));
        assert!(!due(now - DAY_S + 1, now));
        assert!(due(now - DAY_S, now));
        assert!(due(now + 3600, now), "a last check in the future");
    }

    #[test]
    fn settings_name_a_failure_first_also_after_a_restart() {
        let mut prefs = UpdatePrefs::default();
        assert_eq!(state(&prefs, false, false, false), UpdateState::NoRepository);
        assert_eq!(state(&prefs, false, false, true), UpdateState::Idle);
        prefs.enabled = false;
        assert_eq!(state(&prefs, false, false, true), UpdateState::Off);
        prefs.last_check_unix = 1_800_000_000;
        assert_eq!(state(&prefs, false, false, true), UpdateState::UpToDate);
        assert_eq!(state(&prefs, true, false, true), UpdateState::Available);
        prefs.failed = Some(FetchError::Offline);
        assert_eq!(state(&prefs, true, false, true), UpdateState::Offline, "never \"you have the latest\"");
        assert_eq!(state(&prefs, true, true, true), UpdateState::Checking);
    }

    #[test]
    fn an_unknown_failure_in_the_config_reads_as_none() {
        let prefs: UpdatePrefs = serde_json::from_str(r#"{"failed":"meteor","lastCheckUnix":5}"#).unwrap();
        assert_eq!((prefs.failed, prefs.last_check_unix), (None, 5));
        let prefs: UpdatePrefs = serde_json::from_str(r#"{"failed":"rateLimited"}"#).unwrap();
        assert_eq!(prefs.failed, Some(FetchError::RateLimited));
    }
}
