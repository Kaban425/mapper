// Dependencies: banned crates (the list lives in deny.toml), audited versions behind the
// imports baseline, and npm packages.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { readJson } from "./context.mjs";
import { BANNED_NPM, BUILD_SCRIPT } from "./rules.mjs";

const NPM_ALLOWLIST = "antiban/npm-allowlist.json";
const LIFECYCLE_SCRIPTS = ["preinstall", "install", "postinstall", "prepare", "prepack"];

export function lockVersions(ctx) {
  const lock = ctx.read("src-tauri/Cargo.lock");
  if (lock === null) return null;
  const versions = new Map();
  for (const m of lock.matchAll(/^name = "([^"]+)"\r?\nversion = "([^"]+)"/gm)) {
    versions.set(m[1], [...(versions.get(m[1]) ?? []), m[2]]);
  }
  return versions;
}

// One list for both tools: the crate names under [bans] deny = [...] in deny.toml.
function bannedCrates(ctx) {
  const sections = (ctx.read("deny.toml") ?? "").split(/^(?=\[)/m);
  const bans = sections.find((section) => /^\[bans\]\s*$/m.test(section.split("\n")[0])) ?? "";
  const deny = bans.match(/^deny\s*=\s*\[([\s\S]*?)^\]/m)?.[1] ?? "";
  return [...deny.matchAll(/crate\s*=\s*"([^"@]+)/g)].map((m) => m[1]);
}

export function findCargo() {
  const home = process.env.CARGO_HOME ?? join(process.env.USERPROFILE ?? "", ".cargo");
  const candidate = join(home, "bin", "cargo.exe");
  return existsSync(candidate) ? candidate : "cargo";
}

// Crates actually compiled for Windows. Cargo.lock also lists Linux/macOS-only crates
// (e.g. libloading under the Linux tray), so it is only the fallback.
function windowsCrates(ctx) {
  try {
    const out = execFileSync(
      findCargo(),
      ["tree", "--locked", "--target", "x86_64-pc-windows-msvc", "-e", "normal,build", "--prefix", "none", "--format", "{p}"],
      { cwd: ctx.path("src-tauri"), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    return new Set(
      out
        .split(/\r?\n/)
        .map((line) => line.split(" ")[0])
        .filter(Boolean),
    );
  } catch {
    return null;
  }
}

export function checkCrates(ctx, versions) {
  if (!versions) {
    ctx.fail("crates: src-tauri/Cargo.lock is missing; run cargo generate-lockfile first");
    return;
  }
  const banned = bannedCrates(ctx);
  if (banned.length === 0) {
    ctx.fail("crates: deny.toml has no [bans] deny list");
    return;
  }
  const windows = windowsCrates(ctx);
  const scope = windows ?? new Set(versions.keys());
  const where = windows ? "is compiled into the Windows build" : "is in Cargo.lock (cargo tree failed, all platforms)";
  for (const crate of banned) if (scope.has(crate)) ctx.fail(`crate   ${crate} ${where}`);
  ctx.ok(
    windows
      ? `crates: ${windows.size} compiled for Windows checked against ${banned.length} bans (${versions.size} in Cargo.lock)`
      : `crates: cargo tree failed, all ${versions.size} in Cargo.lock checked against ${banned.length} bans`,
  );
}

export function checkAuditedVersions(ctx, baseline, versions) {
  if (baseline.audited.size === 0) {
    ctx.fail("baseline: no '# audited: crate=version' line; the exceptions were never tied to versions");
    return;
  }
  // Exactly the audited version: a second, unaudited copy of tao or wry must fail too.
  for (const [crate, version] of baseline.audited) {
    const locked = versions?.get(crate) ?? [];
    if (locked.length !== 1 || locked[0] !== version) {
      ctx.fail(`baseline: audited ${crate} ${version}, Cargo.lock has ${locked.join(", ") || "none"}; re-audit the imports`);
    }
  }
  ctx.ok(`baseline: audited versions match Cargo.lock (${[...baseline.audited.keys()].join(", ")})`);
}

export function checkNpm(ctx) {
  const pkg = readJson(ctx, "package.json");
  const allow = readJson(ctx, NPM_ALLOWLIST);
  const lock = readJson(ctx, "package-lock.json");
  if (!pkg || !allow || !lock) return;
  for (const field of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
    for (const name of Object.keys(pkg[field] ?? {})) {
      if (!(allow[field] ?? []).includes(name)) ctx.fail(`npm     ${name} (${field}) is not in ${NPM_ALLOWLIST}`);
    }
  }
  if (pkg.scripts?.build !== BUILD_SCRIPT) {
    ctx.fail(`npm     package.json "build" must be exactly "${BUILD_SCRIPT}" (no mode, no extra steps)`);
  }
  const scripts = Object.keys(pkg.scripts ?? {});
  for (const script of scripts) {
    if (LIFECYCLE_SCRIPTS.includes(script)) ctx.fail(`npm     package.json defines a "${script}" lifecycle script`);
    // `npm run guard` would run a "preguard" script first, before the guard can look at it.
    const hooked = script.match(/^(pre|post)(.+)$/)?.[2];
    if (hooked && scripts.includes(hooked)) ctx.fail(`npm     package.json defines a "${script}" hook script`);
  }
  const packages = Object.entries(lock.packages ?? {}).filter(([path]) => path !== "");
  for (const [path, info] of packages) {
    const name = path.replace(/^.*node_modules\//, "");
    // An alias ("x": "npm:robotjs@...") keeps the real name in `name`.
    const names = [name, info.name].filter(Boolean);
    if (names.some((n) => BANNED_NPM.some((banned) => n.startsWith(banned)))) {
      ctx.fail(`npm     ${names.join(" = ")} is in package-lock.json`);
    }
    if (info.hasInstallScript && !allow.installScripts?.[name]) {
      ctx.fail(`npm     ${name} has an install script and is not in ${NPM_ALLOWLIST} installScripts`);
    }
  }
  ctx.ok(`npm: direct dependencies match ${NPM_ALLOWLIST}, ${packages.length} locked packages checked`);
}
