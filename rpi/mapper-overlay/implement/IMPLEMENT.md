# Implementation Record

**Feature**: mapper-overlay
**Started**: 2026-10-20
**Status**: IN_PROGRESS — Phase 1 PASS and committed; Phase 2 next

## Phase 1: Каркас и платформа — PASS (2026-10-21)

The first attempt stalled (TypeScript 7 is out; svelte-check accepts only 5/6),
so Phase 1 is implemented directly.

### Deliverables
- P-1: git repo, `.gitignore`, `.gitattributes`, first commit `0877d9c` (rpi + spikes).
  Local author is a placeholder (`Mapper developer <mapper-dev@example.invalid>`) — rewrite before publishing.
- T1.1 frontend: `package.json` (pinned: tauri api 2.12.4 / cli 2.12.3, svelte 5.57.2, vite 8.3.4,
  typescript **6.0.3** — 7.x is not supported by svelte-check 4.7.7), three entries `src/{main,overlay,hud}.html`,
  `src/apps/*`, `src/lib/styles/{tokens,base}.css`, `src/lib/ipc/commands.ts`.
- T1.2–T1.4: `src-tauri/` (lib `mapper_lib` + bin `mapper`), `build.rs` with `AppManifest::commands`
  (`log_line`, `quit_app`), manifest asInvoker/uiAccess=false, `tauri.conf.json`, capabilities main/overlay/hud,
  `antiban/acl.json`, `rust-toolchain.toml` (1.99.1), `src-tauri/rustfmt.toml` (max_width 120).
- T1.5–T1.9: `platform/win/{focus (OwnHwnd/ForeignHwnd), hotkey, window_style, raw_input, webview (idle + harden),
  single_instance, dialog, locale}`, `app/{mod, windows, main_window, tray, timers}`, `hotkeys/{spec, service}`,
  `logging.rs`, `commands/mod.rs`, `preset.rs`, `lib.rs`.
- T1.10 guard at the root: `scripts/antiban-guard.mjs` + `scripts/guard/{context,rules,sources,tauri,deps,exe}.mjs`.
  All spike rules kept; added now (cheap parts of eng §7): `unsafe` only in `platform/win/`, single-instance
  primitives only in `single_instance.rs`, registry only in `autostart.rs`, network only in `update/`,
  window effects only in `app/windows.rs`, no `.emit(` (only `emit_to`), `Command::new` only `"explorer"` in
  `shell.rs`; web: `@tauri-apps/api/{core,event}` only in `src/lib/ipc/`, HUD never imports commands, no
  fetch/XHR/WebSocket/storage/eval/innerHTML/`{@html}`; required statements (8); `tauri.conf.json` parsed
  (withGlobalTauri, windows [], freezePrototype, CSP directives, NSIS currentUser, no devtools/plugins);
  per-window ACL ⊆ `antiban/acl.json`, no hand-written permission files; the four command lists agree;
  banned crates read from `deny.toml` (one list); npm direct deps ⊆ `antiban/npm-allowlist.json`, no
  lifecycle scripts, install scripts only allow-listed; README/i18n wording; exe: imports vs baseline,
  ordinals, manifest, `VS_VERSIONINFO` ProductName, standard PE sections.
  Deferred to Phase 4 as planned: tokenizer, `dist/**/*.js` scan, `guard:obj`, violation fixtures.
- `deny.toml` (root): 39 banned crates (31 from the spike + opener, fs, process, autostart, auto-launch,
  reqwest, http, updater), `windows`/`windows-sys` feature bans, `[sources]` crates.io only,
  `[licenses]` Apache-2.0, BSD-3-Clause, MIT, MPL-2.0, Unicode-3.0, Zlib; `[advisories]` unmaintained = all.
  Note: in cargo-deny 0.20 `--config` goes before `check`.
- `antiban/imports-baseline.txt` re-audited on `mapper.exe` 0.1.0: the same 10 imports as the spike; runtime
  `GetProcAddress` lookups of dependencies documented (DPI, pointer, dark mode, SetWindowCompositionAttribute);
  `wry` and `window-vibrancy` added to the `# audited:` line.
- T1.11: `.github/workflows/checks.yml` + `pr.yml` (actions pinned by commit SHA).

### Verification (2026-10-21)
- `cargo fmt --check` OK, `cargo clippy --all-targets --locked -D warnings` clean, `cargo test` 27/27.
- `npm run check` 0 errors / 0 warnings, `npm run build` OK.
- `cargo deny ... check`: advisories ok, bans ok, licenses ok, sources ok.
- `npm run guard` passed; planted violations (HUD importing commands, `@tauri-apps/api/event` outside ipc,
  innerHTML, localStorage, fetch, `unsafe`, `.emit(`, `Command::new("cmd")`) all caught.
- `npx tauri build --no-bundle`: `mapper.exe` 3.2 MB in 1 m 42 s; `npm run guard:exe` passed
  (10 baseline imports, 337 by name, 0 by ordinal; sections .text .rdata .data .pdata .rsrc .reloc).
- Smoke run: log shows WebView2 155.0.4283.62, both monitors, raw input devices 0, Alt+Q and Alt+W
  registered via RegisterHotKey; a second copy exits with code 0 and the first keeps running.
- tao 0.37.1 source re-checked: a visible, focused window at creation does not call `force_window_active`
  (only `set_focus()` and fullscreen-at-creation do; both banned).

### Code review — NEEDS REVISION → fixed
19 findings (1 HIGH, 2 MEDIUM, 15 LOW, 1 nit), every one verified against the code and fixed:
- HIGH guard gaps around the SendInput paths the baseline relies on: `copy_with_text` & co. and any
  `PredefinedMenuItem` but separator, `set_focus` in any spelling (UFCS, `plugin:window|set_focus`),
  `SendMessage*`/`SendDlgItemMessage`/`HWND_BROADCAST`, `"plugin:` strings from the web view.
- MEDIUM ACL bypasses: platform configs (`tauri.windows.conf.json` is merged automatically) now fail;
  tauri built with `default-features = false` (no `dynamic-acl`; required by the guard, banned in deny.toml);
  `add_capability` / `capabilities_path_pattern` banned.
- MEDIUM name holes: `InternalGetWindowText`, `...TextLength`, `RealGetWindowClass`, `WindowFrom*Point`,
  `GetKeyState`, `GetLastInputInfo`, `CreateProcess*`/`WinExec`/`ShellExecute*` (shell.rs only),
  `WTSEnumerateProcesses`, `Nt*`/`Zw*`/`K32*`, `extern {}` / `extern "C-unwind" {}`, `include!` / `#[path]`,
  `TcpListener`/`std::net`/WinHTTP; RegisterHotKey calls only in hotkey.rs; deny.toml bans
  `Win32_System_RemoteDesktop` and `Win32_System_StationsAndDesktops`.
- LOW app fixes: raw-input check fails closed on API error; log rotation truncates (with a warning) when a
  viewer blocks the rename and reopens after a failure; sanitising escapes U+2028/2029 and bidi controls and
  bounds the escaped length; `Bindings::set` clears a stale "busy" while suspended; rollback tested with a
  one-shot failing fake; `shutdown` is idempotent; an elevated first copy no longer makes the second fail;
  failed Alt-menu subclass is logged; `HotkeyStatus.error` omitted when none; Windows build and panics logged;
  `logFailure`/`describeError` in `lib/ipc` (with tests); timer tests no longer timing-sensitive.
- LOW guard fixes: every CSP directive limited to `'self'`/`'none'` (+ `unsafe-inline` styles, `data:` images,
  the IPC origins); npm aliases checked by real name; `pre*`/`post*` hook scripts banned; audited versions must
  be the only locked version; `--exe auto` audits the newest build; Russian claims added to the wording rule.
- Spec alignment: `unmaintained = "workspace"` (eng §7.8); vitest coverage thresholds 80 % for `lib/core`.
- CI: the guard now runs first and through `node` (an npm `pre*` hook would run before it otherwise),
  cargo deny right after it; the exe guard after `tauri build`.

All 19 bypass lines from the review were planted and caught, then removed.

### Verification after fixes (2026-10-21)
- fmt OK, clippy `-D warnings` clean, `cargo test` 34/34, svelte-check 0/0, vitest 3/3, coverage run OK, build OK.
- cargo deny: advisories, bans, licenses, sources ok. Guard passed (218 Windows crates, 39 bans).
- Release `mapper.exe` 3.1 MB; guard:exe passed — the same 10 baseline imports, 337 by name, 0 by ordinal.
- Smoke run: `Windows 10.0.28000; WebView2 155.0.4283.62`, raw input 0, Alt+Q/Alt+W registered, a second copy
  exits 0 and the first logs "another copy was started: showing the main window".

### Security review — no CRITICAL, fixed
No C-1..C-9 violation in the code. Guard gaps, each verified and fixed (every bypass was planted and caught):
- HIGH Cargo compiling unscanned code: `scripts/guard/cargo.mjs` requires every Cargo.lock package but
  `mapper` to come from crates.io with a checksum; Cargo.toml may not use `path =` (except `src/main.rs`),
  `build =`, git/registry deps, `[patch]`/`[replace]`/`[workspace]` in any spelling (spaces, dotted keys);
  no `.cargo/` config directories; every Cargo target is built from `src-tauri/src` or `build.rs`.
- HIGH WinRT through safe Rust (`InputInjector`, `ProcessDiagnosticInfo`): deny.toml pins the exact unified
  feature set of `windows` (`exact = true`), so any new feature fails whoever enables it; source rule bans
  WinRT namespaces, `use windows::{`, `use windows as`, `extern crate`.
- HIGH no crate allowlist: `antiban/crates-allowlist.json` (8 direct deps with reasons) checked through
  `cargo metadata --no-deps`; renamed dependencies fail; `uiautomation` banned, `UIAutomation*` names banned.
- MEDIUM ACL widened by data: permitted identifiers are hard-coded in the guard (core event listen/unlisten
  + `allow-<cmd>` for COMMANDS); `permissions/autogenerated/` may hold only the files tauri-build writes,
  without `[[set]]`; `permissions_path_pattern` banned.
- MEDIUM native code at link time: `cargo:rustc-link-*`/`rustc-flags`, `cc::`/`cmake::`, `asm!` banned;
  committed native files (`.obj .o .lib .a .dll .exe .res .c .cpp .asm .s`) outside `spikes/` fail.
- MEDIUM Phase 4 object check would read the empty bin object: eng §7.6 now uses `--lib`,
  `mapper_lib-*.o` and a canary (`RegisterHotKey`, `SetForegroundWindow`, `GetRegisteredRawInputDevices`).
- MEDIUM installer payloads: `tauri.conf.json` keys are allow-listed per section (no `externalBin`,
  `resources`, `runner`, NSIS template, inline capabilities), build commands must be exact, `installerHooks`
  only `nsis/hooks.nsh` and that file may not Exec/WriteReg/File.
- MEDIUM wording: negation-aware claim rules (RU + EN stems; "Mapper не гарантирует безопасность" passes,
  "Mapper безопасен" fails) over README, CHANGELOG, `src/apps`, i18n, components, tray, dialogs, configs.
- LOW: exactly one `device_event_filter(` and no default filter; WebView2 permission denial is installed first
  and its failure stops Mapper, other settings stay best effort; navigation only from `http://tauri.localhost`
  (+ Vite in dev), refused navigations logged by scheme and host; log path masked as `%USERPROFILE%`, start-up
  summary repeated after every rotation; a second copy that cannot reach the first shows a dialog instead of
  exiting silently (event open retried for 0.5 s); CI checkout without persisted credentials, `release`
  input turns off both caches.
- Carried to Phase 2 (eng §7.3): `listen()` always with an explicit `WebviewWindow` target.

### Final verification (2026-10-21)
- fmt, clippy `-D warnings`, `cargo test` 35/35, svelte-check 0/0, vitest 3/3, coverage run, build: OK.
- cargo deny all ok; guard passed (39 rules, 10 required statements, 401 crates.io packages, 8 allow-listed
  direct deps, 218 Windows crates against 40 bans).
- Release exe: guard:exe passed, the same 10 baseline imports. Smoke run: masked log path, raw input 0,
  Alt+Q/Alt+W registered, no refused navigations, second copy shows the first window.

### User validation
- 2026-10-21: **PASS** — the author checked the exe: window, tray, close to tray, second copy and exit work.
  Commit after the security review (done above).
