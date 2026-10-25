//! Tray icon: left click opens the main window, right click shows the menu. Only plain
//! `MenuItem`s — muda's predefined Copy/Paste items synthesise Ctrl+key and are banned.

use std::error::Error;

use tauri::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::AppHandle;

use super::main_window;
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
}

const RU: TrayTexts = TrayTexts {
    tooltip: "Mapper",
    open: "Открыть Mapper",
    near: "Замер: приближено",
    far: "Замер: отдалено",
    quit: "Выход",
};

const EN: TrayTexts = TrayTexts {
    tooltip: "Mapper",
    open: "Open Mapper",
    near: "Measure: zoomed in",
    far: "Measure: zoomed out",
    quit: "Exit",
};

pub fn texts(russian: bool) -> TrayTexts {
    if russian {
        RU
    } else {
        EN
    }
}

/// `hotkeys` are the near/far accelerators shown next to the measure items.
pub fn build(app: &AppHandle, russian: bool, hotkeys: [&str; 2]) -> Result<TrayIcon, Box<dyn Error>> {
    let t = texts(russian);
    let open = MenuItem::with_id(app, ID_OPEN, t.open, true, None::<&str>)?;
    let near = MenuItem::with_id(app, ID_NEAR, format!("{} ({})", t.near, hotkeys[0]), true, None::<&str>)?;
    let far = MenuItem::with_id(app, ID_FAR, format!("{} ({})", t.far, hotkeys[1]), true, None::<&str>)?;
    let quit = MenuItem::with_id(app, ID_QUIT, t.quit, true, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&open, &sep1, &near, &far, &sep2, &quit])?;
    let icon = app.default_window_icon().cloned().ok_or("default window icon is missing")?;
    let tray = TrayIconBuilder::with_id("mapper")
        .icon(icon)
        .tooltip(t.tooltip)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(on_menu)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                main_window::show(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(tray)
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
            for text in [t.tooltip, t.open, t.near, t.far, t.quit] {
                assert!(!text.trim().is_empty());
            }
        }
        assert_ne!(RU.open, EN.open);
        assert_ne!(RU.quit, EN.quit);
        assert_eq!(texts(true), RU);
        assert_eq!(texts(false), EN);
    }
}
