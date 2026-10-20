//! Minimal append-only log for spike measurements (one line per event, flushed at once).

use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

struct Logger {
    start: Instant,
    file: Mutex<Option<File>>,
    path: PathBuf,
}

static LOGGER: OnceLock<Logger> = OnceLock::new();

pub fn init(dir: &Path) -> PathBuf {
    let path = dir.join("spike.log");
    let file = fs::create_dir_all(dir)
        .and_then(|_| OpenOptions::new().create(true).append(true).open(&path))
        .ok();
    let logger = LOGGER.get_or_init(|| Logger { start: Instant::now(), file: Mutex::new(file), path: path.clone() });
    let epoch = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    line(format!("=== session start (unix {epoch}) ==="));
    logger.path.clone()
}

pub fn path() -> Option<PathBuf> {
    LOGGER.get().map(|l| l.path.clone())
}

pub fn line(msg: impl AsRef<str>) {
    let Some(logger) = LOGGER.get() else {
        eprintln!("{}", msg.as_ref());
        return;
    };
    let text = format!("[{:>9.3}] {}\n", logger.start.elapsed().as_secs_f64(), msg.as_ref());
    eprint!("{text}");
    let mut guard = logger.file.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(file) = guard.as_mut() {
        let _ = file.write_all(text.as_bytes());
        let _ = file.flush();
    }
}
