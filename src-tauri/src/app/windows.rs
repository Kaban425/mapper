//! The three windows, created from Rust with identical WebView2 arguments so they share one
//! browser, GPU and renderer process.

use std::error::Error;

use tauri::webview::NewWindowResponse;
use tauri::window::Color;
use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder, Wry};

use crate::config::{ConfigStore, UI_ZOOM};
use crate::logging;
use crate::platform::win::focus::OwnHwnd;
use crate::platform::win::webview;
use crate::platform::win::window_style::{self, KeyMenu};

pub const MAIN: &str = "main";
pub const OVERLAY: &str = "overlay";
pub const HUD: &str = "hud";

/// Tauri's own WebView2 defaults plus one renderer for all windows (spike S-3: 69 MB).
pub const BROWSER_ARGS: &str =
    "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --renderer-process-limit=1";

const DEV_PORT: u16 = 5173;
const MAIN_BACKDROP_FALLBACK: Color = Color(17, 19, 22, 255);
const HUD_TINT: (u8, u8, u8, u8) = (14, 16, 20, 200);
const ACRYLIC_TINT: (u8, u8, u8, u8) = (17, 19, 22, 160);

pub fn create_all(app: &AppHandle) -> Result<(), Box<dyn Error>> {
    create_main(app)?;
    create_overlay(app)?;
    create_hud(app)?;
    Ok(())
}

/// Pages may only come from the app itself (production origin, or the Vite server in dev).
/// On Windows the app is served only from `http://tauri.localhost`; `https://tauri.localhost`
/// and `tauri://localhost` would also count as local to Tauri, so they are refused.
pub fn is_own_origin(url: &Url) -> bool {
    match (url.scheme(), url.host_str(), url.port()) {
        ("http", Some("tauri.localhost"), None) => true,
        ("http", Some("localhost"), Some(DEV_PORT)) => tauri::is_dev(),
        _ => false,
    }
}

fn builder<'a>(app: &'a AppHandle, label: &'a str, page: &str) -> WebviewWindowBuilder<'a, Wry, AppHandle> {
    WebviewWindowBuilder::new(app, label, WebviewUrl::App(page.into()))
        .additional_browser_args(BROWSER_ARGS)
        .zoom_hotkeys_enabled(false)
        .disable_drag_drop_handler()
        .on_navigation(allow_navigation)
        .on_new_window(|_, _| NewWindowResponse::Deny)
}

fn allow_navigation(url: &Url) -> bool {
    let allowed = is_own_origin(url);
    if !allowed {
        // Scheme and host only: a path or query could carry user data.
        logging::warn("windows", format!("navigation refused: {}://{}", url.scheme(), url.host_str().unwrap_or("")));
    }
    allowed
}

fn own(win: &WebviewWindow) -> Result<OwnHwnd, Box<dyn Error>> {
    OwnHwnd::of(win).ok_or_else(|| format!("window '{}' has no handle", win.label()).into())
}

/// Without it, releasing Alt (after Alt+Q, or alone) can enter menu mode and eat the next key.
fn suppress_key_menu(win: &WebviewWindow, mode: KeyMenu) -> Result<(), Box<dyn Error>> {
    if !window_style::suppress_key_menu(own(win)?, mode) {
        logging::warn(
            "windows",
            format!("{}: could not suppress the Alt menu (SetWindowSubclass failed)", win.label()),
        );
    }
    Ok(())
}

fn create_main(app: &AppHandle) -> Result<(), Box<dyn Error>> {
    let win = builder(app, MAIN, "main.html")
        .title("Mapper")
        .window_classname("Mapper.Main")
        .inner_size(960.0, 640.0)
        .min_inner_size(820.0, 560.0)
        .transparent(true)
        // Shown at the end of start-up, or not at all when started with Windows.
        .visible(false)
        .build()?;
    suppress_key_menu(&win, KeyMenu::PlainAlt)?;
    apply_main_backdrop(&win);
    webview::harden(&win)?;
    // The player's Ctrl+plus / minus choice (the built-in zoom keys are off); cosmetic, so a
    // failure is only logged.
    let zoom = app.state::<ConfigStore>().get().ui_zoom;
    if zoom != UI_ZOOM.default {
        if let Err(err) = win.set_zoom(zoom) {
            logging::warn("windows", format!("main: zoom not applied: {err}"));
        }
    }
    // Hidden until shown: asleep like the other hidden windows (the tray-only start keeps it so).
    webview::set_idle(&win, true);
    Ok(())
}

/// Mica on Windows 11, Acrylic on Windows 10, otherwise a solid colour.
fn apply_main_backdrop(win: &WebviewWindow) {
    if window_vibrancy::apply_mica(win, Some(true)).is_ok() {
        return;
    }
    if window_vibrancy::apply_acrylic(win, Some(ACRYLIC_TINT)).is_ok() {
        logging::info("windows", "main backdrop: acrylic (Mica unavailable)");
        return;
    }
    logging::warn("windows", "main backdrop: no system effect, solid colour");
    let _ = win.set_background_color(Some(MAIN_BACKDROP_FALLBACK));
}

fn create_overlay(app: &AppHandle) -> Result<(), Box<dyn Error>> {
    // Never fullscreen and never focused through tao: both paths synthesise an Alt press.
    let win = builder(app, OVERLAY, "overlay.html")
        .title("Mapper overlay")
        .window_classname("Mapper.Overlay")
        .inner_size(800.0, 600.0)
        .transparent(true)
        .decorations(false)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .focused(false)
        .visible(false)
        .build()?;
    let hwnd = own(&win)?;
    suppress_key_menu(&win, KeyMenu::All)?;
    win.set_ignore_cursor_events(true)?;
    window_style::set_tool_window(hwnd);
    webview::harden(&win)?;
    webview::set_idle(&win, true);
    Ok(())
}

fn create_hud(app: &AppHandle) -> Result<(), Box<dyn Error>> {
    let win = builder(app, HUD, "hud.html")
        .title("Mapper HUD")
        .window_classname("Mapper.Hud")
        .inner_size(380.0, 140.0)
        .transparent(true)
        .decorations(false)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .focused(false)
        .focusable(false)
        .visible(false)
        .build()?;
    let hwnd = own(&win)?;
    win.set_ignore_cursor_events(true)?;
    window_style::set_tool_window(hwnd);
    window_style::set_round_corners(hwnd);
    // The HUD is never active, and Mica/Acrylic paint a solid colour on inactive windows.
    if window_vibrancy::apply_blur(&win, Some(HUD_TINT)).is_err() {
        logging::warn("windows", "hud: blur unavailable");
    }
    webview::harden(&win)?;
    webview::set_idle(&win, true);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(text: &str) -> Url {
        Url::parse(text).unwrap()
    }

    #[test]
    fn accepts_only_the_app_origin() {
        assert!(is_own_origin(&url("http://tauri.localhost/main.html")));
        assert!(!is_own_origin(&url("https://tauri.localhost/main.html")), "a loopback TLS server is not the app");
        assert!(!is_own_origin(&url("tauri://localhost/overlay.html")), "macOS/Linux scheme only");
        assert!(!is_own_origin(&url("http://tauri.localhost:8080/")));
        assert!(!is_own_origin(&url("https://example.com/")));
        assert!(!is_own_origin(&url("http://tauri.localhost.evil.com/")));
        assert!(!is_own_origin(&url("http://localhost:8080/")));
        assert!(!is_own_origin(&url("file:///C:/Windows/")));
    }
}
