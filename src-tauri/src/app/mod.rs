//! Start-up, shutdown and window events.

pub mod main_window;
pub mod timers;
pub mod tray;
pub mod windows;

use std::error::Error;

use tauri::{AppHandle, Manager, Window, WindowEvent};

use crate::hotkeys::{self, spec, HotkeyService, HotkeyStatus};
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
    windows::create_all(app)?;
    app.manage(Timers::start()?);
    let hotkeys = start_hotkeys(app)?;
    let registered = |s: &HotkeyStatus| if s.registered { "registered" } else { "NOT registered" };
    logging::set_summary(format!(
        "{versions}; raw input devices 0; near {} {}; far {} {}",
        hotkeys[0].accelerator,
        registered(&hotkeys[0]),
        hotkeys[1].accelerator,
        registered(&hotkeys[1]),
    ));
    let russian = locale::is_russian_ui();
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

fn start_hotkeys(app: &AppHandle) -> Result<[HotkeyStatus; 2], Box<dyn Error>> {
    let wanted = [spec::parse(hotkeys::DEFAULT_NEAR)?, spec::parse(hotkeys::DEFAULT_FAR)?];
    // Phase 2 wires the press to the overlay; until then it is only logged.
    let (service, statuses) = HotkeyService::start(wanted, |preset, _at| {
        logging::info("hotkeys", format!("{} pressed", preset.as_str()));
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
    if let WindowEvent::CloseRequested { api, .. } = event {
        api.prevent_close();
        if window.label() == windows::MAIN {
            main_window::hide(window.app_handle());
        } else {
            let _ = window.hide();
        }
    }
}

pub fn quit(app: &AppHandle) {
    logging::info("app", "exit requested");
    if let Some(hotkeys) = app.try_state::<HotkeyService>() {
        hotkeys.shutdown();
    }
    if let Some(timers) = app.try_state::<Timers>() {
        timers.stop();
    }
    app.exit(0);
}
