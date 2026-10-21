//! WebView2 settings Tauri does not expose: lowest-cost state for hidden windows, and a
//! locked-down browser (no permissions, no context menu, no browser shortcuts, no autofill).

use tauri::{Runtime, WebviewWindow};
use webview2_com::Microsoft::Web::WebView2::Win32::{
    GetAvailableCoreWebView2BrowserVersionString, ICoreWebView2, ICoreWebView2Settings3, ICoreWebView2Settings4,
    ICoreWebView2_19, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL,
    COREWEBVIEW2_PERMISSION_STATE_DENY,
};
use webview2_com::PermissionRequestedEventHandler;
use windows::core::{Interface, PCWSTR, PWSTR};

/// Hidden windows stop rendering and let WebView2 trim memory (spike S-3: 391 → 69 MB);
/// both are reverted before the window is shown again.
pub fn set_idle<R: Runtime>(win: &WebviewWindow<R>, idle: bool) {
    let _ = win.with_webview(move |webview| {
        let controller = webview.controller();
        let level = if idle {
            COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW
        } else {
            COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL
        };
        // SAFETY: COM calls on the controller of our own webview, made on its UI thread.
        unsafe {
            let _ = controller.SetIsVisible(!idle);
            if let Ok(core) = controller.CoreWebView2() {
                if let Ok(core19) = core.cast::<ICoreWebView2_19>() {
                    let _ = core19.SetMemoryUsageTargetLevel(level);
                }
            }
        }
    });
}

/// Permission denial comes first and is mandatory: if it cannot be installed, WebView2 would
/// fall back to its own prompts (camera, screen capture…), so Mapper stops instead. The other
/// settings are best effort and only logged when an older runtime lacks them.
pub fn harden<R: Runtime>(win: &WebviewWindow<R>) -> tauri::Result<()> {
    let label = win.label().to_string();
    win.with_webview(move |webview| {
        // SAFETY: COM calls on our own webview, made on its UI thread.
        let core = match unsafe { webview.controller().CoreWebView2() } {
            Ok(core) => core,
            Err(err) => return refuse(&label, &err),
        };
        // SAFETY: as above.
        if let Err(err) = unsafe { deny_permissions(&core) } {
            return refuse(&label, &err);
        }
        // SAFETY: as above.
        if let Err(err) = unsafe { lock_settings(&core) } {
            crate::logging::warn("webview", format!("{label}: settings hardening incomplete: {err}"));
        }
    })
}

fn refuse(label: &str, err: &windows::core::Error) {
    super::dialog::fatal(&format!("Mapper: {label}: WebView2 permission requests could not be blocked ({err})"));
    std::process::exit(2);
}

unsafe fn deny_permissions(core: &ICoreWebView2) -> windows::core::Result<()> {
    // Camera, microphone, screen capture, notifications… — everything is denied.
    let mut token = 0i64;
    // SAFETY: registers a handler on a live WebView2 owned by this window.
    unsafe {
        core.add_PermissionRequested(
            &PermissionRequestedEventHandler::create(Box::new(|_, args| {
                if let Some(args) = args {
                    args.SetState(COREWEBVIEW2_PERMISSION_STATE_DENY)?;
                }
                Ok(())
            })),
            &mut token,
        )
    }
}

unsafe fn lock_settings(core: &ICoreWebView2) -> windows::core::Result<()> {
    // SAFETY (whole function): plain setters on a live WebView2 owned by this window.
    unsafe {
        let settings = core.Settings()?;
        settings.SetAreDefaultContextMenusEnabled(false)?;
        settings.SetIsStatusBarEnabled(false)?;
        if let Ok(settings3) = settings.cast::<ICoreWebView2Settings3>() {
            // F5, Ctrl+R/P/F, F12 and friends.
            settings3.SetAreBrowserAcceleratorKeysEnabled(false)?;
        }
        if let Ok(settings4) = settings.cast::<ICoreWebView2Settings4>() {
            settings4.SetIsGeneralAutofillEnabled(false)?;
            settings4.SetIsPasswordAutosaveEnabled(false)?;
        }
    }
    Ok(())
}

/// Installed WebView2 runtime version, for the start-up log and bug reports.
pub fn runtime_version() -> Option<String> {
    let mut version = PWSTR::null();
    // SAFETY: the out-string is allocated by WebView2 and freed by take_pwstr.
    unsafe {
        GetAvailableCoreWebView2BrowserVersionString(PCWSTR::null(), &mut version).ok()?;
    }
    Some(webview2_com::take_pwstr(version))
}
