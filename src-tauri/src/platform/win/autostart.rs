//! "Start with Windows" for the current user: a value under HKCU\…\Run holding
//! `"<exe>" --autostart`. No administrator rights, no plugin. The only file with registry calls
//! (checked by the guard); the NSIS uninstaller removes the value (`nsis/hooks.nsh`).
//!
//! Only a value in that exact form counts as Mapper's. At start-up it is pointed at this exe when
//! the one it names is gone (a moved portable copy), and put back when it is missing although the
//! player has it on — never taken over because another copy started.

use std::ffi::{c_void, OsString};
use std::os::windows::ffi::{OsStrExt, OsStringExt};
use std::path::{Path, PathBuf};

use serde::Serialize;
use windows::core::{w, PCWSTR};
use windows::Win32::Foundation::{ERROR_FILE_NOT_FOUND, ERROR_SUCCESS, WIN32_ERROR};
use windows::Win32::System::Registry::{
    RegDeleteKeyValueW, RegGetValueW, RegSetKeyValueW, HKEY_CURRENT_USER, REG_SZ, RRF_RT_REG_BINARY, RRF_RT_REG_SZ,
};

/// The argument Windows starts Mapper with: tray only, no window (plan/ux.md F-14).
pub const FLAG: &str = "--autostart";

const RUN: PCWSTR = w!(r"Software\Microsoft\Windows\CurrentVersion\Run");
/// Task Manager's "Startup apps" switch; read only, to say when Windows keeps it off.
const APPROVED: PCWSTR = w!(r"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run");
/// The app identifier, so another program's "Mapper" entry is never taken for this one.
const VALUE: PCWSTR = w!("dev.mapper.app");
/// Windows documents a 260-character limit for Run entries; a longer one may never start.
pub const MAX_COMMAND_CHARS: usize = 260;
const MAX_VALUE_BYTES: u32 = 4096;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutostartStatus {
    pub enabled: bool,
    /// False when the player turned Mapper off in Task Manager → Startup apps.
    pub approved_by_windows: bool,
    /// The entry points at this exe.
    pub path_matches: bool,
}

#[derive(Debug)]
pub enum AutostartError {
    /// The command line would be longer than Windows runs.
    TooLong,
    Os(windows::core::Error),
}

impl std::fmt::Display for AutostartError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::TooLong => write!(f, "the command line is longer than {MAX_COMMAND_CHARS} characters"),
            Self::Os(err) => write!(f, "{err}"),
        }
    }
}

/// `"<exe>" --autostart` in UTF-16, built from the raw path (no lossy conversion).
pub fn command_line(exe: &Path) -> Vec<u16> {
    let quote = u16::from(b'"');
    let mut wide = vec![quote];
    wide.extend(exe.as_os_str().encode_wide());
    wide.push(quote);
    wide.extend(format!(" {FLAG}").encode_utf16());
    wide
}

/// The exe of a value in Mapper's own form, or None for anything else.
pub fn own_target(value: &[u16]) -> Option<PathBuf> {
    let quote = u16::from(b'"');
    let rest = value.strip_prefix(&[quote])?;
    let end = rest.iter().position(|&c| c == quote)?;
    let (path, tail) = (&rest[..end], &rest[end + 1..]);
    let flag: Vec<u16> = format!(" {FLAG}").encode_utf16().collect();
    let file = PathBuf::from(OsString::from_wide(path));
    let named_mapper = file.file_name().is_some_and(|n| n.to_string_lossy().eq_ignore_ascii_case("mapper.exe"));
    (tail == flag.as_slice() && named_mapper && file.is_absolute()).then_some(file)
}

/// Windows paths compare without regard to letter case.
fn same_path(a: &Path, b: &Path) -> bool {
    a.as_os_str().to_string_lossy().to_lowercase() == b.as_os_str().to_string_lossy().to_lowercase()
}

pub fn status(exe: &Path) -> AutostartStatus {
    let target = read_wide(RUN, VALUE).as_deref().and_then(own_target);
    AutostartStatus {
        enabled: target.is_some(),
        approved_by_windows: approved(read_bytes(APPROVED, VALUE).as_deref()),
        path_matches: target.is_some_and(|t| same_path(&t, exe)),
    }
}

pub fn set(exe: &Path, enabled: bool) -> Result<(), AutostartError> {
    if !enabled {
        // SAFETY: deletes Mapper's own value under HKCU; a missing value is fine.
        let result = unsafe { RegDeleteKeyValueW(HKEY_CURRENT_USER, RUN, VALUE) };
        return if result == ERROR_FILE_NOT_FOUND { Ok(()) } else { result.ok().map_err(AutostartError::Os) };
    }
    let line = command_line(exe);
    if line.len() > MAX_COMMAND_CHARS {
        return Err(AutostartError::TooLong);
    }
    write_wide(RUN, VALUE, &line).map_err(AutostartError::Os)
}

/// What start-up does with the entry.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Repair {
    Keep,
    /// Mapper's entry names an exe that no longer exists (a moved portable copy).
    PointHere,
    /// No entry although "start with Windows" is on: an upgrade through the installer runs the
    /// old uninstaller first (Tauri's NSIS passes no `/UPDATE` then), and its hook removes it.
    Restore,
}

/// `stored`: the Run value, None when there is none; `wanted`: the setting in Mapper. Another
/// existing copy keeps its entry, and a value in another form is not Mapper's to touch.
pub fn plan(stored: Option<&[u16]>, exe: &Path, wanted: bool) -> Repair {
    match stored.map(own_target) {
        None if wanted => Repair::Restore,
        Some(Some(target)) if !same_path(&target, exe) && !target.exists() => Repair::PointHere,
        _ => Repair::Keep,
    }
}

pub fn repair(exe: &Path, wanted: bool) -> Result<Repair, AutostartError> {
    let action = plan(read_wide(RUN, VALUE).as_deref(), exe, wanted);
    if action != Repair::Keep {
        set(exe, true)?;
    }
    Ok(action)
}

/// StartupApproved data: the first byte is even when the entry is allowed to run. No data
/// means Task Manager never touched it, which also counts as allowed.
pub fn approved(data: Option<&[u8]>) -> bool {
    data.and_then(|d| d.first()).is_none_or(|flag| flag % 2 == 0)
}

fn write_wide(key: PCWSTR, value: PCWSTR, text: &[u16]) -> windows::core::Result<()> {
    let terminated: Vec<u16> = text.iter().copied().chain(std::iter::once(0)).collect();
    let bytes = u32::try_from(terminated.len() * 2).map_err(|_| windows::core::Error::from(WIN32_ERROR(87)))?;
    // SAFETY: `terminated` is a NUL-terminated UTF-16 buffer of `bytes` bytes; Mapper's own HKCU value.
    unsafe {
        RegSetKeyValueW(HKEY_CURRENT_USER, key, value, REG_SZ.0, Some(terminated.as_ptr().cast::<c_void>()), bytes)
    }
    .ok()
}

fn read_wide(key: PCWSTR, value: PCWSTR) -> Option<Vec<u16>> {
    let mut buffer = vec![0u16; (MAX_VALUE_BYTES / 2) as usize];
    let mut size = MAX_VALUE_BYTES;
    // SAFETY: the buffer holds `size` bytes; RRF_RT_REG_SZ guarantees a terminated string.
    let result = unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            key,
            value,
            RRF_RT_REG_SZ,
            None,
            Some(buffer.as_mut_ptr().cast::<c_void>()),
            Some(&mut size),
        )
    };
    if result != ERROR_SUCCESS {
        return None;
    }
    buffer.truncate((size as usize / 2).saturating_sub(1));
    Some(buffer)
}

fn read_bytes(key: PCWSTR, value: PCWSTR) -> Option<Vec<u8>> {
    let mut buffer = vec![0u8; 64];
    let mut size = buffer.len() as u32;
    // SAFETY: the buffer holds `size` bytes.
    let result = unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            key,
            value,
            RRF_RT_REG_BINARY,
            None,
            Some(buffer.as_mut_ptr().cast::<c_void>()),
            Some(&mut size),
        )
    };
    (result == ERROR_SUCCESS).then(|| {
        buffer.truncate(size as usize);
        buffer
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn wide(text: &str) -> Vec<u16> {
        text.encode_utf16().collect()
    }

    #[test]
    fn the_command_line_quotes_the_exe_and_reads_back() {
        let exe = Path::new(r"C:\Users\Анна\Apps\Mapper Portable\mapper.exe");
        let line = command_line(exe);
        assert_eq!(
            String::from_utf16(&line).unwrap(),
            r#""C:\Users\Анна\Apps\Mapper Portable\mapper.exe" --autostart"#
        );
        assert_eq!(own_target(&line).as_deref(), Some(exe));
    }

    #[test]
    fn only_mappers_own_form_counts() {
        for foreign in [
            r#""C:\Tools\other.exe" --autostart"#,
            r#""C:\Tools\mapper.exe""#,
            r#""C:\Tools\mapper.exe" --autostart --evil"#,
            r#"C:\Tools\mapper.exe --autostart"#,
            r#""mapper.exe" --autostart"#,
            "",
        ] {
            assert_eq!(own_target(&wide(foreign)), None, "{foreign}");
        }
        assert!(own_target(&wide(r#""D:\Games\MAPPER.EXE" --autostart"#)).is_some());
        assert!(same_path(Path::new(r"C:\A\mapper.exe"), Path::new(r"c:\a\MAPPER.exe")));
    }

    #[test]
    fn start_up_repairs_only_mappers_own_entry() {
        let here = Path::new(r"C:\Games\Mapper\mapper.exe");
        assert_eq!(plan(None, here, true), Repair::Restore, "removed by an upgrade, still on in Mapper");
        assert_eq!(plan(None, here, false), Repair::Keep);
        assert_eq!(plan(Some(&command_line(here)), here, true), Repair::Keep);
        let moved = Path::new(r"C:\no such folder\mapper.exe");
        assert_eq!(plan(Some(&command_line(moved)), here, false), Repair::PointHere);
        let other = std::env::temp_dir().join("mapper-autostart-test").join("mapper.exe");
        std::fs::create_dir_all(other.parent().unwrap()).unwrap();
        std::fs::write(&other, b"").unwrap();
        assert_eq!(plan(Some(&command_line(&other)), here, true), Repair::Keep, "another copy that exists");
        assert_eq!(plan(Some(&wide("other.exe --x")), here, true), Repair::Keep, "not Mapper's form");
    }

    #[test]
    fn task_manager_switch_is_read_from_the_first_byte() {
        assert!(approved(None), "never touched in Task Manager");
        assert!(approved(Some(&[0x02, 0, 0, 0])));
        assert!(approved(Some(&[0x06])));
        assert!(!approved(Some(&[0x03, 0x11, 0x22])));
        assert!(approved(Some(&[])));
    }

    #[test]
    fn a_path_too_long_for_windows_is_refused() {
        let deep = PathBuf::from(format!(r"C:\{}\mapper.exe", "x".repeat(250)));
        assert!(command_line(&deep).len() > MAX_COMMAND_CHARS);
        // Refused before the registry is touched.
        assert!(matches!(set(&deep, true), Err(AutostartError::TooLong)));
    }
}
