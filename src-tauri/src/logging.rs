//! Append-only log with rotation. Lines are sanitised (no control characters, bounded length)
//! and UI windows are rate-limited, so the log stays trustworthy evidence for bug reports.
//! Point coordinates, config contents and keys other than hotkey presses are never logged.

use std::borrow::Cow;
use std::collections::HashMap;
use std::fmt;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::Deserialize;

const FILE_NAME: &str = "mapper.log";
const ROTATED_NAME: &str = "mapper.1.log";
const MAX_FILE_BYTES: u64 = 1024 * 1024;
pub const MAX_LINE_CHARS: usize = 512;
const UI_LINES_PER_SECOND: u32 = 20;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Level {
    Info,
    Warn,
    Error,
}

impl fmt::Display for Level {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Level::Info => "INFO",
            Level::Warn => "WARN",
            Level::Error => "ERROR",
        })
    }
}

struct Logger {
    dir: PathBuf,
    state: Mutex<State>,
}

struct State {
    file: Option<File>,
    size: u64,
    limiter: RateLimiter,
}

static LOGGER: OnceLock<Logger> = OnceLock::new();
static SUMMARY: OnceLock<String> = OnceLock::new();

/// Start-up facts (versions, raw input, hotkeys) repeated at the top of every file after
/// rotation, so a noisy session cannot evict the evidence a bug report needs.
pub fn set_summary(summary: String) {
    let _ = SUMMARY.set(summary);
}

/// `C:\Users\<name>\…` becomes `%USERPROFILE%\…`: logs get attached to public issues.
pub fn display_path(path: &Path) -> String {
    mask_home(&path.display().to_string(), &std::env::var("USERPROFILE").unwrap_or_default())
}

fn mask_home(text: &str, home: &str) -> String {
    let n = home.len();
    if n > 0 && text.is_char_boundary(n) && text.get(..n).is_some_and(|start| start.eq_ignore_ascii_case(home)) {
        format!("%USERPROFILE%{}", &text[n..])
    } else {
        text.to_string()
    }
}

/// Opens `<dir>/mapper.log` for appending. Before `init` (and if it fails) lines go to stderr.
pub fn init(dir: &Path) -> io::Result<PathBuf> {
    fs::create_dir_all(dir)?;
    let path = dir.join(FILE_NAME);
    let file = OpenOptions::new().create(true).append(true).open(&path)?;
    let size = file.metadata().map(|m| m.len()).unwrap_or(0);
    let state = State { file: Some(file), size, limiter: RateLimiter::new(UI_LINES_PER_SECOND) };
    let _ = LOGGER.set(Logger { dir: dir.to_path_buf(), state: Mutex::new(state) });
    Ok(path)
}

pub fn path() -> Option<PathBuf> {
    LOGGER.get().map(|l| l.dir.join(FILE_NAME))
}

pub fn info(target: &str, msg: impl AsRef<str>) {
    write(Level::Info, target, msg.as_ref());
}

pub fn warn(target: &str, msg: impl AsRef<str>) {
    write(Level::Warn, target, msg.as_ref());
}

pub fn error(target: &str, msg: impl AsRef<str>) {
    write(Level::Error, target, msg.as_ref());
}

/// A line sent by a window through `log_line`; at most 20 per second per window.
pub fn ui(window: &str, level: Level, msg: &str) {
    let target = format!("ui/{window}");
    let Some(logger) = LOGGER.get() else {
        eprintln!("{}", format_line(SystemTime::now(), level, &target, msg));
        return;
    };
    let decision = {
        let mut state = logger.state.lock().unwrap_or_else(|e| e.into_inner());
        state.limiter.check(&target, Instant::now())
    };
    if let Some(dropped) = decision.dropped_before {
        write(Level::Warn, &target, &format!("{dropped} line(s) dropped by the rate limit"));
    }
    if decision.allow {
        write(level, &target, msg);
    }
}

fn write(level: Level, target: &str, msg: &str) {
    let line = format_line(SystemTime::now(), level, target, msg);
    let Some(logger) = LOGGER.get() else {
        eprintln!("{line}");
        return;
    };
    if cfg!(debug_assertions) {
        eprintln!("{line}");
    }
    // Nothing below panics while the lock is held, so the panic hook can log through here too.
    let mut state = logger.state.lock().unwrap_or_else(|e| e.into_inner());
    if state.size + line.len() as u64 + 1 > MAX_FILE_BYTES {
        rotate(&logger.dir, &mut state);
    } else if state.file.is_none() {
        // An earlier reopen failed; try again rather than going silent for the session.
        state.file = open_append(&logger.dir.join(FILE_NAME)).ok();
        state.size = state.file.as_ref().and_then(|f| f.metadata().ok()).map_or(0, |m| m.len());
    }
    append(&mut state, &line);
}

fn append(state: &mut State, line: &str) {
    if let Some(file) = state.file.as_mut() {
        if writeln!(file, "{line}").and_then(|_| file.flush()).is_ok() {
            state.size += line.len() as u64 + 1;
        }
    }
}

fn open_append(path: &Path) -> io::Result<File> {
    OpenOptions::new().create(true).append(true).open(path)
}

/// Keeps at most two files of `MAX_FILE_BYTES`. If the live file cannot be renamed (a viewer
/// holds it open without delete sharing), it is truncated instead so the cap still holds.
fn rotate(dir: &Path, state: &mut State) {
    state.file = None;
    state.size = 0;
    let live = dir.join(FILE_NAME);
    let _ = fs::remove_file(dir.join(ROTATED_NAME));
    match fs::rename(&live, dir.join(ROTATED_NAME)) {
        Ok(()) => state.file = open_append(&live).ok(),
        Err(err) => {
            state.file = OpenOptions::new().create(true).write(true).truncate(true).open(&live).ok();
            let note = format!("could not rotate the log ({err}); older lines were discarded");
            append(state, &format_line(SystemTime::now(), Level::Warn, "log", &note));
        }
    }
    if let Some(summary) = SUMMARY.get() {
        append(state, &format_line(SystemTime::now(), Level::Info, "app", &format!("session: {summary}")));
    }
}

pub fn format_line(at: SystemTime, level: Level, target: &str, msg: &str) -> String {
    format!("{} {level} {}: {}", utc_timestamp(at), sanitize(target), sanitize(msg))
}

/// Escapes control, line-separator and bidi characters and bounds the escaped length, so a
/// message can neither forge log lines nor display differently from what it contains.
pub fn sanitize(msg: &str) -> String {
    let mut out = String::with_capacity(msg.len().min(MAX_LINE_CHARS));
    let mut written = 0;
    let mut buf = [0u8; 4];
    for c in msg.chars() {
        let piece: Cow<'_, str> = match c {
            '\n' => "\\n".into(),
            '\r' => "\\r".into(),
            '\t' => "\\t".into(),
            c if needs_escape(c) => format!("\\u{{{:x}}}", c as u32).into(),
            c => (&*c.encode_utf8(&mut buf)).into(),
        };
        let width = piece.chars().count();
        if written + width > MAX_LINE_CHARS {
            out.push('…');
            break;
        }
        out.push_str(&piece);
        written += width;
    }
    out
}

fn needs_escape(c: char) -> bool {
    c.is_control()
        || matches!(c, '\u{061c}' | '\u{200e}' | '\u{200f}' | '\u{2028}'..='\u{202e}' | '\u{2066}'..='\u{2069}' | '\u{feff}')
}

/// `2026-10-20T18:04:11.512Z`
pub fn utc_timestamp(at: SystemTime) -> String {
    let since = at.duration_since(UNIX_EPOCH).unwrap_or_default();
    let secs = since.as_secs();
    let (year, month, day) = civil_from_days((secs / 86_400) as i64);
    let rem = secs % 86_400;
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{:03}Z",
        rem / 3600,
        (rem % 3600) / 60,
        rem % 60,
        since.subsec_millis()
    )
}

/// Days since 1970-01-01 → (year, month, day), proleptic Gregorian (H. Hinnant's algorithm).
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let month = (if mp < 10 { mp + 3 } else { mp - 9 }) as u32;
    let year = yoe + era * 400 + i64::from(month <= 2);
    (year, month, day)
}

/// Per-key budget of lines per one-second window, remembering how many were dropped.
struct RateLimiter {
    per_second: u32,
    windows: HashMap<String, Window>,
}

struct Window {
    started: Instant,
    count: u32,
    dropped: u32,
}

#[derive(Debug, PartialEq, Eq)]
struct Decision {
    allow: bool,
    /// Lines dropped in the previous window, reported once when a new window starts.
    dropped_before: Option<u32>,
}

impl RateLimiter {
    fn new(per_second: u32) -> Self {
        Self { per_second, windows: HashMap::new() }
    }

    fn check(&mut self, key: &str, now: Instant) -> Decision {
        let window = self.windows.entry(key.to_string()).or_insert(Window { started: now, count: 0, dropped: 0 });
        let mut dropped_before = None;
        if now.duration_since(window.started) >= Duration::from_secs(1) {
            if window.dropped > 0 {
                dropped_before = Some(window.dropped);
            }
            *window = Window { started: now, count: 0, dropped: 0 };
        }
        let allow = window.count < self.per_second;
        if allow {
            window.count += 1;
        } else {
            window.dropped += 1;
        }
        Decision { allow, dropped_before }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_utc_timestamps() {
        assert_eq!(utc_timestamp(UNIX_EPOCH), "1970-01-01T00:00:00.000Z");
        let at = UNIX_EPOCH + Duration::from_millis(1_704_067_200_000 + 3_723_045);
        assert_eq!(utc_timestamp(at), "2024-01-01T01:02:03.045Z");
        let leap = UNIX_EPOCH + Duration::from_secs(1_709_164_800); // 2024-02-29
        assert_eq!(utc_timestamp(leap), "2024-02-29T00:00:00.000Z");
    }

    #[test]
    fn escapes_control_characters() {
        assert_eq!(sanitize("a\nb\r\tc\u{1b}[31m"), "a\\nb\\r\\tc\\u{1b}[31m");
    }

    #[test]
    fn bounds_line_length() {
        let long = "x".repeat(MAX_LINE_CHARS + 50);
        let out = sanitize(&long);
        assert_eq!(out.chars().count(), MAX_LINE_CHARS + 1);
        assert!(out.ends_with('…'));
    }

    #[test]
    fn escapes_line_separators_and_bidi_controls() {
        assert_eq!(sanitize("a\u{2028}b\u{202e}c\u{2066}d"), "a\\u{2028}b\\u{202e}c\\u{2066}d");
    }

    #[test]
    fn bounds_the_escaped_length() {
        let out = sanitize(&"\u{1}".repeat(MAX_LINE_CHARS));
        assert!(out.chars().count() <= MAX_LINE_CHARS + 1, "escaping must not grow past the limit");
        assert!(out.ends_with('…'));
    }

    #[test]
    fn line_has_level_and_target() {
        let line = format_line(UNIX_EPOCH, Level::Warn, "ui/main", "hello\nforged");
        assert_eq!(line, "1970-01-01T00:00:00.000Z WARN ui/main: hello\\nforged");
    }

    #[test]
    fn rate_limit_drops_and_reports_once() {
        let mut limiter = RateLimiter::new(2);
        let t0 = Instant::now();
        assert!(limiter.check("ui/main", t0).allow);
        assert!(limiter.check("ui/main", t0).allow);
        assert!(!limiter.check("ui/main", t0).allow);
        assert!(!limiter.check("ui/main", t0).allow);
        assert!(limiter.check("ui/overlay", t0).allow, "windows are limited separately");
        let next = limiter.check("ui/main", t0 + Duration::from_secs(1));
        assert_eq!(next, Decision { allow: true, dropped_before: Some(2) });
        let after = limiter.check("ui/main", t0 + Duration::from_secs(1));
        assert_eq!(after.dropped_before, None);
    }

    #[test]
    fn rotation_keeps_one_old_file() {
        let dir = std::env::temp_dir().join(format!("mapper-log-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join(FILE_NAME), "old").unwrap();
        fs::write(dir.join(ROTATED_NAME), "older").unwrap();
        let mut state = State { file: None, size: 10, limiter: RateLimiter::new(1) };
        rotate(&dir, &mut state);
        assert_eq!(fs::read_to_string(dir.join(ROTATED_NAME)).unwrap(), "old");
        assert_eq!(fs::read_to_string(dir.join(FILE_NAME)).unwrap(), "");
        assert_eq!(state.size, 0);
        drop(state);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn masks_the_user_profile_in_paths() {
        let home = r"C:\Users\Анна";
        assert_eq!(
            mask_home(r"C:\Users\Анна\AppData\Local\dev.mapper.app\logs\mapper.log", home),
            r"%USERPROFILE%\AppData\Local\dev.mapper.app\logs\mapper.log"
        );
        assert_eq!(mask_home(r"c:\users\Анна\x", home), r"%USERPROFILE%\x", "drive letter case differs");
        assert_eq!(mask_home(r"D:\Games\x", home), r"D:\Games\x");
        assert_eq!(mask_home(r"D:\x", ""), r"D:\x");
    }

    #[test]
    fn rotation_truncates_when_a_viewer_blocks_the_rename() {
        use std::os::windows::fs::OpenOptionsExt;
        const FILE_SHARE_READ_WRITE: u32 = 0x1 | 0x2; // no FILE_SHARE_DELETE, like many viewers

        let dir = std::env::temp_dir().join(format!("mapper-log-busy-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join(FILE_NAME), "x".repeat(100)).unwrap();
        let viewer = OpenOptions::new().read(true).share_mode(FILE_SHARE_READ_WRITE).open(dir.join(FILE_NAME)).unwrap();
        let mut state = State { file: None, size: 100, limiter: RateLimiter::new(1) };
        rotate(&dir, &mut state);
        let live = fs::read_to_string(dir.join(FILE_NAME)).unwrap();
        assert!(live.contains("could not rotate the log"), "{live}");
        assert_eq!(state.size, live.len() as u64, "the size cap counts from the truncated file");
        drop((viewer, state));
        let _ = fs::remove_dir_all(&dir);
    }
}
