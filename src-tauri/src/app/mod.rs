//! Start-up, shutdown and window events.

pub mod hud;
pub mod main_window;
pub mod overlay;
pub mod timers;
pub mod tray;
pub mod windows;

use std::error::Error;

use tauri::{AppHandle, Manager, Window, WindowEvent};

use crate::config::{Config, ConfigStore, Language};
use crate::hotkeys::{spec, HotkeyService, HotkeyStatus};
use crate::logging;
use crate::platform::win::single_instance::Instance;
use crate::platform::win::{locale, raw_input, webview};
use timers::Timers;

/// Start-up order (plan/eng.md §3). Any error before the hotkeys exist stops the app.
pub fn setup(app: &AppHandle, instance: Instance) -> Result<(), Box<dyn Error>> {
    let log_path = logging::init(&app.path().app_log_dir()?)?;
    let os = windows_version::OsVersion::current();
    let versions = format!(
        "Mapper {}; Windows {}.{}.{}; WebView2 {}",
        app.package_info().version,
        os.major,
        os.minor,
        os.build,
        webview::runtime_version().unwrap_or_else(|| "unknown".into()),
    );
    logging::info("app", format!("{versions}; log {}", logging::display_path(&log_path)));
    log_monitors(app);
    raw_input::ensure_none()?;
    logging::info("app", "raw input devices registered by this process: 0");
    let config = load_config(app)?;
    app.manage(overlay::Overlay::default());
    app.manage(hud::HudState::default());
    windows::create_all(app)?;
    app.manage(Timers::start()?);
    let hotkeys = start_hotkeys(app, &config)?;
    let registered = |s: &HotkeyStatus| if s.registered { "registered" } else { "NOT registered" };
    logging::set_summary(format!(
        "{versions}; raw input devices 0; near {} {}; far {} {}",
        hotkeys[0].accelerator,
        registered(&hotkeys[0]),
        hotkeys[1].accelerator,
        registered(&hotkeys[1]),
    ));
    let russian = config.language == Language::Ru;
    let tray = tray::build(app, russian, [hotkeys[0].accelerator.as_str(), hotkeys[1].accelerator.as_str()])?;
    app.manage(tray);
    let handle = app.clone();
    instance.listen(move || {
        logging::info("app", "another copy was started: showing the main window");
        let inner = handle.clone();
        let _ = handle.run_on_main_thread(move || main_window::show(&inner));
    })?;
    Ok(())
}

fn log_monitors(app: &AppHandle) {
    let Ok(monitors) = app.available_monitors() else { return };
    for m in monitors {
        let size = m.size();
        logging::info(
            "app",
            format!(
                "monitor {}x{} at ({}, {}), scale {:.2}",
                size.width,
                size.height,
                m.position().x,
                m.position().y,
                m.scale_factor()
            ),
        );
    }
}

/// The first language follows Windows; after that the file decides.
fn load_config(app: &AppHandle) -> Result<Config, Box<dyn Error>> {
    let language = if locale::is_russian_ui() { Language::Ru } else { Language::En };
    let store = ConfigStore::load(&app.path().app_config_dir()?, Config { language, ..Config::default() });
    for notice in store.notices() {
        logging::warn("config", format!("{notice:?}"));
    }
    let config = store.get();
    let calibrated = config.calibrations.keys().map(ToString::to_string).collect::<Vec<_>>().join(", ");
    logging::info("config", format!("loaded; scales for [{calibrated}]"));
    app.manage(store);
    Ok(config)
}

fn start_hotkeys(app: &AppHandle, config: &Config) -> Result<[HotkeyStatus; 2], Box<dyn Error>> {
    let wanted = [spec::parse(&config.hotkeys.near)?, spec::parse(&config.hotkeys.far)?];
    let handle = app.clone();
    let (service, statuses) = HotkeyService::start(wanted, move |preset, at| {
        logging::info("hotkeys", format!("{} pressed", preset.as_str()));
        let inner = handle.clone();
        let _ = handle.run_on_main_thread(move || overlay::on_hotkey(&inner, preset, at));
    })?;
    for (status, name) in statuses.iter().zip(["near", "far"]) {
        if status.registered {
            logging::info("hotkeys", format!("{name} {} registered (RegisterHotKey)", status.accelerator));
        } else {
            logging::warn("hotkeys", format!("{name} {} NOT registered: taken by another program", status.accelerator));
        }
    }
    app.manage(service);
    Ok(statuses)
}

/// Every window keeps living until the app exits: closing the main window hides it to the
/// tray, and Alt+F4 on the overlay or HUD must not destroy them.
pub fn on_window_event(window: &Window, event: &WindowEvent) {
    match event {
        WindowEvent::CloseRequested { api, .. } => {
            api.prevent_close();
            if window.label() == windows::MAIN {
                main_window::hide(window.app_handle());
            } else {
                let _ = window.hide();
            }
        }
        WindowEvent::Focused(focused) if window.label() == windows::OVERLAY => {
            overlay::on_focus(window.app_handle(), *focused);
        }
        _ => {}
    }
}

/// Tray "Exit" and `quit_app`: an open overlay first closes by its normal rules.
pub fn quit(app: &AppHandle) {
    logging::info("app", "exit requested");
    overlay::quit(app);
}

/// Called once the overlay is hidden.
pub fn exit_now(app: &AppHandle) {
    if let Some(hotkeys) = app.try_state::<HotkeyService>() {
        hotkeys.shutdown();
    }
    if let Some(timers) = app.try_state::<Timers>() {
        timers.stop();
    }
    app.exit(0);
}
