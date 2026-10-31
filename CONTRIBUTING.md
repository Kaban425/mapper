# Contributing

Thanks for helping. Mapper has one rule above all: **it is a ruler, not a cheat.** A change is
accepted only if Mapper still:

- touches only its own process and windows — no game memory, files, processes or window lookups;
- never reads the screen and never sends input (no `SendInput`, no tao `set_focus()` or
  fullscreen, which synthesise Alt);
- uses only the player's own clicks and public constants, and hotkeys only through
  `RegisterHotKey`;
- runs as the user (`asInvoker`, `uiAccess="false"`), unpacked, and says honestly what it does.

The anti-ban guard checks much of this automatically; review checks the rest.

## Build

You need Windows 10 or 11 with:

- Node.js 24;
- Rust through rustup (the toolchain in `rust-toolchain.toml` installs itself on first use);
- Visual Studio Build Tools with "Desktop development with C++" (MSVC, the Windows SDK and
  `dumpbin`, which the guard uses);
- Microsoft Edge (the end-to-end tests drive it) and the WebView2 runtime;
- `cargo install cargo-deny --version 0.20.2 --locked` for the dependency checks.

Keep Cargo's build folder outside OneDrive or other synced folders — syncing slows builds and
locks files. In PowerShell: `$env:CARGO_TARGET_DIR = "$env:LOCALAPPDATA\mapper-target"`.

```powershell
npm ci --ignore-scripts
npx tauri dev            # the app with hot reload
npx tauri build          # release exe and the NSIS installer
```

## Checks

CI runs all of these (`.github/workflows/checks.yml`); run them before a pull request:

```powershell
node scripts/antiban-guard.mjs          # the guard: sources, permissions, dependencies, wording
npm run guard:test                      # the guard's own tests (planted violations)
npm run check                           # svelte-check and TypeScript
npm run test:coverage                   # unit tests
npm run e2e                             # the windows against a mock, in Edge
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --locked -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --locked
cargo deny --manifest-path src-tauri/Cargo.toml --config deny.toml check
npm run guard:all                       # guard, its tests, the object file and the release exe
```

`guard:all` needs a release build first (`npx tauri build --no-bundle`).

## The guard

`scripts/antiban-guard.mjs` with the rules in `scripts/guard/rules.mjs`:

- **Source rules** ban APIs and patterns per file type and path (Rust is read through a lexer, so
  comments never count). To add one, add an entry with a `group` to `SOURCE_RULES`, then plant a
  case in `antiban/fixtures/violations/*.txt`: `=== <path> -> <group>` followed by the code. The
  guard's tests fail while a group has no planted case, and every case must report exactly the
  groups it names (`none` for code that must stay silent).
- **Required statements** (`REQUIRED`) must stay in place, e.g. the raw-input filter.
- **Mapper's own Win32 calls**: `npm run guard:obj` lists the imports of Mapper's object file. A
  new call fails until it is added to `antiban/own-imports.txt` with a reason.
- **The release exe**: a forbidden import fails unless `antiban/imports-baseline.txt` explains it.
  A dependency update that changes these imports means re-auditing the entries
  (`docs/dependency-audit.md`) and updating the table in both READMEs.
- **Dependencies**: crates and npm packages are allowlisted (`antiban/*-allowlist.json`), Cargo's
  sources and licences are checked by cargo-deny (`deny.toml`).
- **Wording** (C-7): a fixed list of claims about bans, detection and risk (`CLAIMS` in
  `scripts/guard/rules.mjs`) is refused in the READMEs, the docs and every user-facing text.

## Pull requests

One change per pull request, with the checks green. Commit subjects are short and imperative, in
English ("Fix the HUD position on a vertical monitor"). User-facing texts come in Russian and
English (`src/lib/i18n`); the tests check both have the same keys.

## Releases

Maintainers only:

1. On a branch: `npm run version:bump X.Y.Z` (moves "Unreleased" in `CHANGELOG.md` to that
   version). Going from `X.Y.Z-rc.N` to `X.Y.Z`, first write one line under Unreleased (for
   example "The tested X.Y.Z-rc.N as a release"): the bump refuses empty notes.
2. Merge it into main through a pull request, then tag that commit on main and push the tag:
   `git tag vX.Y.Z <commit>` and `git push origin vX.Y.Z`.
3. The release workflow refuses a tag that is not on main, checks the version, runs all checks,
   builds the installer and the portable exe in a job without write access, runs the guard on
   them, and hands the files to a separate job that attaches SHA-256 sums and attestations and
   leaves a draft release. Publish the draft by hand after reading it.

"Run workflow" (manual) only builds the files as a workflow artifact for testing; it never makes a
release. Attestations need a public repository.
