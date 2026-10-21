// Cargo can compile code the source rules never read: path dependencies, [patch] and
// [replace], vendored sources from .cargo/config, extra targets, objects passed to the
// linker. These checks keep the build to Mapper's scanned sources plus crates.io crates
// that antiban/crates-allowlist.json names.

import { execFileSync } from "node:child_process";
import { extname } from "node:path";

import { readJson } from "./context.mjs";
import { findCargo } from "./deps.mjs";

const CRATES_IO = "registry+https://github.com/rust-lang/crates.io-index";
const CRATES_ALLOWLIST = "antiban/crates-allowlist.json";
const MANIFEST = "src-tauri/Cargo.toml";
const DEP_FIELDS = { normal: "dependencies", build: "build-dependencies", dev: "dev-dependencies" };
// Directories Cargo reads configuration from when run in the repository or in src-tauri.
const CARGO_CONFIG_DIRS = [".cargo", "src-tauri/.cargo", "src-tauri/src/.cargo"];
const NATIVE_EXT = new Set([".obj", ".o", ".lib", ".a", ".dll", ".exe", ".res", ".c", ".cc", ".cpp", ".asm", ".s"]);

// Raw lines on purpose: TOML comments are not stripped, so nothing can hide behind a `#`.
const MANIFEST_RULES = [
  { what: "a path outside the default layout", pattern: /\bpath\s*=/, unless: /^\s*path\s*=\s*"src\/main\.rs"\s*$/ },
  { what: "a custom build script", pattern: /^\s*(package\s*\.\s*)?build\s*=/ },
  { what: "a git or alternative-registry dependency", pattern: /\b(git|registry|registry-index)\s*=/ },
  {
    what: "a [patch], [replace] or [workspace] section",
    pattern: /^\s*\[+\s*["']?(patch|replace|workspace)\b|^\s*["']?(patch|replace|workspace)["']?\s*\./,
  },
];

export function checkCargoManifest(ctx) {
  const lines = (ctx.read(MANIFEST) ?? "").split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const rule of MANIFEST_RULES) {
      if (rule.pattern.test(line) && !rule.unless?.test(line)) {
        ctx.fail(`cargo   ${MANIFEST}:${index + 1}  ${rule.what}: ${line.trim()}`);
      }
    }
  });
  for (const dir of CARGO_CONFIG_DIRS) {
    if (ctx.exists(dir)) ctx.fail(`cargo   ${dir}/ exists; Cargo config can replace sources or pass linker flags`);
  }
  ctx.ok(`cargo: ${MANIFEST} uses the default layout, no Cargo config directories`);
}

// Every package but Mapper itself comes from crates.io with a checksum: this closes path
// dependencies, path or git patches and [replace] even when the names look familiar.
export function checkCargoLock(ctx) {
  const lock = ctx.read("src-tauri/Cargo.lock");
  if (lock === null) return; // checkCrates reports it
  const blocks = lock.split(/^\[\[package\]\]\s*$/m).slice(1);
  for (const block of blocks) {
    const name = block.match(/^name = "([^"]+)"/m)?.[1];
    const version = block.match(/^version = "([^"]+)"/m)?.[1];
    const source = block.match(/^source = "([^"]+)"/m)?.[1];
    if (name === "mapper" && source === undefined) continue;
    if (source !== CRATES_IO || !/^checksum = "[0-9a-f]{64}"$/m.test(block)) {
      ctx.fail(`crate   ${name} ${version} is not a crates.io package with a checksum (source: ${source ?? "local path"})`);
    }
  }
  ctx.ok(`Cargo.lock: ${blocks.length - 1} packages from crates.io with checksums`);
}

function cargoMetadata(ctx) {
  try {
    const out = execFileSync(findCargo(), ["metadata", "--no-deps", "--format-version", "1", "--locked"], {
      cwd: ctx.path("src-tauri"),
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return JSON.parse(out).packages.find((p) => p.name === "mapper") ?? null;
  } catch {
    return null;
  }
}

/** Direct dependencies are allow-listed with a reason, and only Mapper's own files are targets. */
export function checkCrateAllowlist(ctx) {
  const allow = readJson(ctx, CRATES_ALLOWLIST);
  if (!allow) return;
  const mapper = cargoMetadata(ctx);
  if (!mapper) {
    ctx.fail("crates: cargo metadata failed; the dependency allowlist was not checked");
    return;
  }
  for (const dep of mapper.dependencies) {
    const field = DEP_FIELDS[dep.kind ?? "normal"];
    const where = `crates: ${dep.name} (${field}${dep.target ? `, ${dep.target}` : ""})`;
    if (!Object.hasOwn(allow[field] ?? {}, dep.name)) ctx.fail(`${where} is not in ${CRATES_ALLOWLIST}`);
    if (dep.rename) ctx.fail(`${where} is renamed to ${dep.rename}; a rename hides it from the name rules`);
    if (dep.path || dep.source !== CRATES_IO) ctx.fail(`${where} does not come from crates.io`);
  }
  const root = ctx.path("src-tauri").replaceAll("\\", "/");
  for (const target of mapper.targets) {
    const file = target.src_path.replaceAll("\\", "/");
    if (file !== `${root}/build.rs` && !file.startsWith(`${root}/src/`)) {
      ctx.fail(`crates: target ${target.name} (${target.kind.join(", ")}) is built from ${file}, outside the scanned sources`);
    }
  }
  ctx.ok(`crates: ${mapper.dependencies.length} direct dependencies match ${CRATES_ALLOWLIST}`);
}

// Objects and native sources can be linked in without any Rust declaration.
export function checkNativeFiles(ctx) {
  let files;
  try {
    files = execFileSync("git", ["ls-files", "-co", "--exclude-standard"], { cwd: ctx.root, encoding: "utf8" })
      .split(/\r?\n/)
      .filter(Boolean);
  } catch {
    ctx.fail("files: git ls-files failed; native files were not checked");
    return;
  }
  const native = files.filter((file) => !file.startsWith("spikes/") && NATIVE_EXT.has(extname(file).toLowerCase()));
  for (const file of native) ctx.fail(`files   ${file}: native code or binaries must not be in the repository`);
  ctx.ok(`files: ${files.length} tracked or new files, no native code or binaries`);
}
