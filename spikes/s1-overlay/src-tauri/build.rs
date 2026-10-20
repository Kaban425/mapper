fn main() {
    // C-8: the manifest pins asInvoker / uiAccess="false"; the guard checks the exe for it.
    let windows = tauri_build::WindowsAttributes::new().app_manifest(include_str!("windows-app-manifest.xml"));
    tauri_build::try_build(tauri_build::Attributes::new().windows_attributes(windows))
        .expect("failed to run tauri-build");
}
