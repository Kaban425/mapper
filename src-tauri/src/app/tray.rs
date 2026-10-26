//! Tray icon: left click opens the main window, right click shows the menu. Only plain
//! `MenuItem`s — muda's predefined Copy/Paste items synthesise Ctrl+key and are banned.
//! Texts follow the language and the hotkeys without rebuilding the menu.

use std::error::Error;

use tauri::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Wry};

use super::main_window;
use crate::config::{ConfigStore, Language};
use crate::hotkeys::HotkeyService;
use crate::logging;
use crate::preset::Preset;

const ID_OPEN: &str = "open";
const ID_NEAR: &str = "measure-near";
const ID_FAR: &str = "measure-far";
const ID_QUIT: &str = "quit";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TrayTexts {
    pub tooltip: &'static str,
    pub open: &'static str,
    pub near: &'static str,
    pub far: &'static str,
    pub quit: &'static str,
    /// "{hotkey} is used by another program", after "Mapper · ".
    pub busy: &'static str,
    /// "{near} and {far} ready", after "Mapper · ".
    pub ready: &'static str,
    /// Joins two busy hotkeys.
    pub and: &'static str,
}

const RU: TrayTexts = TrayTexts {
    tooltip: "Mapper",
    open: "Открыть Mapper",
    near: "Замер: приближено",
    far: "Замер: отдалено",
    quit: "Выход",
    busy: "{hotkey} занят другой программой",
    ready: "{near} и {far} готовы",
    and: " и ",
};

const EN: TrayTexts = TrayTexts {
    tooltip: "Mapper",
    open: "Open Mapper",
    near: "Measure: zoomed in",
    far: "Measure: zoomed out",
    quit: "Exit",
    busy: "{hotkey} is used by another program",
    ready: "{near} and {far} ready",
    and: " and ",
};

pub fn texts(russian: bool) -> TrayTexts {
    if russian {
        RU
    } else {
        EN
    }
}

/// The tray and the items whose text changes; kept alive in app state.
pub struct Tray {
    icon: TrayIcon<Wry>,
    open: MenuItem<Wry>,
    near: MenuItem<Wry>,
    far: MenuItem<Wry>,
    quit: MenuItem<Wry>,
}

/// What the tray says: menu texts plus the tooltip, which names a busy hotkey.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TrayLabels {
    pub tooltip: String,
    pub open: String,
    pub near: String,
    pub far: String,
    pub quit: String,
}

/// `hotkeys` are the near/far accelerators; `busy` those another program holds.
pub fn labels(russian: bool, hotkeys: [&str; 2], busy: &[&str]) -> TrayLabels {
    let t = texts(russian);
    let status = if busy.is_empty() {
        t.ready.replace("{near}", hotkeys[0]).replace("{far}", hotkeys[1])
    } else {
        t.busy.replace("{hotkey}", &busy.join(t.and))
    };
    let tooltip = format!("{} · {status}", t.tooltip);
    TrayLabels {
        tooltip,
        open: t.open.into(),
        near: format!("{} ({})", t.near, hotkeys[0]),
        far: format!("{} ({})", t.far, hotkeys[1]),
        quit: t.quit.into(),
    }
}

pub fn build(app: &AppHandle, labels: &TrayLabels) -> Result<Tray, Box<dyn Error>> {
    let open = MenuItem::with_id(app, ID_OPEN, &labels.open, true, None::<&str>)?;
    let near = MenuItem::with_id(app, ID_NEAR, &labels.near, true, None::<&str>)?;
    let far = MenuItem::with_id(app, ID_FAR, &labels.far, true, None::<&str>)?;
    let quit = MenuItem::with_id(app, ID_QUIT, &labels.quit, true, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&open, &sep1, &near, &far, &sep2, &quit])?;
    let icon = app.default_window_icon().cloned().ok_or("default window icon is missing")?;
    let icon = TrayIconBuilder::with_id("mapper")
        .icon(icon)
        .tooltip(&labels.tooltip)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(on_menu)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                main_window::show(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(Tray { icon, open, near, far, quit })
}

/// After a language or hotkey change, or a hotkey that became free or busy.
pub fn refresh(app: &AppHandle) {
    let Some(tray) = app.try_state::<Tray>() else { return };
    let config = app.state::<ConfigStore>().get();
    let state = app.try_state::<HotkeyService>().and_then(|s| s.state());
    let busy: Vec<&str> = state
        .as_ref()
        .map(|s| [&s.near, &s.far].into_iter().filter(|h| h.error.is_some()).map(|h| h.accelerator.as_str()).collect())
        .unwrap_or_default();
    let hotkeys = [config.hotkeys.near.as_str(), config.hotkeys.far.as_str()];
    let new = labels(config.language == Language::Ru, hotkeys, &busy);
    let results = [
        tray.open.set_text(&new.open),
        tray.near.set_text(&new.near),
        tray.far.set_text(&new.far),
        tray.quit.set_text(&new.quit),
        tray.icon.set_tooltip(Some(&new.tooltip)),
    ];
    if let Some(err) = results.into_iter().find_map(Result::err) {
        logging::warn("tray", format!("texts not updated: {err}"));
    }
}

fn on_menu(app: &AppHandle, event: MenuEvent) {
    match event.id().as_ref() {
        ID_OPEN => main_window::show(app),
        // The fallback for a hotkey another program has taken.
        ID_NEAR => super::overlay::on_tray(app, Preset::Near),
        ID_FAR => super::overlay::on_tray(app, Preset::Far),
        ID_QUIT => super::quit(app),
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn both_languages_are_complete_and_distinct() {
        for t in [RU, EN] {
            for text in [t.tooltip, t.open, t.near, t.far, t.quit, t.busy, t.ready] {
                assert!(!text.trim().is_empty());
            }
            assert!(t.busy.contains("{hotkey}"));
        }
        assert_ne!(RU.open, EN.open);
        assert_ne!(RU.quit, EN.quit);
        assert_eq!(texts(true), RU);
        assert_eq!(texts(false), EN);
    }

    #[test]
    fn labels_carry_the_hotkeys_and_a_busy_one() {
        let ok = labels(true, ["Alt+Q", "Alt+W"], &[]);
        assert_eq!(ok.near, "Замер: приближено (Alt+Q)");
        assert_eq!(ok.tooltip, "Mapper · Alt+Q и Alt+W готовы");
        let busy = labels(false, ["Alt+Q", "F7"], &["F7"]);
        assert_eq!(busy.far, "Measure: zoomed out (F7)");
        assert_eq!(busy.tooltip, "Mapper · F7 is used by another program");
        let both = labels(true, ["Alt+Q", "Alt+W"], &["Alt+Q", "Alt+W"]);
        assert_eq!(both.tooltip, "Mapper · Alt+Q и Alt+W занят другой программой");
    }
}
