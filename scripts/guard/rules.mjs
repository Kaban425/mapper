// Rule data for the anti-ban guard (plan/eng.md §7). Paths are relative to the repository
// root; entries ending in "/" are directory prefixes. Rule patterns must not use the `g`
// flag: they are reused with RegExp.test across lines.

export const RUST = [".rs"];
export const WEB = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".svelte", ".html"];

export const SOURCE_DIRS = ["src", "src-tauri/src"];
export const EXTRA_FILES = [
  "src-tauri/build.rs",
  "src-tauri/Cargo.toml",
  "src-tauri/windows-app-manifest.xml",
  "src-tauri/.cargo/config.toml",
  ".cargo/config.toml",
  "vite.config.ts",
  "svelte.config.js",
  "vitest.config.ts",
];
export const SOURCE_EXT = new Set([...RUST, ...WEB, ".json", ".json5", ".toml", ".xml"]);

const PLATFORM_WIN = "src-tauri/src/platform/win/";
const FOCUS_RS = `${PLATFORM_WIN}focus.rs`;
const HOTKEY_RS = `${PLATFORM_WIN}hotkey.rs`;
const SINGLE_INSTANCE_RS = `${PLATFORM_WIN}single_instance.rs`;
const AUTOSTART_RS = `${PLATFORM_WIN}autostart.rs`;
const SHELL_RS = `${PLATFORM_WIN}shell.rs`;
const WEBVIEW_RS = `${PLATFORM_WIN}webview.rs`;
const WINDOWS_RS = "src-tauri/src/app/windows.rs";
const UPDATE_DIR = "src-tauri/src/update/";
const IPC_DIR = "src/lib/ipc/";

// `ext` limits a rule to file types, `only` to paths, `allow` exempts paths.
export const SOURCE_RULES = [
  {
    group: "input injection",
    pattern:
      /\b(SendInput|keybd_event|mouse_event|BlockInput|SetCursorPos|ClipCursor|InjectTouchInput|InjectSyntheticPointerInput|InjectMouseInput|InjectKeyboardInput|AttachThreadInput|SwitchToThisWindow|SPI_SETFOREGROUNDLOCKTIMEOUT|KEYBDINPUT|MOUSEINPUT)\b/,
  },
  {
    group: "messages to other windows",
    pattern: /\b(PostMessage[AW]?|SendMessage\w*|SendNotifyMessage[AW]?|SendDlgItemMessage[AW]?|BroadcastSystemMessage\w*)\b|\bHWND_BROADCAST\b/,
  },
  {
    group: "hooks, raw input, keyboard polling",
    pattern:
      /\b(SetWindowsHookEx[AW]?|SetWinEventHook|RegisterRawInputDevices|GetRawInputData|GetRawInputBuffer|GetAsyncKeyState|GetKeyState|GetKeyboardState|GetLastInputInfo)\b/,
  },
  { group: "hotkeys outside platform/win/hotkey.rs", pattern: /\b(RegisterHotKey|UnregisterHotKey)\s*\(/, allow: [HOTKEY_RS] },
  {
    group: "other processes",
    pattern:
      /\b(OpenProcess\w*|OpenThread|ReadProcessMemory|WriteProcessMemory|VirtualAllocEx|VirtualProtectEx|VirtualQueryEx|CreateRemoteThread\w*|Nt[A-Z]\w*|Zw[A-Z]\w*|DebugActiveProcess|Toolhelp32ReadProcessMemory|K32\w+|EnumProcesses|EnumProcessModules(Ex)?|CreateToolhelp32Snapshot|Process32(First|Next)W?|Module32(First|Next)W?|Thread32(First|Next)|QueryFullProcessImageName[AW]?|GetModuleFileNameEx[AW]?|GetProcessImageFileName[AW]?|WTSEnumerateProcesses\w*|Win32_Process)\b/,
  },
  {
    group: "foreign windows",
    pattern:
      /\b(FindWindow\w*|EnumWindows|EnumChildWindows|EnumThreadWindows|EnumDesktopWindows|EnumDesktops\w*|GetWindowText\w*|InternalGetWindowText|GetClassName\w*|RealGetWindowClass\w*|GetWindowModuleFileName\w*|GetWindowThreadProcessId|WindowFrom\w*Point|WindowFromDC|ChildWindowFrom\w*|RealChildWindowFromPoint|GetWindowRect|GetClientRect|GetWindowInfo|GetWindowPlacement|GetTitleBarInfo|GetWindow|GetTopWindow|GetNextWindow|GetParent|GetAncestor|GetLastActivePopup|GetShellWindow|GetDesktopWindow|GetGUIThreadInfo|DwmGetWindowAttribute|MonitorFromWindow|I?C?UIAutomation\w*|AccessibleObjectFrom\w*)\b/,
  },
  { group: "foreground window", pattern: /\b(GetForegroundWindow|SetForegroundWindow|IsWindow)\b/, allow: [FOCUS_RS] },
  { group: "thread messages", pattern: /\bPostThreadMessage[AW]?\b/, allow: [HOTKEY_RS] },
  {
    group: "single-instance primitives",
    pattern: /\b(AllowSetForegroundWindow|CreateMutex[AW]?|OpenMutex[AW]?|CreateEvent[AW]?|OpenEvent[AW]?)\b/,
    allow: [SINGLE_INSTANCE_RS],
  },
  {
    group: "screen capture",
    pattern:
      /\b(BitBlt|StretchBlt|PrintWindow|GetDC|GetDCEx|GetWindowDC|CreateDC[AW]?|GetPixel|GetDIBits|DuplicateOutput\d?|IDXGIOutputDuplication|GraphicsCapture\w*|Direct3D11CaptureFramePool|DwmRegisterThumbnail|MagInitialize|CapturePreview|getDisplayMedia|getUserMedia|html2canvas)\b/,
  },
  {
    group: "browser device access",
    pattern:
      /\b(mediaDevices|getGamepads|requestPointerLock|requestFullscreen)\b|navigator\s*\.\s*(keyboard|hid|usb|serial|bluetooth)\b/,
  },
  // Any spelling: method, UFCS path (`WebviewWindow::set_focus(&w)`), JS, or a plugin command string.
  {
    group: "tao paths that synthesise Alt",
    pattern: /\bset[_-]focus\b|\bsetFocus\b|\bfullscreen\s*\(|set_fullscreen|setFullscreen|"?fullscreen"?\s*:\s*true/,
  },
  { group: "cursor control", pattern: /(set_cursor_position|set_cursor_grab|setCursorPosition|setCursorGrab)/ },
  // muda's predefined edit items (also behind tauri's `copy_with_text` and friends) send Ctrl+key.
  {
    group: "menu items that synthesise Ctrl+key",
    pattern:
      /\b(copy|cut|paste|select_all|undo|redo)(_with_text)?\s*\(|PredefinedMenuItem::(?!separator\b)|PredefinedMenuItem\s+as\b|Menu::default\s*\(/,
    ext: RUST,
  },
  {
    group: "raw input re-enabled",
    pattern: /DeviceEventFilter::(Never|Unfocused|default)|set_device_event_filter|device_event_filter\(\s*Default::default/,
  },
  {
    group: "dynamic or raw linking",
    pattern:
      /\b(GetProcAddress|LoadLibrary(Ex)?[AW]?|libloading|winapi::|windows_sys::|link_name|link_ordinal|raw[-_]dylib)\b|\bextern\s*("[^"]*"\s*)?\{|#\[link\b|\blink!\s*\(/,
  },
  { group: "code from outside the scanned folders", pattern: /\binclude!\s*\(|#\[\s*path\s*=/, ext: RUST },
  // Safe Rust reaches WinRT (InputInjector, ProcessDiagnosticInfo) with no banned name and no
  // `unsafe`; Mapper uses only `windows::Win32` and `windows::core`. Exact features: deny.toml.
  {
    group: "WinRT through the windows crate",
    pattern:
      /(?<![\w:])windows\s*::\s*(\{|(UI|System|Devices|Graphics|Media|Gaming|ApplicationModel|Foundation|Storage|Networking|Security|Web|Data|Globalization|Management|Perception|Phone|AI|Services|Embedded)\b)|\buse\s+windows\s+as\b|\bextern\s+crate\b/,
    ext: RUST,
  },
  {
    group: "native code at link time",
    pattern: /cargo::?rustc-(link-arg|link-lib|link-search|cdylib-link-arg|bin-link-arg|flags)|\b(cc|cmake)::/,
    ext: RUST,
  },
  { group: "inline assembly", pattern: /\b(global_|naked_)?asm!\s*[({[]/, ext: RUST },
  {
    group: "process spawning",
    pattern: /\bCommand::new\b|\bprocess::Command\b|\b(CreateProcess\w*|WinExec|ShellExecute\w*)\b/,
    allow: [SHELL_RS],
  },
  { group: "process spawning", pattern: /\bCommand::new\s*\((?!\s*"explorer"\s*\))/ },
  {
    group: "registry",
    pattern:
      /\bReg(OpenKey|CreateKey|SetValue|SetKeyValue|GetValue|QueryValue|DeleteValue|DeleteKey|EnumKey|EnumValue)\w*\b|\bwinreg\b/,
    ext: RUST,
    allow: [AUTOSTART_RS],
  },
  {
    group: "network outside update/",
    pattern: /\b(ureq|reqwest|hyper|TcpStream|TcpListener|UdpSocket|WinHttp\w*|InternetOpen\w*|URLDownloadToFile\w*)\b|\bstd::net\b/,
    ext: RUST,
    allow: [UPDATE_DIR],
  },
  { group: "unsafe outside platform/win", pattern: /\bunsafe\b/, ext: RUST, allow: [PLATFORM_WIN] },
  { group: "window effects", pattern: /\.effects\s*\(|\bwindow_vibrancy::/, ext: RUST, allow: [WINDOWS_RS] },
  { group: "broadcast events (use emit_to)", pattern: /\.(emit|emit_str|emit_filter)\s*\(/, ext: RUST },
  // Capabilities added at run time or loaded from another folder bypass antiban/acl.json.
  { group: "capabilities outside the ACL files", pattern: /\badd_capability\b|capabilities_path_pattern|permissions_path_pattern|"dynamic-acl"/ },
  { group: "devtools", pattern: /"devtools"|\.devtools\s*\(|open_devtools/ },
  { group: "game names and files", pattern: /\b(TslGame|PUBG|BATTLEGROUNDS|steamapps|GameUserSettings|Engine\.ini)\b/i },
  { group: "dependency overrides", pattern: /^\s*\[(patch|replace)\b/ },
  { group: "elevation", pattern: /requireAdministrator|highestAvailable|uiAccess\s*=\s*"true"/ },
  // Web view: the only door to Rust is src/lib/ipc, and nothing leaves the machine.
  { group: "Tauri API outside lib/ipc", pattern: /@tauri-apps\/|__TAURI\w*__/, ext: WEB, allow: [IPC_DIR] },
  { group: "Tauri API module", pattern: /@tauri-apps\/(?!api\/(core|event)["'])/, ext: WEB },
  // invoke("plugin:window|...") reaches plugin commands by name, past any import rule.
  { group: "plugin commands from the web view", pattern: /["'`]plugin:/, ext: WEB },
  { group: "HUD calls commands", pattern: /lib\/ipc\/commands/, ext: WEB, only: ["src/apps/hud/"] },
  {
    group: "network from the web view",
    pattern: /\b(fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|RTCPeerConnection|WebTransport)\b/,
    ext: WEB,
  },
  { group: "web storage", pattern: /\b(localStorage|sessionStorage|indexedDB|cookieStore)\b|document\s*\.\s*cookie/, ext: WEB },
  {
    group: "dynamic code and raw HTML",
    pattern:
      /\beval\s*\(|\bnew\s+Function\b|\b(innerHTML|outerHTML|insertAdjacentHTML|createContextualFragment)\b|\bdocument\s*\.\s*write(ln)?\b|\{@html\b/,
    ext: WEB,
  },
];

// Statements that must exist: they switch dependency behaviour off or pin privileges.
export const REQUIRED = [
  {
    file: "src-tauri/src/lib.rs",
    pattern: /\.device_event_filter\(\s*tauri::DeviceEventFilter::Always\s*\)/,
    why: "tao must not register mice and keyboards for raw input",
  },
  {
    // A second call later in the builder chain would win.
    file: "src-tauri/src/lib.rs",
    pattern: /\.device_event_filter\(/,
    count: 1,
    exact: true,
    why: "exactly one device_event_filter call",
  },
  {
    file: "src-tauri/src/app/mod.rs",
    pattern: /raw_input::ensure_none\(\s*\)\s*\?/,
    why: "startup must fail if raw input is registered anyway",
  },
  {
    file: "src-tauri/windows-app-manifest.xml",
    pattern: /level="asInvoker"\s+uiAccess="false"/,
    why: "C-8: no elevation, no UI access",
  },
  {
    file: "src-tauri/build.rs",
    pattern: /\.app_manifest\(\s*include_str!\(\s*"windows-app-manifest\.xml"\s*\)\s*\)/,
    why: "the manifest is embedded into the exe",
  },
  {
    file: "src-tauri/build.rs",
    pattern: /AppManifest::new\(\)\s*\.commands\(\s*COMMANDS\s*\)/,
    why: "per-window ACL for app commands",
  },
  {
    file: WINDOWS_RS,
    pattern: /\.window_classname\(\s*"Mapper\./,
    count: 3,
    why: "all three windows use own Mapper.* classes",
  },
  {
    file: WINDOWS_RS,
    pattern: /\.additional_browser_args\(\s*BROWSER_ARGS\s*\)/,
    why: "WebView2 features that open extra UI stay off",
  },
  {
    file: WEBVIEW_RS,
    pattern: /add_PermissionRequested\(/,
    why: "every WebView2 permission request is denied",
  },
  {
    file: "src-tauri/Cargo.toml",
    pattern: /^tauri\s*=\s*\{[^}\n]*default-features\s*=\s*false/m,
    why: "tauri's default `dynamic-acl` feature would allow capabilities added at run time",
  },
];

// C-7: claims that Mapper is safe or invisible to anti-cheat. Russian-first, and `\b` is
// ASCII-only in JS, so the Russian stems carry no word boundaries.
export const CLAIMS = [
  /\bsafe(ly|ty)?\b(?!-area)/i,
  /\bundetect(ed|able)\b/i,
  /\bban[- ]?(free|proof)\b/i,
  /\b(no|zero)\s+(ban|risk)/i,
  /безопас/i,
  /(без|нет)\s+(бана|банов|риска)/i,
  /бан\S*\s+не\s+будет/i,
  /не\s+(детект|палит|банит|забанят|обнаружива)/i,
  /недетект|необнаружим/i,
];
// A claim preceded by a negation within two words is the honest disclaimer the plan requires
// ("Mapper не гарантирует безопасность аккаунта", "it is not safe to assume ...").
export const NEGATION_BEFORE = /(^|[\s(«"'])(не|нет|ни|not|no|never|cannot|can't)\s+(\S+\s+){0,2}$/i;
// Every place a user reads text from: docs, UI sources, tray and dialogs, installer metadata.
export const WORD_FILES = [
  "CHANGELOG.md",
  "package.json",
  "src-tauri/Cargo.toml",
  "src-tauri/tauri.conf.json",
  "src-tauri/src/app/tray.rs",
  "src-tauri/src/lib.rs",
];
export const WORD_DIRS = ["src/apps", "src/lib/i18n", "src/lib/components"];

export const CSP_CONNECT = {
  csp: ["ipc:", "http://ipc.localhost"],
  devCsp: ["ipc:", "http://ipc.localhost", "ws://localhost:5173", "http://localhost:5173"],
};

export const BANNED_NPM = [
  "robotjs",
  "@nut-tree",
  "iohook",
  "uiohook-napi",
  "node-global-key-listener",
  "screenshot-desktop",
  "@tauri-apps/plugin-",
];

// Functions the release exe must not import unless antiban/imports-baseline.txt explains why.
export const FORBIDDEN_IMPORTS = new Set([
  "SendInput", "keybd_event", "mouse_event", "BlockInput", "SetCursorPos", "ClipCursor", "InjectTouchInput",
  "InjectSyntheticPointerInput", "AttachThreadInput", "SwitchToThisWindow",
  "SetWindowsHookExA", "SetWindowsHookExW", "SetWinEventHook", "RegisterRawInputDevices", "GetRawInputData",
  "GetRawInputBuffer", "GetAsyncKeyState", "GetKeyboardState",
  "OpenProcess", "OpenThread", "ReadProcessMemory", "WriteProcessMemory", "VirtualAllocEx", "CreateRemoteThread",
  "NtReadVirtualMemory", "NtQuerySystemInformation", "NtQueryInformationProcess", "DebugActiveProcess",
  "EnumProcesses", "K32EnumProcesses", "EnumProcessModules", "K32EnumProcessModules", "CreateToolhelp32Snapshot",
  "Process32FirstW", "Process32NextW", "Module32FirstW", "Module32NextW", "QueryFullProcessImageNameW",
  "K32GetModuleFileNameExW",
  // GetProcAddress / LoadLibrary* are imported by every Rust exe (std, WebView2 loader);
  // they are caught in source instead.
  "BitBlt", "StretchBlt", "PrintWindow", "GetPixel", "GetDIBits", "DwmRegisterThumbnail", "MagInitialize",
  "FindWindowA", "FindWindowW", "FindWindowExA", "FindWindowExW", "EnumWindows", "GetWindowThreadProcessId",
]);
export const NO_ORDINAL_DLLS = new Set(["user32.dll", "kernel32.dll", "gdi32.dll", "ntdll.dll", "kernelbase.dll"]);

// C-9: what the MSVC linker emits for a plain Rust exe; packers add their own sections.
export const PE_SECTIONS = new Set([".text", ".rdata", ".data", ".pdata", ".rsrc", ".reloc", ".tls", "_RDATA"]);

export const EXE_NAME = "mapper.exe";
