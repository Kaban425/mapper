//! S-3 experiment: put the WebView2 of a hidden window into its cheapest state.
//! `SetIsVisible(false)` stops rendering; memory target level "low" lets WebView2 trim
//! its working set. Both are reverted before the window is shown again.

use tauri::WebviewWindow;
use webview2_com::Microsoft::Web::WebView2::Win32::{
    ICoreWebView2_19, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW,
    COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL,
};
use windows::core::Interface;

pub fn set_idle(win: &WebviewWindow, idle: bool) {
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
