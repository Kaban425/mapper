// Every app command must be listed here: with an app manifest Tauri rejects any command a
// window's capability does not grant (per-window ACL, plan/eng.md §4).
const COMMANDS: &[&str] = &[
    "log_line",
    "quit_app",
    "get_snapshot",
    "update_settings",
    "set_hotkey",
    "reset_hotkeys",
    "suspend_hotkeys",
    "arm_calibration",
    "reset_calibration",
    "set_autostart",
    "check_update_now",
    "open_link",
    "open_folder",
    "hide_main_window",
    "overlay_exit",
    "overlay_blank",
    "save_calibration",
    "submit_result",
];

fn main() {
    // C-8: the manifest pins asInvoker / uiAccess="false"; the guard checks the exe for it.
    let windows = tauri_build::WindowsAttributes::new().app_manifest(include_str!("windows-app-manifest.xml"));
    let attributes = tauri_build::Attributes::new()
        .app_manifest(tauri_build::AppManifest::new().commands(COMMANDS))
        .windows_attributes(windows);
    tauri_build::try_build(attributes).expect("failed to run tauri-build");
}
