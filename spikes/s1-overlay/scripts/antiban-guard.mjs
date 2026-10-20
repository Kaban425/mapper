#!/usr/bin/env node
// Anti-ban guard: fails (exit code 1) when the code base or the release binary reaches
// for anything that reads the game or the screen, enumerates processes or windows, or
// injects input. Run: `node scripts/antiban-guard.mjs [--exe <path>|--exe auto]`.
//
// Source rules work on raw text: only whole-line `//` comments are skipped, so string
// tricks such as `" //"` cannot hide code. Permissions use an exact allowlist.

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_DIRS = ["src-tauri/src", "ui"];
const EXTRA_FILES = [
  "src-tauri/build.rs",
  "src-tauri/Cargo.toml",
  "src-tauri/windows-app-manifest.xml",
  "src-tauri/.cargo/config.toml",
  ".cargo/config.toml",
];
const SOURCE_EXT = new Set([
  ".rs", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".vue", ".svelte", ".html", ".json", ".toml", ".xml",
]);
const EXE_NAME = "mapper-spike.exe";
const FOCUS_RS = "src-tauri/src/platform/win/focus.rs";
const HOTKEY_RS = "src-tauri/src/platform/win/hotkey.rs";

const SOURCE_RULES = [
  {
    group: "input injection",
    pattern:
      /\b(SendInput|keybd_event|mouse_event|BlockInput|SetCursorPos|ClipCursor|InjectTouchInput|InjectSyntheticPointerInput|AttachThreadInput|SwitchToThisWindow|SPI_SETFOREGROUNDLOCKTIMEOUT|KEYBDINPUT|MOUSEINPUT)\b/,
  },
  { group: "messages to other windows", pattern: /\b(PostMessage[AW]?|SendMessage[AW]?|SendNotifyMessage[AW]?|SendMessageTimeout[AW]?)\b/ },
  {
    group: "hooks, raw input, keyboard polling",
    pattern:
      /\b(SetWindowsHookEx[AW]?|SetWinEventHook|RegisterRawInputDevices|GetRawInputData|GetRawInputBuffer|GetAsyncKeyState|GetKeyboardState)\b/,
  },
  {
    group: "other processes",
    pattern:
      /\b(OpenProcess|OpenThread|ReadProcessMemory|WriteProcessMemory|VirtualAllocEx|CreateRemoteThread|NtReadVirtualMemory|NtQueryInformationProcess|NtQuerySystemInformation|DebugActiveProcess|Toolhelp32ReadProcessMemory|K32EnumProcesses|EnumProcesses|EnumProcessModules|CreateToolhelp32Snapshot|Process32(First|Next)[W]?|Module32(First|Next)[W]?|QueryFullProcessImageName[AW]?|GetModuleFileNameEx[AW]?|Win32_Process)\b/,
  },
  {
    group: "foreign windows",
    pattern:
      /\b(FindWindow(Ex)?[AW]?|EnumWindows|EnumChildWindows|EnumThreadWindows|GetWindowText[AW]?|GetClassName[AW]?|GetWindowThreadProcessId|WindowFromPoint|ChildWindowFromPoint(Ex)?|RealChildWindowFromPoint|GetWindowRect|GetClientRect|GetWindow|GetTopWindow|GetAncestor|GetLastActivePopup|GetShellWindow|GetDesktopWindow|GetGUIThreadInfo|DwmGetWindowAttribute|MonitorFromWindow|IUIAutomation\w*|AccessibleObjectFromWindow)\b/,
  },
  { group: "foreground window", pattern: /\b(GetForegroundWindow|SetForegroundWindow|IsWindow)\b/, allow: [FOCUS_RS] },
  { group: "thread messages", pattern: /\bPostThreadMessage[AW]?\b/, allow: [HOTKEY_RS] },
  {
    group: "screen capture",
    pattern:
      /\b(BitBlt|StretchBlt|PrintWindow|GetDC|GetDCEx|GetWindowDC|CreateDC[AW]?|GetPixel|GetDIBits|DuplicateOutput\d?|IDXGIOutputDuplication|GraphicsCapture\w*|Direct3D11CaptureFramePool|DwmRegisterThumbnail|MagInitialize|CapturePreview|getDisplayMedia|getUserMedia|html2canvas)\b/,
  },
  {
    group: "browser device access",
    pattern: /\b(mediaDevices|getGamepads|requestPointerLock|requestFullscreen)\b|navigator\s*\.\s*(keyboard|hid|usb|serial|bluetooth)\b/,
  },
  {
    group: "tao paths that synthesise Alt",
    pattern: /(\.set_focus\s*\(|\bsetFocus\s*\(|\bfullscreen\s*\(|set_fullscreen|setFullscreen|"?fullscreen"?\s*:\s*true)/,
  },
  { group: "cursor control", pattern: /(set_cursor_position|set_cursor_grab|setCursorPosition|setCursorGrab)/ },
  {
    group: "menu items that synthesise Ctrl+key",
    pattern:
      /PredefinedMenuItem::(copy|cut|paste|select_all|undo|redo)\b|\.(copy|cut|paste|select_all|undo|redo)\s*\(\s*\)|Menu::default\s*\(|PredefinedMenuItem\s+as\b/,
  },
  { group: "raw input re-enabled", pattern: /DeviceEventFilter::(Never|Unfocused)|set_device_event_filter/ },
  {
    group: "dynamic or raw linking",
    pattern:
      /\b(GetProcAddress|LoadLibrary(Ex)?[AW]?|libloading|winapi::|windows_sys::|link_name|link_ordinal|raw[-_]dylib)\b|extern\s+"(system|C|stdcall)"\s*\{|#\[link\b|\blink!\s*\(/,
  },
  { group: "process spawning", pattern: /\bCommand::new\s*\((?!\s*"explorer"\s*\))/ },
  { group: "game names and files", pattern: /\b(TslGame|PUBG|BATTLEGROUNDS|steamapps|GameUserSettings|Engine\.ini)\b/i },
  { group: "dependency overrides", pattern: /^\s*\[(patch|replace)\b/ },
  { group: "elevation", pattern: /requireAdministrator|highestAvailable|uiAccess\s*=\s*"true"/ },
];

// Statements that must exist: they switch dependency behaviour off or pin privileges.
const REQUIRED = [
  {
    file: "src-tauri/src/main.rs",
    pattern: /\.device_event_filter\(\s*tauri::DeviceEventFilter::Always\s*\)/,
    why: "tao must not register mice and keyboards for raw input",
  },
  {
    file: "src-tauri/windows-app-manifest.xml",
    pattern: /level="asInvoker"\s+uiAccess="false"/,
    why: "C-8: no elevation, no UI access",
  },
];

const BANNED_CRATES = [
  "enigo", "rdev", "inputbot", "device_query", "winput", "autopilot", "rustautogui", "mouce",
  "livesplit-hotkey", "win-hotkeys", "willhook", "multiinput", "global-hotkey",
  "xcap", "screenshots", "scrap", "captrs", "dxgcap", "win-screenshot", "windows-capture",
  "sysinfo", "process-memory", "read-process-memory", "memflow", "dll-syringe", "retour", "minhook", "libloading",
  "tauri-plugin-shell", "tauri-plugin-single-instance", "tauri-plugin-global-shortcut",
];

const BANNED_NPM = [
  "robotjs", "@nut-tree", "iohook", "uiohook-napi", "node-global-key-listener", "screenshot-desktop",
  "@tauri-apps/plugin-shell", "@tauri-apps/plugin-global-shortcut",
];

// Exact allowlist: anything else (core:default, menu, window creation...) fails.
const ALLOWED_PERMISSIONS = new Set(["core:event:allow-listen", "core:event:allow-unlisten"]);

const FORBIDDEN_IMPORTS = new Set([
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
const NO_ORDINAL_DLLS = new Set(["user32.dll", "kernel32.dll", "gdi32.dll", "ntdll.dll", "kernelbase.dll"]);

const problems = [];
const notes = [];
const rel = (path) => relative(ROOT, path).replaceAll("\\", "/");

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

function sourceFiles() {
  const tauriDir = join(ROOT, "src-tauri");
  const configs = readdirSync(tauriDir)
    .filter((name) => /^tauri(\..+)?\.conf\.json5?$|^Tauri\.toml$/.test(name))
    .map((name) => join(tauriDir, name));
  const all = [
    ...SOURCE_DIRS.flatMap((d) => walk(join(ROOT, d))),
    ...EXTRA_FILES.map((f) => join(ROOT, f)).filter(existsSync),
    ...configs,
  ];
  return [...new Set(all)].filter((f) => SOURCE_EXT.has(extname(f)) || f.endsWith(".json5"));
}

function checkSources() {
  const files = sourceFiles();
  for (const file of files) {
    const path = rel(file);
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, index) => {
        if (/^\s*\/\//.test(line)) return; // whole-line comment
        for (const rule of SOURCE_RULES) {
          if (rule.pattern.test(line) && !(rule.allow ?? []).includes(path)) {
            problems.push(`source  ${path}:${index + 1}  [${rule.group}]  ${line.trim().slice(0, 160)}`);
          }
        }
      });
  }
  notes.push(`sources: ${files.length} files scanned against ${SOURCE_RULES.length} rule groups`);
}

function checkRequired() {
  let present = 0;
  for (const rule of REQUIRED) {
    const path = join(ROOT, rule.file);
    const text = existsSync(path)
      ? readFileSync(path, "utf8").split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n")
      : "";
    if (rule.pattern.test(text)) present += 1;
    else problems.push(`missing ${rule.file}: ${rule.pattern.source} (${rule.why})`);
  }
  notes.push(`required statements: ${present}/${REQUIRED.length} present`);
}

function lockVersions() {
  const lock = join(ROOT, "src-tauri", "Cargo.lock");
  if (!existsSync(lock)) return null;
  const versions = new Map();
  for (const m of readFileSync(lock, "utf8").matchAll(/^name = "([^"]+)"\r?\nversion = "([^"]+)"/gm)) {
    versions.set(m[1], [...(versions.get(m[1]) ?? []), m[2]]);
  }
  return versions;
}

function findCargo() {
  const home = process.env.CARGO_HOME ?? join(process.env.USERPROFILE ?? "", ".cargo");
  const candidate = join(home, "bin", "cargo.exe");
  return existsSync(candidate) ? candidate : "cargo";
}

// Crates actually compiled for Windows. Cargo.lock also lists Linux/macOS-only crates
// (e.g. libloading under the Linux tray), so it is only the fallback.
function windowsCrates() {
  try {
    const out = execFileSync(
      findCargo(),
      ["tree", "--target", "x86_64-pc-windows-msvc", "-e", "normal,build", "--prefix", "none", "--format", "{p}"],
      { cwd: join(ROOT, "src-tauri"), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    return new Set(out.split(/\r?\n/).map((line) => line.split(" ")[0]).filter(Boolean));
  } catch {
    return null;
  }
}

function checkCrates(versions) {
  if (!versions) {
    problems.push("Cargo.lock is missing; run cargo generate-lockfile first");
    return;
  }
  const windows = windowsCrates();
  const scope = windows ?? new Set(versions.keys());
  const where = windows ? "is compiled into the Windows build" : "is in Cargo.lock (cargo tree failed, checking every platform)";
  for (const crate of BANNED_CRATES) if (scope.has(crate)) problems.push(`crate   ${crate} ${where}`);
  notes.push(
    windows
      ? `crates: ${windows.size} compiled for Windows checked (${versions.size} in Cargo.lock)`
      : `crates: cargo not found, checked all ${versions.size} in Cargo.lock`,
  );
}

function checkNpm() {
  const lock = join(ROOT, "package-lock.json");
  if (!existsSync(lock)) {
    notes.push("package-lock.json: none (no npm dependencies)");
    return;
  }
  const text = readFileSync(lock, "utf8");
  for (const pkg of BANNED_NPM) if (text.includes(`"node_modules/${pkg}`)) problems.push(`npm     ${pkg} is in package-lock.json`);
}

function checkCapabilities() {
  const files = walk(join(ROOT, "src-tauri", "capabilities")).filter((f) => /\.json5?$|\.toml$/.test(f));
  for (const file of files) {
    let capability;
    try {
      capability = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      problems.push(`acl     ${rel(file)} is not plain JSON; only JSON capabilities are allowed`);
      continue;
    }
    if (capability.remote) problems.push(`acl     ${rel(file)} grants remote URLs`);
    if ((capability.windows ?? []).some((w) => w.includes("*"))) problems.push(`acl     ${rel(file)} uses a window wildcard`);
    for (const entry of capability.permissions ?? []) {
      const id = typeof entry === "string" ? entry : entry.identifier;
      if (!ALLOWED_PERMISSIONS.has(id)) problems.push(`acl     ${rel(file)} grants ${id} (not in the allowlist)`);
    }
  }
  notes.push(`capabilities: ${files.length} file(s) checked against an exact allowlist`);
}

function findDumpbin() {
  const vswhere = join(process.env["ProgramFiles(x86)"] ?? "C:/Program Files (x86)", "Microsoft Visual Studio/Installer/vswhere.exe");
  if (!existsSync(vswhere)) return null;
  const out = execFileSync(vswhere, ["-latest", "-products", "*", "-find", "VC/Tools/MSVC/**/bin/Hostx64/x64/dumpbin.exe"], {
    encoding: "utf8",
  });
  return out.split(/\r?\n/).find((line) => line.trim().endsWith("dumpbin.exe"))?.trim() ?? null;
}

// Baseline file: `Name # reason` lines plus one `# audited: crate=version ...` header.
function readBaseline() {
  const file = join(ROOT, "antiban", "imports-baseline.txt");
  const result = { entries: new Map(), audited: new Map() };
  if (!existsSync(file)) return result;
  for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    const audited = line.match(/^#\s*audited:\s*(.+)$/);
    if (audited) {
      for (const pair of audited[1].split(/\s+/)) {
        const [crate, version] = pair.split("=");
        if (crate && version) result.audited.set(crate, version);
      }
      continue;
    }
    if (!line || line.startsWith("#")) continue;
    const [name, ...why] = line.split("#");
    result.entries.set(name.trim(), why.join("#").trim());
  }
  return result;
}

function checkAuditedVersions(baseline, versions) {
  if (baseline.audited.size === 0) {
    problems.push("baseline: no '# audited: crate=version' line; the exceptions were never tied to versions");
    return;
  }
  for (const [crate, version] of baseline.audited) {
    const locked = versions?.get(crate) ?? [];
    if (!locked.includes(version)) {
      problems.push(`baseline: audited ${crate} ${version}, Cargo.lock has ${locked.join(", ") || "none"}; re-audit the imports`);
    }
  }
  notes.push(`baseline: audited versions match Cargo.lock (${[...baseline.audited.keys()].join(", ")})`);
}

function resolveExe(arg) {
  if (arg !== "auto") return resolve(arg);
  const target = process.env.CARGO_TARGET_DIR ?? join(process.env.LOCALAPPDATA ?? "", "mapper-target");
  return join(target, "release", EXE_NAME);
}

function parseImports(output) {
  const named = new Set();
  const ordinals = [];
  let dll = "";
  for (const line of output.split(/\r?\n/)) {
    const header = line.match(/^\s{4}(\S+\.dll)\s*$/i);
    if (header) {
      dll = header[1].toLowerCase();
      continue;
    }
    const byName = line.match(/^\s+[0-9A-F]+\s+([A-Za-z_][\w@?]*)\s*$/);
    if (byName) named.add(byName[1]);
    const byOrdinal = line.match(/^\s+Ordinal\s+(\d+)\s*$/);
    if (byOrdinal) ordinals.push(`${dll}#${byOrdinal[1]}`);
  }
  return { named, ordinals };
}

function checkManifestInExe(bytes) {
  const text = bytes.toString("latin1");
  if (!/level=["']asInvoker["']/.test(text) || !/uiAccess=["']false["']/.test(text)) {
    problems.push("manifest: the exe does not embed asInvoker / uiAccess=\"false\"");
  } else if (/requireAdministrator|highestAvailable|uiAccess=["']true["']/.test(text)) {
    problems.push("manifest: the exe requests elevation or UI access");
  } else {
    notes.push("manifest: asInvoker, uiAccess=false");
  }
}

function checkExe(exe, baseline) {
  if (!existsSync(exe)) {
    problems.push(`imports: ${exe} not found (build the release exe first)`);
    return;
  }
  checkManifestInExe(readFileSync(exe));
  const dumpbin = findDumpbin();
  if (!dumpbin) {
    problems.push("imports: dumpbin.exe not found (install the MSVC build tools)");
    return;
  }
  const output = execFileSync(dumpbin, ["/nologo", "/imports", exe], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const { named, ordinals } = parseImports(output);
  for (const entry of ordinals) {
    if (NO_ORDINAL_DLLS.has(entry.split("#")[0])) problems.push(`import  ${entry} is imported by ordinal; system APIs must be imported by name`);
  }
  for (const name of [...named].filter((n) => FORBIDDEN_IMPORTS.has(n)).sort()) {
    if (baseline.entries.has(name)) notes.push(`imports: ${name} allowed by baseline (${baseline.entries.get(name) || "no reason given"})`);
    else problems.push(`import  ${name} is imported by ${basename(exe)} and not in antiban/imports-baseline.txt`);
  }
  for (const name of baseline.entries.keys()) {
    if (!named.has(name)) notes.push(`imports: baseline entry ${name} is no longer imported; remove it`);
  }
  notes.push(`imports: ${named.size} functions by name, ${ordinals.length} by ordinal in ${exe}`);
}

function main() {
  const args = process.argv.slice(2);
  const exeIndex = args.indexOf("--exe");
  const versions = lockVersions();
  const baseline = readBaseline();
  checkSources();
  checkRequired();
  checkCrates(versions);
  checkAuditedVersions(baseline, versions);
  checkNpm();
  checkCapabilities();
  if (exeIndex >= 0) checkExe(resolveExe(args[exeIndex + 1] ?? "auto"), baseline);
  for (const note of notes) console.log(`  ok  ${note}`);
  if (problems.length > 0) {
    console.error(`\nanti-ban guard FAILED (${problems.length}):`);
    for (const problem of problems) console.error(`  x  ${problem}`);
    process.exit(1);
  }
  console.log("\nanti-ban guard passed");
}

main();
