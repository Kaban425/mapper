# Dependency audit

Mapper's windows come from Tauri and its libraries. Some of them can do things Mapper must never
do (send input, read raw input, move the cursor). Mapper keeps those paths unused, and the guard
checks that. When one of these libraries changes, the reasons have to be checked again.

## What is pinned

- `antiban/imports-baseline.txt` lists the forbidden-looking functions the release exe imports
  through dependencies, each with the reason it is unreachable or harmless, and the crate versions
  they were audited for (`# audited: tao=… muda=… …`). The guard fails when `Cargo.lock` has other
  versions, when the exe imports a forbidden function that is not listed, and when a listed one is
  no longer imported.
- `antiban/own-imports.txt` lists every Win32 function Mapper's own object file imports: the ones
  Mapper calls (the file is named) and the ones generic dependency code compiled into Mapper's
  crate brings. A new one fails `npm run guard:obj` until it is listed with a reason.
- `antiban/crates-allowlist.json` and `antiban/npm-allowlist.json` name the direct dependencies;
  `deny.toml` bans crates and features, and limits licences and sources.
- Both READMEs explain every baseline entry in plain words (the guard checks that each is named).

## When a pinned crate changes

1. Update it in `src-tauri/Cargo.toml` / `Cargo.lock` and build the release exe
   (`npx tauri build --no-bundle`).
2. `npm run guard:all`. The guard names every new or vanished import and every version that no
   longer matches the audit.
3. For each forbidden-looking import, find its call sites in the new version's source
   (`%USERPROFILE%\.cargo\registry\src\…\<crate>-<version>`) and confirm one of:
   - it acts only on Mapper's own windows or its own message queue;
   - it is reachable only through an API the source guard bans (`set_focus`, fullscreen,
     predefined menu items, cursor control) or the per-window ACL refuses.
   If neither holds, don't update: open an issue, or pin the old version.
4. Update the reasons and the `# audited:` line in `antiban/imports-baseline.txt`, the table in
   both READMEs, and `antiban/own-imports.txt` if the object file changed.
5. Run all checks (`CONTRIBUTING.md`) and say in the commit what was audited.

## Every other dependency

`cargo deny … check` (advisories, bans, licences, sources) and `npm ci` against the lock file run
in CI on every pull request. A new direct dependency needs an allowlist entry, which review sees.
