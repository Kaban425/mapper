// Spike S-1..S-3 for Mapper: overlay window, own RegisterHotKey wrapper, focus without
// tao's focus helper, show/hide variants. Throwaway code; findings go to SPIKES.md.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod cycle;
mod hotkey_spec;
mod log;
mod overlay;
mod platform;
mod stats;

use std::error::Error;
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use tauri::menu::{CheckMenuItem, Menu, MenuEvent, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder, Wry};

use overlay::{HideMode, HudPayload, Preset, HUD, OVERLAY};
use platform::win::focus;
use platform::win::hotkey::{Binding, HotkeyThread};
use platform::win::window_style;

const HOTKEY_NEAR: i32 = 1;
const HOTKEY_FAR: i32 = 2;
const DEFAULT_HOTKEY_NEAR: &str = "Alt+Q";
const DEFAULT_HOTKEY_FAR: &str = "Alt+W";
const STARTUP_NOTICE_DELAY: Duration = Duration::from_millis(1500);
const TRAY_CYCLE_COUNT: u32 = 100;

/// Tauri's own WebView2 defaults; every window must get identical arguments.
const BASE_BROWSER_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection";

struct Options {
    hotkey_near: String,
    hotkey_far: String,
    mode: HideMode,
    cycle: Option<u32>,
    exit_after_cycle: bool,
    low_memory: bool,
    renderer_limit: bool,
}

impl Options {
    fn browser_args(&self) -> String {
        if self.renderer_limit {
            format!("{BASE_BROWSER_ARGS} --renderer-process-limit=1")
        } else {
            BASE_BROWSER_ARGS.to_string()
        }
    }
}

struct HotkeyHolder(Mutex<Option<HotkeyThread>>);

struct TrayItems {
    hide: CheckMenuItem<Wry>,
    cloak: CheckMenuItem<Wry>,
    always: CheckMenuItem<Wry>,
    hud_pin: CheckMenuItem<Wry>,
}

fn parse_args() -> Options {
    let mut options = Options {
        hotkey_near: DEFAULT_HOTKEY_NEAR.into(),
        hotkey_far: DEFAULT_HOTKEY_FAR.into(),
        mode: HideMode::Hide,
        cycle: None,
        exit_after_cycle: false,
        low_memory: false,
        renderer_limit: false,
    };
    for arg in std::env::args().skip(1) {
        // --hotkey= is kept as an alias of --hotkey-near= for the older launchers.
        if let Some(value) = arg.strip_prefix("--hotkey-near=").or_else(|| arg.strip_prefix("--hotkey=")) {
            options.hotkey_near = value.into();
        } else if let Some(value) = arg.strip_prefix("--hotkey-far=") {
            options.hotkey_far = value.into();
        } else if let Some(mode) = arg.strip_prefix("--mode=").and_then(HideMode::parse) {
            options.mode = mode;
        } else if let Some(count) = arg.strip_prefix("--cycle=") {
            options.cycle = count.parse().ok();
        } else {
            match arg.as_str() {
                "--exit-after-cycle" => options.exit_after_cycle = true,
                "--low-memory" => options.low_memory = true,
                "--renderer-limit" => options.renderer_limit = true,
                _ => log::line(format!("unknown argument ignored: {arg}")),
            }
        }
    }
    options
}

// ----------------------------------------------------------------- commands

#[tauri::command]
fn deactivate(app: AppHandle, reason: String) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || overlay::deactivate(&handle, &reason, true));
}

#[tauri::command]
fn overlay_blank(app: AppHandle, seq: u64) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || overlay::finish_hide(&handle, seq, "blank ack"));
}

#[tauri::command]
fn cycle_ack(app: AppHandle, kind: String, seq: u64) {
    overlay::cycle_ack(&app, &kind, seq);
}

#[tauri::command]
fn show_hud(app: AppHandle, payload: HudPayload) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || overlay::show_hud(&handle, payload, false));
}

#[tauri::command]
fn log_line(msg: String) {
    log::line(format!("ui: {msg}"));
}

// -------------------------------------------------------------------- setup

fn setup(app: &AppHandle, options: &Options) -> Result<(), Box<dyn Error>> {
    let log_path = log::init(&app.path().app_log_dir()?);
    log::line(format!(
        "Mapper spike {}, log {}, low_memory={}, renderer_limit={}",
        env!("CARGO_PKG_VERSION"),
        log_path.display(),
        options.low_memory,
        options.renderer_limit
    ));
    let raw_devices = platform::win::raw_input::registered_device_count();
    log::line(format!("raw input devices registered by this process: {raw_devices}"));
    if raw_devices != 0 {
        // The real app refuses to start here; the spike only reports it.
        notify_later(app, "Raw input не снят", vec![format!("зарегистрировано устройств: {raw_devices}")]);
    }
    create_windows(app, &options.browser_args())?;
    build_tray(app, options.mode)?;
    register_hotkeys(app, &[(HOTKEY_NEAR, options.hotkey_near.as_str()), (HOTKEY_FAR, options.hotkey_far.as_str())]);
    if options.mode != HideMode::Hide {
        overlay::set_mode(app, options.mode);
    }
    if options.low_memory {
        overlay::set_low_memory(app, true);
    }
    if let Some(count) = options.cycle {
        cycle::start(app.clone(), count, options.exit_after_cycle);
    }
    Ok(())
}

fn create_windows(app: &AppHandle, browser_args: &str) -> Result<(), Box<dyn Error>> {
    // Never created as fullscreen and never focused through tao: both paths fall back to
    // a synthesised Alt key press. Activation happens in platform::win::focus.
    let overlay = WebviewWindowBuilder::new(app, OVERLAY, WebviewUrl::App("overlay.html".into()))
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
        .zoom_hotkeys_enabled(false)
        .additional_browser_args(browser_args)
        .build()?;
    let overlay_hwnd = focus::to_raw(overlay.hwnd()?);
    if !window_style::suppress_key_menu(overlay_hwnd) {
        log::line("warning: could not subclass overlay to suppress the Alt menu");
    }
    overlay.set_ignore_cursor_events(true)?;
    window_style::set_tool_window(overlay_hwnd);

    let hud = WebviewWindowBuilder::new(app, HUD, WebviewUrl::App("hud.html".into()))
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
        .zoom_hotkeys_enabled(false)
        .additional_browser_args(browser_args)
        .build()?;
    hud.set_ignore_cursor_events(true)?;
    window_style::set_tool_window(focus::to_raw(hud.hwnd()?));
    Ok(())
}

fn preset_for(id: i32) -> Option<Preset> {
    match id {
        HOTKEY_NEAR => Some(Preset::Near),
        HOTKEY_FAR => Some(Preset::Far),
        _ => None,
    }
}

fn register_hotkeys(app: &AppHandle, wanted: &[(i32, &str)]) {
    let mut bindings = Vec::new();
    for &(id, text) in wanted {
        match hotkey_spec::parse(text) {
            Ok(spec) => bindings.push(Binding { id, label: text.to_string(), spec }),
            Err(err) => {
                log::line(format!("hotkey '{text}' rejected: {err}"));
                notify_later(app, "Горячая клавиша не принята", vec![format!("{text}: {err}")]);
            }
        }
    }
    let handle = app.clone();
    let spawned = HotkeyThread::spawn(bindings, move |id, pressed_at| {
        let Some(preset) = preset_for(id) else { return };
        let inner = handle.clone();
        let _ = handle.run_on_main_thread(move || overlay::on_hotkey(&inner, pressed_at, preset));
    });
    match spawned {
        Ok((thread, registrations)) => {
            for reg in &registrations {
                match &reg.error {
                    None => log::line(format!("hotkey #{} {} registered (RegisterHotKey)", reg.id, reg.label)),
                    Some(err) => {
                        log::line(format!("hotkey #{} {} NOT registered: {err}", reg.id, reg.label));
                        notify_later(
                            app,
                            "Горячая клавиша занята",
                            vec![format!("{}: {err}", reg.label), "Замер доступен из меню в трее".into()],
                        );
                    }
                }
            }
            *app.state::<HotkeyHolder>().0.lock().unwrap_or_else(|e| e.into_inner()) = Some(thread);
        }
        Err(err) => log::line(format!("hotkey thread failed: {err}")),
    }
}

fn notify_later(app: &AppHandle, title: &str, lines: Vec<String>) {
    let handle = app.clone();
    let payload = HudPayload { title: title.into(), lines, tone: "warn".into() };
    thread::spawn(move || {
        thread::sleep(STARTUP_NOTICE_DELAY);
        let inner = handle.clone();
        let _ = handle.run_on_main_thread(move || overlay::show_hud(&inner, payload, false));
    });
}

// --------------------------------------------------------------------- tray

fn build_tray(app: &AppHandle, mode: HideMode) -> Result<(), Box<dyn Error>> {
    let measure_near = MenuItem::with_id(app, "measure-near", "Замер: карта приближена", true, None::<&str>)?;
    let measure_far = MenuItem::with_id(app, "measure-far", "Замер: карта отдалена", true, None::<&str>)?;
    let hide = CheckMenuItem::with_id(app, "mode-hide", "Покой: hide (V1)", true, mode == HideMode::Hide, None::<&str>)?;
    let cloak =
        CheckMenuItem::with_id(app, "mode-cloak", "Покой: DWM cloak (V2)", true, mode == HideMode::Cloak, None::<&str>)?;
    let always = CheckMenuItem::with_id(
        app,
        "mode-always",
        "Покой: окно всегда показано (V3)",
        true,
        mode == HideMode::Always,
        None::<&str>,
    )?;
    let cycle = MenuItem::with_id(app, "cycle", "S-2: 100 циклов показа", true, None::<&str>)?;
    let hud_pin = CheckMenuItem::with_id(app, "hud-pin", "S-3: HUD закреплён", true, false, None::<&str>)?;
    let stats = MenuItem::with_id(app, "stats", "Статистика фокуса", true, None::<&str>)?;
    let open_log = MenuItem::with_id(app, "open-log", "Открыть папку лога", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Выход", true, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let sep3 = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(
        app,
        &[
            &measure_near,
            &measure_far,
            &sep1,
            &hide,
            &cloak,
            &always,
            &cycle,
            &sep2,
            &hud_pin,
            &stats,
            &open_log,
            &sep3,
            &quit,
        ],
    )?;
    app.manage(TrayItems { hide, cloak, always, hud_pin });
    let icon = app.default_window_icon().cloned().ok_or("default window icon is missing")?;
    TrayIconBuilder::with_id("mapper-spike")
        .icon(icon)
        .tooltip("Mapper spike")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(on_menu)
        .build(app)?;
    Ok(())
}

fn on_menu(app: &AppHandle, event: MenuEvent) {
    match event.id().as_ref() {
        "measure-near" => overlay::on_hotkey(app, Instant::now(), Preset::Near),
        "measure-far" => overlay::on_hotkey(app, Instant::now(), Preset::Far),
        "mode-hide" => apply_mode(app, HideMode::Hide),
        "mode-cloak" => apply_mode(app, HideMode::Cloak),
        "mode-always" => apply_mode(app, HideMode::Always),
        "cycle" => cycle::start(app.clone(), TRAY_CYCLE_COUNT, false),
        "hud-pin" => toggle_hud_pin(app),
        "stats" => {
            let payload =
                HudPayload { title: "Статистика".into(), lines: vec![overlay::focus_stats(app)], tone: "info".into() };
            overlay::show_hud(app, payload, false);
        }
        "open-log" => {
            if let Some(dir) = log::path().as_deref().and_then(|p| p.parent()) {
                let _ = std::process::Command::new("explorer").arg(dir).spawn();
            }
        }
        "quit" => app.exit(0),
        _ => {}
    }
}

fn apply_mode(app: &AppHandle, wanted: HideMode) {
    if !overlay::set_mode(app, wanted) {
        log::line("rest mode not changed: overlay is busy");
    }
    let actual = overlay::mode(app);
    let items = app.state::<TrayItems>();
    let _ = items.hide.set_checked(actual == HideMode::Hide);
    let _ = items.cloak.set_checked(actual == HideMode::Cloak);
    let _ = items.always.set_checked(actual == HideMode::Always);
}

fn toggle_hud_pin(app: &AppHandle) {
    let pinned = app.state::<TrayItems>().hud_pin.is_checked().unwrap_or(false);
    if pinned {
        let payload = HudPayload {
            title: "HUD закреплён".into(),
            lines: vec!["S-3: замер frame time с видимым HUD".into()],
            tone: "info".into(),
        };
        overlay::show_hud(app, payload, true);
    } else {
        overlay::hide_hud(app);
    }
}

fn main() {
    let options = parse_args();
    tauri::Builder::default()
        // tao registers every mouse and keyboard for raw input by default; Mapper reads
        // input only through its own windows, so the registration is removed entirely.
        .device_event_filter(tauri::DeviceEventFilter::Always)
        .manage(overlay::Shared::default())
        .manage(HotkeyHolder(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![deactivate, overlay_blank, cycle_ack, show_hud, log_line])
        .on_window_event(overlay::on_window_event)
        .setup(move |app| setup(app.handle(), &options))
        .run(tauri::generate_context!())
        .expect("Mapper spike failed to start");
}
