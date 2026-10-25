# Implementation Record

**Feature**: mapper-overlay
**Started**: 2026-10-20
**Status**: IN_PROGRESS — Phases 1 and 2 PASS and committed; Phase 3 (main window) next

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

## Phase 2: Ядро замера, оверлей и HUD — PASS (2026-10-25)

Implemented directly (2026-10-22).

### Deliverables
- T2.1 `src/lib/core`: `constants`, `types`, `calibration` (cell from clicks, nudge, wheel factor, 1 km ↔ 100 m,
  fits-viewport, 10× check, 3-cell check), `measurement` (segments, route, error model, ticks — eng's
  `error.ts`/`ticks.ts` live here), `mortar` (PUBGMortar.NET model; L and the sight value must be in 121–700 m;
  for L ≤ 700 a solvable shot never needs a sight above 700, so only "too close" can come from R),
  `travel`, `format` (RU narrow no-break spaces, real minus, m:ss / h:mm:ss), `result`.
  Golden vectors `tests/golden/{mortar,error}.json`, fast-check properties.
- T2.2 `session.ts` (pure reducer: activation, 4-step setup with step back, measuring, Ctrl+wheel / T / middle
  click with delayed save, preset switch keeping points, swallowed activation click, end of session → save +
  submit) and `exitGate.ts` (held keys, hotkey key-up, safety timeout).
- T2.9 `src/lib/i18n`: `ru.ts` source, `en.ts` typed against it, `t()` with `{name}` and plural forms; tests
  check keys, placeholders and Russian one/few/many. Overlay and HUD texts only; main window texts in Phase 3.
- T2.3 `src-tauri/src/config`: types and defaults (Dacia 100 km/h per О-1, panel opacity 0.78–0.94 per ux §9.1
  instead of eng's 0.35–1), `MonitorKey` (`2560x1440@125`), `validate` (clamps, canonical hotkeys, drops broken
  scales, keeps 16 newest monitors), `ConfigStore` (atomic tmp → sync → rename, broken file kept as
  `config.broken-<unix>.json`, newer schema read-only, 256 KiB limit). Nothing is written until the first change.
- T2.4 `app/overlay`: `phase.rs` pure machine with the spike rules (13 tests), `mod.rs` executor (no lock across
  window calls, timers through `mapper-timers`, raw-input self-check on every activation, foreground captured
  once and restored once), `placement.rs` (pinned → cursor → primary monitor, monitor − 1 px, DPI-safe resize),
  `events.rs` payloads, `result.rs` (validated `MeasurementResult`, kept in memory only).
  `app/hud.rs`: top-left 24 CSS px on the measured monitor, 10 s with a generation counter, idle when hidden.
  Tray "measure" items and hotkeys now open the overlay; quitting closes an open overlay first.
- T2.5 commands `overlay_exit`, `overlay_blank`, `save_calibration`, `submit_result`: overlay window only,
  `deny_unknown_fields`, range checks, `stale_session` for an older session; monitor, size and scale of a saved
  scale come from the session. COMMANDS / handler / ACL / acl.json updated together (guard checks all four).
- T2.6 `src/lib/ipc`: `types`, `validate` (shape checks of every event), `transport` with `tauri.ts` (listeners
  always target their own window — security review LOW 4) and `mock.ts` (e2e), `events.ts`, `commands.ts`.
  Contract fixtures `src-tauri/tests/ipc-fixtures` written by Rust (`UPDATE_FIXTURES=1`) and checked by
  `tests/ipc/contract.test.ts`; hand-written argument fixtures parsed by Rust.
- T2.7 overlay UI: `controller.svelte.ts` (reducer + timers + exit gate + events), `Grid`/`Route` SVG layers,
  `MeasurePanel` (moves away from the cursor), `CalibratePanel` (step N of 4, 10× warning, step-1 buttons),
  `ClickToStart` (countdown), `PresetBadge` (word + lens shape), `view.ts` pure texts, `glass.css`.
- T2.8 HUD UI: result in its own language, fade in/out, no commands.
- T2.10 e2e: Playwright 1.64.1 on the installed Microsoft Edge (no browser download), Vite `--mode e2e` on
  127.0.0.1:5174, 16 scenarios × 3 scales (1, 1.25, 1.5) = 48 runs; added to CI.

### Found and fixed on the way
- Vite with root `src/` did not load `svelte.config.js` (also in the release build) — now passed explicitly.
- The reducer kept `focused` after "focus not taken"; it now matches Rust's phase machine.
- Visual pass on screenshots: rows in the UI font with tabular figures (mono only for the big distance),
  travel as label · time · speed columns, "not verified" on its own line, spacing after ⚠.
- Guard: the game's name is allowed only in `src/lib/i18n/` (UI texts); game files/processes stay banned.

### Verification (2026-10-22)
- Vitest 180/180, core coverage ≈ 96 % lines / 92 % branches; svelte-check 0/0; e2e 48/48.
- Rust: fmt, clippy `-D warnings`, 75/75 tests; cargo deny ok; guard passed.
- Release `mapper.exe` 3.3 MB, guard:exe passed (same 10 baseline imports, 340 by name, 0 by ordinal).
- Smoke run: config loaded, Alt+Q / Alt+W registered, raw input 0. The overlay itself needs the in-game check.

### Author's in-game check and changes (2026-10-22)
In-game: calibration fast and clear. Requests, decided with the author:
- **Route carried across a zoom change** (replaces the in-place preset switch, ux F-5 updated): the other
  hotkey parks the route (2 min) and closes the overlay after the keys are up, HUD says how to continue;
  the same hotkey again restores the points in place; the other zoom shows a ghost of the route at the
  cursor and the anchor click lays it out by the ratio of the two scales (`core/carry.ts`, property test:
  the length in metres is kept). Rust: the other hotkey now requests an exit (`SwitchPreset` + exit
  timeout); `overlay_exit` reason `switchZoom` → HUD notice `routeKept` instead of a result.
- **T removed** (it looked like G at full zoom-in: 1 km lines leave the screen); G shows and hides the grid.
- **Lighter glass**: panel opacity default 0.65, range 0.50–0.94 (below ux's WCAG floor of 0.78 by the
  author's choice); text gets a dark shadow. Config schema 2 with a migration: version 1's default 0.86
  becomes 0.65 (the player could not have chosen it yet).
- **Thinner lines and numbers**: route 1.6 px (halo 3.6), ticks 1.1/1.5 px, points r 5, map labels UI font
  500 13 px with a 3 px halo, big numbers 600 28/30 px.

### Security review — no C-1..C-9 violation, fixed (2026-10-25)
- HIGH the HUD could take the focus: tao's `show()` uses SW_SHOW once a window exists (`MARKER_DONT_FOCUS`
  only applies at creation), right after the overlay had the focus. The HUD is now shown with raw
  `SW_SHOWNOACTIVATE` + `HWND_TOPMOST`/`SWP_NOACTIVATE` and hidden with `SW_HIDE` (`window_style.rs`); a warning
  is logged if it ever is the foreground window; guard: no `.show/.hide/set_visible(` in `hud.rs`.
- MEDIUM mouse polling was not banned: `GetCursorPos`, `GetPhysicalCursorPos`, `GetCursorInfo`,
  `GetMouseMovePointsEx` join the polling rule and FORBIDDEN_IMPORTS; `cursor_position(` only in
  `placement.rs`, exactly once (REQUIRED); `GetCursorPos` explained in the imports baseline (README: Phase 5).
- LOW tray-started measurement captured the tray menu's own window as "foreign": `on_tray` keeps no foreground.
- LOW no monitor or window: the phase machine now asks for focus only after `Shown { ok }`; a failed show
  returns to Hidden without activating anything.
- LOW guard: HUD imports only `ipc/events` and `ipc/types`; `$transport` only in `lib/ipc` (+ Vite configs);
  commands only from `lib/ipc`, `apps/main`, `apps/overlay`; the Tauri API only in `tauri.ts`, whose every
  `listen(` names a target; the mock only in `mock.ts` (tests exempt), picked only by `--mode e2e` (REQUIRED),
  `scripts.build` pinned to `vite build`, `--exe` fails if `dist/` contains `__MAPPER_MOCK__`; relative imports
  from `src/` are resolved: none may leave `src/`, and the IPC limits hold by resolved path (`../ipc/./commands`).
  Every rule was checked against a planted violation.
- LOW config read/write mismatch: `MonitorKey::new` returns None for a size `parse` would refuse; a scale is
  checked with `is_valid_calibration` before writing (`invalid_input` instead of a silent drop); calibrations
  are parsed one entry and one preset at a time, so one bad entry no longer resets the whole file.
- LOW the 150 ms blank timeout could turn the last save or result into `stale_session`: saves and results of
  the latest session are accepted after it closed; a late result shows the HUD at once.
- Nits: `CalibrationArgs.origin` is a `PointArgs` with `deny_unknown_fields`; the ETag must be visible ASCII;
  Playwright starts Vite with `npx --no --`.

### Code review — no CRITICAL, fixed (2026-10-25)
- MEDIUM the Overlay lock was held across `SetForegroundWindow` (temporary guard in one `let`): taken out first.
- MEDIUM the store could overwrite `config.json` after a failed read or a failed move aside (a backup or
  antivirus lock): such a file is left in place and moved aside before the first write, never written over
  (`Access::MoveFirst`, notice `config-unreadable`); Windows test with a no-share handle.
- MEDIUM the opacity setting never reached the screen (`--ov-panel` was resolved once on `:root`): `.glass`
  uses `var(--ov-alpha)` directly; e2e checks the computed colour of the panel and the HUD.
- MEDIUM "saved" was shown before Rust answered and refusals were only logged: "saved" appears on success,
  a refusal stays on screen with its reason (newer config, disk error, other); Ctrl+wheel says "adjusted".
- LOW the save pause restarted on every mouse move: only scale changes restart it.
- LOW a parked route came back in place on another monitor: the monitor key travels with it; another monitor
  takes the anchor click.
- LOW the "route kept" HUD depended on beating Rust's exit timeout: a late `switchZoom` exit is accepted while
  the session closes, and the blank hand-over sends it if the key-up never came.
- LOW two identical points said "too high": distance 0 is "too close".
- LOW the HUD flashed on quit: `Hide { hud: false }` while quitting.
- LOW the 3-cell check stayed all session: it goes once the player moves on from the first two-point measurement.
- LOW grid and route were rebuilt on every mouse move: narrow derived inputs, only the cursor parts follow it.
- LOW tests: controller unit tests (save answers, save pause, park lifetime, late exit, hand-over; the expiry
  test fails when the expiry is removed); unused `hud.mortar` / `hud.dh` removed.
- Not changed, LOW 9 (a key-up that arrives before the exit request): the gate keeps waiting up to 800 ms.
  Any "a key-up was seen earlier" rule would also accept the release from the press that *opened* the overlay
  (hold Alt, tap Q twice), handing focus back while Q is down; the slow path is the safe one.

### Verification after the reviews (2026-10-25)
- Vitest 203/203 (core 96.6 % statements, 98.5 % lines); svelte-check 0/0; e2e 60/60 (20 × 3 scales).
- Rust: fmt, clippy `-D warnings`, 80/80 tests; cargo deny ok after tokio 1.54.0 → 1.54.1 (RUSTSEC-2026-0384,
  published since the last run); guard passed (46 rules, 12 required statements).
- Release `mapper.exe` 3.3 MB; guard:exe passed (11 baseline imports, 340 by name, 0 by ordinal, no test
  transport in `dist/`). Smoke run: existing config with the 2560x1440@125 scale loaded, hotkeys registered,
  raw input 0. Copied to `test-build/`.

### User validation
- 2026-10-25: **PASS** — the author checked the build in game: route carry, lighter glass, "saved" and the
  HUD work, the game keeps the focus. Commit approved.

### Notes
- The sandboxed build shell blocks loopback connections; e2e runs needed the sandbox lifted (localhost only).
- Playwright report upload as a CI artifact is left for Phase 5 (needs a pinned `upload-artifact` SHA).
