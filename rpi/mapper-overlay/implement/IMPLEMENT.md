# Implementation Record

**Feature**: mapper-overlay
**Started**: 2026-10-20
**Status**: IN_PROGRESS — Phases 1–4 PASS and committed; Phase 5 (release and docs) next

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

## Phase 3: Главное окно (GUI) — PASS (2026-10-26)

Implemented directly (2026-10-25). Scope agreed by default after the author's
question was interrupted: T4.1 autostart and T4.4 links/folders pulled into this phase (local and
small); T4.2 network update check stays in Phase 4 (only its on/off setting is saved now); links
keep the `OWNER` placeholder until the author names the GitHub account.

### Deliverables
- T3.1 components (`src/lib/components`): Button (with `ref`), Toggle (`role="switch"`), Slider
  (`aria-valuetext`), NumberField (Enter/blur, refusal under the field, `aria-invalid`), Segmented
  (radio group, arrows), StatusBadge (tick / circle / triangle + word), Steps, Dialog (native
  `<dialog>`, `data-focus`). Main window layout in `src/apps/main/main.css`: only the content scrolls,
  forced-colors fallbacks, focus ring from `base.css`.
- T3.2 `app/snapshot.rs` (`AppSnapshot`: settings without bookkeeping fields, `HotkeysState`,
  connected displays, scales per monitor key, pinned-missing, armed preset, open overlay session, last
  measurement, autostart status) and `commands/main_window.rs`: `get_snapshot`, `update_settings`
  (`deny_unknown_fields`, values out of range refused, Dacia "not verified" goes away when typed,
  pinned monitor resolved by name), `set_hotkey` (parse + `spec::check_recordable` + test
  `RegisterHotKey`, saved and the tray relabelled), `suspend_hotkeys` (30 s limit, ends when the window
  loses focus), `arm_calibration` (10 min, consumed by the next press of that hotkey), `reset_calibration`,
  `set_autostart`, `open_link`, `open_folder`, `hide_main_window`. Events `snapshot-changed` (only while
  the window is visible; the window asks again when shown) and `tray-hint`. 16 commands agree across
  build.rs, lib.rs, Rust and both ACL files (guard).
- T3.3 `app/main_window.rs`: X / Alt+F4 → tray; the first time the window shows the dialog instead
  (`tray_hint_shown`); shown without tao's focus helper and retries busy hotkeys; created hidden and shown
  at the end of start-up unless started with `--autostart` (then only when the wizard is not done or a
  hotkey is busy — part of T4.3).
- T3.4 wizard (`screens/Wizard.svelte` + `screens/wizard/*`): 4 steps with the step kept in the config,
  risk tick required, language switch on step 1, step 4 statuses from the overlay (`waiting →
  calibrating → ready`, 10× warning, a busy hotkey can be re-recorded right there), Enter = Next,
  Alt+← = Back, focus on the step heading.
- T3.5 Home: monitor choice, a card per zoom (ready / not set / armed, scale kept for another
  resolution, hotkey busy with "choose another" and "retry"), reset with a confirmation (focus on
  Cancel), last measurement as in the HUD (`segmentsLine` moved to `lib/view/result.ts`),
  troubleshooting `<details>`, config notices.
- T3.6 `HotkeyRow.svelte` + `recorder.ts`: the recorder's rules mirror `check_recordable` (Alt/Ctrl +
  letter/digit/arrow, F1–F24 alone, no Win, no Alt+F4, no F12, not the other preset); arrows added to
  `spec.rs`.
- T3.7 Settings: hotkeys + defaults, language, speeds with ranges 3–10 m/s and 20–200 km/h (config ranges,
  eng §6), panel transparency 0–100 % ↔ opacity 0.94–0.50 with samples over light and dark grounds,
  monitor (cursor / pinned display), start with Windows (+ Task Manager warning), update check on/off,
  rerun the introduction.
- T3.8 About: version, MIT, KRAFTON line, links (`open_link` enum → constant URL → `explorer`),
  does / doesn't (incl. reading the cursor on a hotkey press), the shared risk text, config and log folders.
- T4.1 `platform/win/autostart.rs` (HKCU Run with `"<exe>" --autostart`, StartupApproved read only,
  repaired at start-up when the exe moved) and T4.4 `platform/win/shell.rs` (explorer only).
- i18n: main window texts in their own dictionary (`i18n/main.{ru,en}.ts`, `tm()`), checked by the same
  tests as the overlay texts. Wording: the step 2 heading is «Честно о риске» / "Honest about the risk"
  (ux had «…о безопасности», which the C-7 rule refuses), the security link is «Сообщить об уязвимости»,
  the English headline avoids "no ban".
- Tray texts and the busy-hotkey tooltip follow language and hotkey changes without a rebuild.
- T3.9 e2e: `tests/e2e/main.spec.ts` with `main-mock.ts` (a fake Rust in the page): wizard with RU → EN
  switch, keyboard, hotkey recording incl. refusals and busy, Home → recorder, recalibrate and reset,
  last measurement, tray dialog, speed refusal, Ctrl+3 and zoom.

### Verification (2026-10-25)
- Vitest 389/389 (core 96.6 % statements); svelte-check 0/0; Playwright 87/87 (29 scenarios × 3 scales).
- Rust: fmt, clippy `-D warnings`, 92/92 tests; cargo deny ok; guard passed (16 commands).
- Release exe: guard:exe passed (same 11 baseline imports, 342 by name, 0 by ordinal, no test transport in
  dist). Smoke run: config with the existing scale loaded, hotkeys registered, raw input 0.
- Visual pass on screenshots of every screen (Edge, 960×640): fixed the step heading focus box, the footer
  pushed off screen, stretched hotkey columns and language segments, and the heavy last-measurement line.

### Code review — no CRITICAL, fixed (2026-10-26)
- HIGH the hidden main web view was never put to sleep (a tray-only start kept it at full memory):
  `create_main` idles it; `show` wakes it.
- HIGH re-recording a busy combination said "free — saved": `Bindings::set` probes a busy one again
  while paused, and the row shows "saved" only without an error.
- MEDIUM the recorder stayed in "recording" after the 30 s auto-resume: it returns to idle when the
  snapshot says the hotkeys are back.
- MEDIUM `publish_soon` ran inline on the main thread (tauri runs `run_on_main_thread` at once there):
  now posted from the timer thread after 50 ms and coalesced.
- MEDIUM "Defaults" did nothing for a swapped pair: new command `reset_hotkeys` sets both at once
  (`Bindings::set_both`, all or nothing); a refusal is shown.
- MEDIUM autostart repair took the entry from any other copy: see the security review.
- MEDIUM 200 % zoom scrolled sideways: below 640 CSS px the sidebar becomes a top bar, grids shrink;
  Playwright checks every wizard step and screen at 480 × 320.
- MEDIUM the recorder used the US key position: letters follow the layout (`e.key`), as RegisterHotKey's
  virtual keys do (QWERTZ Z, AZERTY A); non-Latin layouts keep the US position.
- LOW: pause flag and safety timer set before asking the hotkey thread, timers cancelled when replaced
  (pause, arming); tray tooltip refreshed after resume/retry ("Alt+Q и Alt+W готовы", every busy one
  named); a hotkey that could not be saved is put back; snapshots carry a `revision` and the window
  ignores older ones and validates command answers; Rust refusals shown under number fields; the
  re-run wizard ends on Home; config notices shown in the wizard; a disabled placeholder for an unplugged
  pinned monitor; a second close hides even if the page never answered or the config is read-only;
  `set_zoom` failure only logged; `args_os`; wizard keys ignored under a dialog; Ctrl+Alt+letter refused
  as AltGr (Rust and UI); listener failure no longer leaves "Проверяем…"; focus back to the card after
  fixing a busy hotkey in step 4; Next/Done use `aria-disabled` (reachable with the hint); h2 under h1;
  spoken label for the last measurement; «закреплён» on Home; unused keys removed; the risk checkbox
  follows Rust after a refused save.
- Not changed: ranges are still duplicated in the UI (noted for Phase 5); a config write per slider
  keyboard step is acceptable.

### Security review — no CRITICAL/HIGH, fixed (2026-10-26)
- MEDIUM `explorer` was resolved through the search path (exe folder first, CWE-427): started as
  `GetSystemWindowsDirectoryW()\explorer.exe`; folders only through `OwnFolder` (config, logs).
- MEDIUM autostart took any "Mapper" Run value as its own: the value is now named `dev.mapper.app`, only
  `"<…\mapper.exe>" --autostart` counts, repair only when that exe no longer exists, case-insensitive
  path compare, the command line built from the raw path (no lossy text), refused above 260 characters
  (`path_too_long` with a message).
- MEDIUM the F-key note claimed F-keys are invisible to the game (C-7): now «Windows перехватывает до окна
  игры: в игре они ничего не нажимают»; the wording rule catches "invisible to / don't reach the game".
- MEDIUM the `OWNER/mapper` placeholder could ship: `npm run guard -- --release` fails on it (Phase 5
  release workflow).
- LOW: `suspend_hotkeys` only for the focused main window and a running pause is not extended; risk
  acknowledgement enforced in Rust (`firstRunDone` needs `riskAccepted`); does / doesn't now say Mapper
  listens to its two hotkeys outside its own windows and hands the focus back on Esc; the start-up text
  says the window opens when something needs the player. F12 is already refused by `parse`.
- Guard: process start only `Command::new(explorer()?)`, exactly twice in shell.rs, no extra
  arguments/environment there; `Command as` / `process::{` / `restart(` banned; every registry API and
  `HKEY_*` only in autostart.rs, machine-wide keys nowhere; raw IPC (`chrome.webview`, `ipc.postMessage`)
  banned in web code; wording rule for "invisible to the game"; release placeholder check.

### Verification after the reviews (2026-10-26)
- Vitest 394/394 (core 96.6 %); svelte-check 0/0; Playwright 96/96 (32 scenarios × 3 scales, incl. the
  narrow window).
- Rust: fmt, clippy `-D warnings`, 98/98 tests; cargo deny ok; guard passed (`--release` fails only on
  OWNER, as intended).
- Release exe 3.4 MB: guard:exe passed (same 11 baseline imports, 343 by name, 0 by ordinal). Smoke run
  clean. Copied to `test-build/`.

### User validation
- 2026-10-26: **PASS** — the author checked the main window: wizard, Home, Settings (hotkey recording,
  transparency, language), About, close to tray and start with Windows work. Commit approved.

## Phase 4: Системная интеграция и полный guard — PASS (2026-11-01)

Implemented directly (2026-10-27/28). T4.1 autostart, T4.3 tray-only start and
T4.4 shell were done in Phase 3; T4.6 command sets and ACL since Phase 1. This phase adds the NSIS
uninstall hook, the network update check, and the rest of the guard.

### Deliverables
- T4.1 `src-tauri/nsis/hooks.nsh`: `NSIS_HOOK_PREUNINSTALL` removes the HKCU Run value `dev.mapper.app`
  (nothing else); `tauri.conf.json` `bundle.windows.nsis.installerHooks`. The guard allowlists the hook's
  exact lines (the two macro lines and that `DeleteRegValue`; `;` comments), so no NSIS command slips in.
- T4.2 `src-tauri/src/update/` (`version.rs` tags `vX.Y.Z`, `github.rs` the request, `mod.rs` state and
  schedule): `ureq` =3.5.0 with only `rustls` (rustls with ring and the webpki-roots certificates; no
  gzip, no native TLS; a proxy from `HTTPS_PROXY` / `ALL_PROXY` is honoured, TLS still ends at
  api.github.com). GET `api.github.com/repos/REPO/releases/latest`, `If-None-Match` with the stored ETag
  (visible ASCII, ≤ 256 chars), 10 s overall timeout, HTTPS only, body ≤ 1 MiB, drafts and
  pre-releases ignored, only the tag is used. Automatic: 30 s after start, then an hourly tick that checks
  only when 24 h have passed, the setting is on and the repository is set. Manual «Проверить сейчас»
  (`check_update_now`, the 18th command) at most once a minute (`rate_limited` → «слишком часто»).
  States `noRepository / off / idle / checking / upToDate / available / offline / rateLimited /
  badResponse` with honest texts; last check, latest tag, ETag and the dismissed version kept in the
  config (validated on load). Tray item «Доступна версия X…» (inserted / removed), a Home banner
  («Что нового и скачать» / «Позже», remembered per version) and a line in About; every link opens the
  fixed Releases page through `shell::open_link`, nothing from the response reaches a URL or explorer.
  While `REPO` is the `OWNER/mapper` placeholder nothing is requested and Settings says «Адрес
  репозитория ещё не задан: эта сборка никуда не обращается».
- deny.toml: ISC (ring, untrusted, rustls-webpki) and CDLA-Permissive-2.0 (webpki-roots) added to the
  licence list; `ureq` added to `antiban/crates-allowlist.json`; network code only in `update/`.
- T4.5 guard (`scripts/guard/`):
  - `lexer.mjs`: Rust comments (line, nested block) become spaces; strings, raw strings, byte/C strings
    and char literals stay (lifetimes and labels are not chars); line numbers kept; an unterminated
    string or comment is an error, the file is then scanned as raw text and the guard fails. Rust files
    are scanned through it, so a comment anywhere hides nothing and costs no false alarm.
  - Required statements: Rust counted through the lexer; other files as a range — at least the matches
    left after a loose comment strip (strings included, so only real code counts), at most those with
    comments kept — so a statement inside `/* */`, `<!-- -->` or a TOML `#` does not count, and
    "exactly N" cannot be dodged.
  - `dist.mjs`: the built pages `dist/**` against the web rule groups (network, dynamic code and raw
    HTML, web storage, device and screen, raw IPC, plugin commands other than event listen/unlisten, the
    test transport), over bundled npm code too. Two exact Svelte snippets are masked with a reason
    (`DIST_ALLOW`); Vite's modulePreload polyfill is off (it brought `fetch` into the bundle; WebView2
    preloads natively). `--dist` flag; `--exe` includes it.
  - Registry: in `autostart.rs` only `HKEY_CURRENT_USER`, no other hive and no `HKEY(…)` made from a
    number (the object-import list would not see that).
  - **Deviation from the plan:** no TS scanner and no `.svelte` compilation for the source rules. A web
    lexer has to guess where regex literals start, and a wrong guess hides code; web files keep the raw
    scan with only whole-line `//` comments skipped (never code in JS/TS), which can only err towards a
    false alarm, and the compiled `.svelte` output is checked in `dist/` instead.
- T4.7 `guard:obj` (`obj.mjs`, `antiban/own-imports.txt`): `cargo rustc --profile guard-obj --lib --
  --emit=obj`, `dumpbin /symbols`; every `__imp_` import of Mapper's own object file must be listed with
  a reason — 56: 31 called by Mapper's code (file named), 25 from generic dependency code compiled into
  the crate (tao, wry, muda, tray-icon, webview2-com, std). Banned names fail even when listed, stale
  entries fail, and a canary (RegisterHotKey, SetForegroundWindow, GetRegisteredRawInputDevices) makes a
  parse that finds nothing fail instead of pass. VS_VERSIONINFO and PE sections were checked since
  Phase 1.
- T4.8 self-test: `antiban/fixtures/violations/*.txt` — 100 planted cases in 6 files (input, game,
  build, lexer tricks, web, wording; 13 of them must stay silent). Each case names its path and the exact
  set of groups; `scripts/guard/fixtures.test.mjs` writes it into an empty tree, runs the source,
  required-statement, wording and installer checks and compares. Every rule group must have a planted
  case. Each lexer feature was mutation-checked: switching off chars, char escapes, string escapes, raw
  strings or nesting fails a case. `lexer.test.mjs` covers the lexer itself.
- Scripts and CI: `npm run guard:test` (`node --test "scripts/guard/*.test.mjs"`; a directory argument
  no longer works in Node 24), `guard:obj`, `guard:all` (guard, its tests, object, exe). `checks.yml`
  runs the guard tests after the guard, `--dist` after the web build and the object check before the
  exe build, all through `node`.

### Code review — NEEDS REVISION → fixed (2026-10-31)
- HIGH an upgrade through the installer turned "start with Windows" off: Tauri's NSIS runs the old
  uninstaller without `/UPDATE`, and its hook removes the Run value. Start-up now puts it back when
  the setting is on in Mapper (not with a read-only config); `autostart::plan` is tested.
- HIGH a config that cannot be saved repeated the "daily" check every hour and lost the answer: the
  result is kept in memory for the run (`Updates.unsaved`) and counts like a saved one.
- MEDIUM tray item and Home banner disagreed: both follow `latest` (a newer version found, also while
  a later check fails); the tray is refreshed at start, so a tray-only start shows it too.
- MEDIUM a failed check read as "you have the latest version" after a restart: the failure kind is
  saved (`updates.failed`; an unknown value reads as none instead of setting the config aside).
- MEDIUM tests: `due`, the state order, `classify`, `autostart::plan` and the lenient failure field
  are tested; unit tests for `dist.mjs` / `obj.mjs` and the guard's network pin are still open.
- LOW: "Later" sends the version it showed, so a version found meanwhile stays offered; connection
  and TLS failures read as offline, 404 (no release yet) as nothing to offer; one ETag check
  (`github::usable_etag`) for the config and the request; the banner is announced once
  (`aria-labelledby` + `role="status"`); "Check now" counts only a request that starts; turning
  checks on runs a due check at once; tray imports and text tidied.
- Not changed: an offline start right after logon waits a day, as ux.md says.
- Own review before: a last check "in the future" (clock set back) no longer stops the checks
  (`due`); the banner stays while a later check fails.

### Security review — no C-1..C-9 violation, no CRITICAL (2026-10-31)
- MEDIUM the network code was not in the audited exe while `REPO` is the placeholder (the compiler
  dropped it): `repository_set` goes through `std::hint::black_box`, so every build carries it and
  the object and exe checks cover ureq and rustls now.
- MEDIUM hourly checks when the config cannot be saved: fixed with the code review's HIGH.
- LOW: `last_check_unix` above 9999-12-31 resets to 0 (Rust) and the snapshot validator caps it too
  (a huge value blanked the window); no redirect is followed (`max_redirects(0)`, a 3xx is a bad
  answer) and no proxy is taken from the environment (`proxy(None)`); the Settings hint now names
  what GitHub sees (IP address, Mapper version, time of the check); body limit 1 MiB.
- Not changed: computed property names in web code are not caught by the regex rules; the CSP
  (`script-src 'self'`, `connect-src ipc:`) stays the barrier there.
- **Open — guard limits (HIGH in the review, no violation in Mapper's code):** the source and
  required-statement rules are a regex tripwire, and code written to dodge them on purpose can
  still pass; the object check reads only `__imp_` imports; the `guard-obj` profile and build-time
  `cfg` are not pinned. The barriers stay code review, the exe import audit (forbidden names and
  the baseline), the per-window ACL and the CSP. To close before 1.0, together with a full list of
  the exe's imports.

### Verification after the reviews (2026-11-01)
- Vitest 411/411; svelte-check 0/0; Playwright 102/102 (34 scenarios × 3 scales).
- Rust: fmt, clippy `-D warnings`, 108/108 tests; cargo deny ok.
- Guard passed (18 commands); its own tests 107/107 (100 planted cases); object: 56 Win32 imports,
  all listed; dist: 8 files, 2 masked library snippets.
- Release exe 4.5 MB (the network code is in it now): guard:exe passed — the same 11 baseline
  imports, 349 by name, 12 by ordinal (all `WS2_32.dll`: Winsock through `std::net`; none from the
  DLLs where ordinals are banned), standard sections. The built pages load every module without
  Vite's preload polyfill (checked in a browser). Smoke run with `--autostart`: tray only, raw input
  0, both hotkeys registered, no request while `REPO` is the placeholder (40 s, past the first-check
  time). Copied to `test-build/`.
- Installer (`npx tauri build`): `Mapper_0.1.0_x64-setup.exe`, 3.4 MiB. NSIS 3.13 and
  nsis_tauri_utils 0.5.3 from tauri-apps with the hashes the CLI pins, the WebView2 bootstrapper
  embedded; current-user install without administrator rights into `%LOCALAPPDATA%\Mapper` (the
  folder can be changed), the uninstall hook included. The exe Tauri patches with the bundle type
  passes guard:exe again (same imports and sections). Copied to `test-build/`.

### User validation
- 2026-11-01: **PASS** — the author installed Mapper with the installer, ran it, turned on start with
  Windows and removed it through Settings → Apps: everything works. Commit approved.
