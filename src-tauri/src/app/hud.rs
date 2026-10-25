//! The result HUD: a small click-through window that never takes focus, top-left on the
//! monitor of the measurement (where the measuring panel was), hidden again after 10 s.
//! It is shown and hidden with raw SW_SHOWNOACTIVATE / SW_HIDE, never through tao.

use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition};

use super::overlay::placement::Placement;
use super::overlay::result::MeasurementResult;
use super::timers::Timers;
use super::windows::HUD;
use crate::config::{ConfigStore, Language};
use crate::logging;
use crate::platform::win::focus::{self, OwnHwnd};
use crate::platform::win::{webview, window_style};
use crate::preset::Preset;

pub const SHOW: &str = "hud-show";
const VISIBLE_FOR: Duration = Duration::from_secs(10);
/// CSS px from the monitor's top-left corner.
const MARGIN: f64 = 24.0;

/// Bumped on every show and hide, so an old timer cannot hide a newer HUD.
#[derive(Default)]
pub struct HudState {
    generation: AtomicU64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum NoticeCode {
    /// The route was parked for the other zoom; `hotkey` continues it.
    RouteKept,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum HudShow {
    Result { result: MeasurementResult, lang: Language, opacity: f64 },
    Notice { code: NoticeCode, hotkey: String, lang: Language, opacity: f64 },
}

pub fn show_result(app: &AppHandle, result: MeasurementResult, placement: Option<&Placement>) {
    let config = app.state::<ConfigStore>().get();
    show(app, HudShow::Result { result, lang: config.language, opacity: config.panel_opacity }, placement);
}

/// After the other zoom's hotkey: what to do next to continue the parked route.
pub fn show_route_kept(app: &AppHandle, to: Preset, placement: Option<&Placement>) {
    let config = app.state::<ConfigStore>().get();
    let hotkey = config.hotkeys.get(to).to_string();
    let payload =
        HudShow::Notice { code: NoticeCode::RouteKept, hotkey, lang: config.language, opacity: config.panel_opacity };
    show(app, payload, placement);
}

fn show(app: &AppHandle, payload: HudShow, placement: Option<&Placement>) {
    let Some(hud) = app.get_webview_window(HUD) else { return };
    if let Some(p) = placement {
        let margin = (MARGIN * p.viewport.scale).round() as i32;
        let _ = hud.set_position(PhysicalPosition::new(p.position.x + margin, p.position.y + margin));
    }
    let Some(hwnd) = OwnHwnd::of(&hud) else { return };
    let generation = app.state::<HudState>().generation.fetch_add(1, Ordering::SeqCst) + 1;
    webview::set_idle(&hud, false);
    let _ = app.emit_to(HUD, SHOW, payload);
    window_style::set_tool_window(hwnd);
    window_style::show_no_activate(hwnd);
    if focus::is_foreground(hwnd) {
        logging::warn("hud", "the HUD became the foreground window");
    }
    let handle = app.clone();
    app.state::<Timers>().schedule(VISIBLE_FOR, move || {
        let inner = handle.clone();
        let _ = handle.run_on_main_thread(move || {
            if inner.state::<HudState>().generation.load(Ordering::SeqCst) == generation {
                conceal(&inner);
            }
        });
    });
}

/// A new measurement hides the previous result at once.
pub fn hide(app: &AppHandle) {
    app.state::<HudState>().generation.fetch_add(1, Ordering::SeqCst);
    conceal(app);
}

fn conceal(app: &AppHandle) {
    let Some(hud) = app.get_webview_window(HUD) else { return };
    let Some(hwnd) = OwnHwnd::of(&hud) else { return };
    if hud.is_visible().unwrap_or(false) {
        window_style::hide(hwnd);
        webview::set_idle(&hud, true);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app::overlay::events::fixtures;
    use crate::app::overlay::result::sample;

    #[test]
    fn payload_matches_the_fixture() {
        fixtures::check("hud-show", &HudShow::Result { result: sample(), lang: Language::Ru, opacity: 0.86 });
        let notice =
            HudShow::Notice { code: NoticeCode::RouteKept, hotkey: "Alt+W".into(), lang: Language::En, opacity: 0.65 };
        fixtures::check("hud-show-notice", &notice);
    }
}
