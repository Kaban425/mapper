//! Mapper: a distance ruler over the game's world map. Separate process and windows; never
//! reads the game, the screen or other processes, never sends input (rpi/mapper-overlay).

pub mod app;
pub mod commands;
pub mod config;
pub mod hotkeys;
pub mod logging;
pub mod platform;
pub mod preset;

use platform::win::dialog;
use platform::win::single_instance::{self, Acquire};

const START_FAILED: &str = "Mapper не запустился / Mapper failed to start";
const UNREACHABLE: &str = "Mapper уже запущен, но не ответил: возможно, он запущен от имени администратора.\n\
     Mapper is already running but did not respond: it may be running as administrator.";

pub fn run() {
    log_panics();
    let instance = match single_instance::acquire() {
        Ok(Acquire::First(instance)) => instance,
        Ok(Acquire::Second) => return,
        Ok(Acquire::Unreachable) => fail(UNREACHABLE),
        Err(err) => fail(&err.to_string()),
    };
    let result = tauri::Builder::default()
        // tao registers every mouse and keyboard for raw input by default; Mapper reads
        // input only through its own windows, so the registration is removed entirely.
        .device_event_filter(tauri::DeviceEventFilter::Always)
        .invoke_handler(tauri::generate_handler![
            commands::log_line,
            commands::quit_app,
            commands::main_window::get_snapshot,
            commands::main_window::update_settings,
            commands::main_window::set_hotkey,
            commands::main_window::reset_hotkeys,
            commands::main_window::suspend_hotkeys,
            commands::main_window::arm_calibration,
            commands::main_window::reset_calibration,
            commands::main_window::set_autostart,
            commands::main_window::open_link,
            commands::main_window::open_folder,
            commands::main_window::hide_main_window,
            commands::overlay::overlay_exit,
            commands::overlay::overlay_blank,
            commands::overlay::save_calibration,
            commands::overlay::submit_result
        ])
        .on_window_event(app::on_window_event)
        .setup(move |tauri_app| {
            if let Err(err) = app::setup(tauri_app.handle(), instance) {
                fail(&err.to_string());
            }
            Ok(())
        })
        .run(tauri::generate_context!());
    if let Err(err) = result {
        fail(&err.to_string());
    }
}

/// Release builds abort on panic and have no console, so the log is the only trace.
fn log_panics() {
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        logging::error("panic", info.to_string());
        default_hook(info);
    }));
}

fn fail(detail: &str) -> ! {
    dialog::fatal(&format!("{START_FAILED}\n\n{detail}"));
    std::process::exit(2);
}
