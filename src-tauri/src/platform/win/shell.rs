//! Opening things outside Mapper: a fixed set of web pages and Mapper's own folders, always
//! through `%WINDIR%\explorer.exe` — the only program Mapper ever starts (checked by the guard).
//! A URL never comes from the web view or from a server response, only from `Link`; a folder
//! only from `OwnFolder`.

use std::ffi::OsString;
use std::io;
use std::os::windows::ffi::OsStringExt;
use std::path::PathBuf;
use std::process::Command;

use serde::Deserialize;
use tauri::{AppHandle, Manager};
use windows::Win32::System::SystemInformation::GetSystemWindowsDirectoryW;

/// `owner/name` on GitHub; one constant, replaced by the author before publishing (the
/// release guard refuses the placeholder).
pub const REPO: &str = "OWNER/mapper";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Link {
    Repo,
    Releases,
    Issues,
    License,
    Security,
    /// The README's risk section (the same text as wizard step 2 and About).
    Risk,
}

impl Link {
    pub fn url(self) -> String {
        let base = format!("https://github.com/{REPO}");
        match self {
            Self::Repo => base,
            Self::Releases => format!("{base}/releases/latest"),
            Self::Issues => format!("{base}/issues/new/choose"),
            Self::License => format!("{base}/blob/main/LICENSE"),
            Self::Security => format!("{base}/security/policy"),
            Self::Risk => format!("{base}#risk"),
        }
    }
}

/// One of Mapper's own folders. Built only from Tauri's app paths: explorer would also start a
/// program it is handed, so it never gets a path from anywhere else.
pub struct OwnFolder(PathBuf);

impl OwnFolder {
    pub fn config(app: &AppHandle) -> tauri::Result<Self> {
        app.path().app_config_dir().map(Self)
    }

    pub fn logs(app: &AppHandle) -> tauri::Result<Self> {
        app.path().app_log_dir().map(Self)
    }
}

/// By absolute path: a bare "explorer" is looked up in Mapper's own folder first, where a
/// downloaded explorer.exe could sit next to a portable mapper.exe.
fn explorer() -> io::Result<PathBuf> {
    let mut buffer = [0u16; 261];
    // SAFETY: the buffer is writable for its whole length; the result is its used length.
    let len = unsafe { GetSystemWindowsDirectoryW(Some(&mut buffer)) } as usize;
    if len == 0 || len >= buffer.len() {
        return Err(io::Error::last_os_error());
    }
    Ok(PathBuf::from(OsString::from_wide(&buffer[..len])).join("explorer.exe"))
}

/// Opens the page in the default browser.
pub fn open_link(link: Link) -> io::Result<()> {
    Command::new(explorer()?).arg(link.url()).spawn().map(drop)
}

/// Shows one of Mapper's own folders (settings, log) in File Explorer.
pub fn open_folder(folder: &OwnFolder) -> io::Result<()> {
    std::fs::create_dir_all(&folder.0)?;
    Command::new(explorer()?).arg(&folder.0).spawn().map(drop)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_link_stays_on_the_repository() {
        for link in [Link::Repo, Link::Releases, Link::Issues, Link::License, Link::Security, Link::Risk] {
            assert!(link.url().starts_with(&format!("https://github.com/{REPO}")), "{link:?}");
        }
        let parsed: Link = serde_json::from_str("\"releases\"").unwrap();
        assert_eq!(parsed, Link::Releases);
        assert!(serde_json::from_str::<Link>("\"https://evil.example\"").is_err());
    }

    #[test]
    fn explorer_comes_from_the_windows_folder() {
        let path = explorer().unwrap();
        assert!(path.is_absolute());
        assert!(path.ends_with("explorer.exe"));
        assert!(path.exists(), "{}", path.display());
    }
}
