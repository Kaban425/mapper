// Tauri configuration and per-window ACL: what each web view may call is fixed in
// antiban/acl.json, and the command lists in Rust and in the capabilities must agree.

import { readdirSync } from "node:fs";

import { readJson, stripLineComments, walk } from "./context.mjs";
import { CSP_CONNECT } from "./rules.mjs";

const CONF = "src-tauri/tauri.conf.json";
const CAPABILITIES = "src-tauri/capabilities";
const PERMISSIONS = "src-tauri/permissions";
const ACL = "antiban/acl.json";
const NSIS_HOOKS = "nsis/hooks.nsh";

// Core permissions any window may ever get. This lives in code, not in acl.json: widening
// it must be a reviewed change to the guard itself (security review, Phase 1).
const CORE_PERMISSIONS = ["core:event:allow-listen", "core:event:allow-unlisten"];

// Every key the config may use. Anything else — a sidecar (bundle.externalBin), extra files
// (resources), a custom NSIS template, a build runner, inline capabilities, the asset
// protocol — fails, because it would ship or run something the guard never inspects.
const CONFIG_KEYS = {
  "": ["$schema", "productName", "version", "identifier", "build", "app", "bundle"],
  build: ["frontendDist", "devUrl", "beforeDevCommand", "beforeBuildCommand"],
  app: ["withGlobalTauri", "windows", "security"],
  "app.security": ["csp", "devCsp", "freezePrototype", "headers"],
  bundle: [
    "active", "targets", "icon", "publisher", "copyright", "shortDescription", "longDescription",
    "homepage", "license", "licenseFile", "category", "windows",
  ],
  "bundle.windows": ["webviewInstallMode", "nsis"],
  "bundle.windows.nsis": [
    "installMode", "languages", "displayLanguageSelector", "installerIcon", "headerImage", "sidebarImage",
    "installerHooks", "compression", "startMenuFolder",
  ],
};
const BUILD_VALUES = {
  frontendDist: "../dist",
  devUrl: "http://localhost:5173",
  beforeDevCommand: "npm run dev",
  beforeBuildCommand: "npm run build",
};

const at = (conf, path) => (path ? path.split(".").reduce((node, key) => node?.[key], conf) : conf);

export function checkTauriConfig(ctx) {
  const conf = readJson(ctx, CONF);
  if (!conf) return;
  const expect = (holds, message) => holds || ctx.fail(`config  ${CONF}: ${message}`);
  for (const [path, keys] of Object.entries(CONFIG_KEYS)) {
    for (const key of Object.keys(at(conf, path) ?? {})) {
      expect(keys.includes(key), `${path ? `${path}.` : ""}${key} is not an allowed setting`);
    }
  }
  for (const [key, value] of Object.entries(BUILD_VALUES)) {
    expect(conf.build?.[key] === value, `build.${key} must be "${value}"`);
  }
  const app = conf.app ?? {};
  expect(app.withGlobalTauri === false, "app.withGlobalTauri must be false");
  expect(Array.isArray(app.windows) && app.windows.length === 0, "app.windows must be [] (windows are built in Rust)");
  expect(app.security?.freezePrototype === true, "app.security.freezePrototype must be true");
  expect(JSON.stringify(conf.bundle?.targets) === '["nsis"]', 'bundle.targets must be ["nsis"]');
  expect(conf.bundle?.windows?.nsis?.installMode === "currentUser", "the installer must be per-user (no UAC)");
  for (const key of ["csp", "devCsp"]) checkCsp(ctx, key, app.security?.[key]);
  checkInstallerHooks(ctx, conf.bundle?.windows?.nsis?.installerHooks);
  checkExtraConfigs(ctx);
  ctx.ok(`config: ${CONF} keys, build commands and both CSPs checked, no platform overrides`);
}

// The uninstaller hook may only remove what Mapper wrote (its HKCU Run value).
function checkInstallerHooks(ctx, hooks) {
  if (hooks === undefined) return;
  if (hooks !== NSIS_HOOKS) {
    ctx.fail(`config  ${CONF}: installerHooks must be "${NSIS_HOOKS}"`);
    return;
  }
  (ctx.read(`src-tauri/${NSIS_HOOKS}`) ?? "").split(/\r?\n/).forEach((line, index) => {
    if (/\b(Exec\w*|nsExec|WriteReg\w*|CreateShortcut|File|ExecShell\w*)\b|!(system|execute)\b/i.test(line)) {
      ctx.fail(`config  src-tauri/${NSIS_HOOKS}:${index + 1}  ${line.trim()}`);
    }
  });
}

const parseCsp = (value) =>
  new Map(
    value
      .split(";")
      .map((directive) => directive.trim().split(/\s+/))
      .filter(([name]) => name)
      .map(([name, ...sources]) => [name, sources]),
  );

const CSP_EXACT = {
  "default-src": "'self'",
  "script-src": "'self'",
  "object-src": "'none'",
  "base-uri": "'none'",
  "form-action": "'none'",
};
// Every directive may name only the app itself; these few get one extra each. Anything
// else (a remote image host, a frame source) could carry data off the machine.
const CSP_EXTRA = { "style-src": ["'unsafe-inline'"], "img-src": ["data:"], "font-src": ["data:"] };

function checkCsp(ctx, key, value) {
  const where = `config  ${CONF}: app.security.${key}`;
  if (typeof value !== "string") {
    ctx.fail(`${where} must be a string`);
    return;
  }
  const csp = parseCsp(value);
  for (const [name, wanted] of Object.entries(CSP_EXACT)) {
    const got = (csp.get(name) ?? []).join(" ");
    if (got !== wanted) ctx.fail(`${where} ${name} is "${got}", expected "${wanted}"`);
  }
  for (const [name, sources] of csp) {
    const allowed = ["'self'", "'none'", ...(name === "connect-src" ? CSP_CONNECT[key] : (CSP_EXTRA[name] ?? []))];
    for (const source of sources) {
      if (!allowed.includes(source)) ctx.fail(`${where} ${name} allows ${source}`);
    }
  }
}

// tauri-utils merges tauri.windows.conf.json[5] / Tauri.windows.toml into the config on
// Windows, so any second config file could undo every check above.
function checkExtraConfigs(ctx) {
  const extra = readdirSync(ctx.path("src-tauri")).filter(
    (name) => name !== "tauri.conf.json" && (/^tauri\..*conf\.json5?$/i.test(name) || /^tauri(\..+)?\.toml$/i.test(name)),
  );
  for (const name of extra) ctx.fail(`config  src-tauri/${name}: only tauri.conf.json is allowed`);
}

function capabilityFiles(ctx) {
  return walk(ctx.path(CAPABILITIES)).map(ctx.rel);
}

/** Command names from `const COMMANDS` in build.rs, or null if it cannot be found. */
function listedCommands(ctx) {
  const build = stripLineComments(ctx.read("src-tauri/build.rs") ?? "");
  const listed = build.match(/const COMMANDS:\s*&\[&str\]\s*=\s*&\[([^\]]*)\]/)?.[1];
  return listed === undefined ? null : [...listed.matchAll(/"(\w+)"/g)].map((m) => m[1]);
}

const dashed = (command) => command.replaceAll("_", "-");

export function checkCapabilities(ctx) {
  const acl = readJson(ctx, ACL);
  if (!acl) return;
  const allowed = acl.windows ?? {};
  const commands = listedCommands(ctx) ?? [];
  const permitted = new Set([...CORE_PERMISSIONS, ...commands.map((c) => `allow-${dashed(c)}`)]);
  for (const [window, entries] of Object.entries(allowed)) {
    for (const entry of entries) {
      if (!permitted.has(entry)) ctx.fail(`acl     ${ACL} gives "${window}" ${entry}; only core event listening and app commands`);
    }
  }
  checkGeneratedPermissions(ctx, commands);
  const files = capabilityFiles(ctx);
  for (const path of files) {
    const where = `acl     ${path}`;
    if (!path.endsWith(".json")) {
      ctx.fail(`${where}: only plain .json capability files are allowed`);
      continue;
    }
    const capability = readJson(ctx, path);
    if (!capability) continue;
    if (capability.remote) ctx.fail(`${where} grants remote URLs`);
    if (capability.webviews) ctx.fail(`${where} targets web views; target exactly one window instead`);
    const windows = capability.windows ?? [];
    if (windows.length !== 1) {
      ctx.fail(`${where} must target exactly one window (has ${windows.length})`);
      continue;
    }
    const [window] = windows;
    if (!Object.hasOwn(allowed, window)) {
      ctx.fail(`${where} targets "${window}", which ${ACL} does not list`);
      continue;
    }
    for (const entry of capability.permissions ?? []) {
      if (typeof entry !== "string") ctx.fail(`${where} uses a scoped permission object; plain identifiers only`);
      else if (!allowed[window].includes(entry)) ctx.fail(`${where} grants ${entry} to "${window}" (not in ${ACL})`);
    }
  }
  // Hand-written permission files can bundle core permissions under an innocent name.
  const custom = walk(ctx.path(PERMISSIONS))
    .map(ctx.rel)
    .filter((path) => !path.startsWith(`${PERMISSIONS}/autogenerated/`));
  for (const path of custom) ctx.fail(`acl     ${path}: hand-written permission files are not allowed`);
  ctx.ok(`capabilities: ${files.length} file(s) checked against ${ACL} and the guard's own permission list`);
}

// tauri-build loads every file in permissions/autogenerated/. The folder is gitignored, but a
// force-added file with a [[set]] could reference any other permission, so only the exact
// files tauri-build writes for COMMANDS are accepted.
function checkGeneratedPermissions(ctx, commands) {
  const dir = `${PERMISSIONS}/autogenerated`;
  for (const path of walk(ctx.path(dir)).map(ctx.rel)) {
    const command = path.slice(dir.length + 1).replace(/\.toml$/, "");
    const text = ctx.read(path);
    if (!path.endsWith(".toml") || !commands.includes(command)) {
      ctx.fail(`acl     ${path}: not a generated permission file of a command in COMMANDS`);
      continue;
    }
    const identifiers = [...text.matchAll(/^identifier\s*=\s*"([^"]*)"/gm)].map((m) => m[1]);
    const lists = [...text.matchAll(/^commands\.(allow|deny)\s*=\s*\[([^\]]*)\]/gm)].map((m) => m[2].trim());
    const expected = [`allow-${dashed(command)}`, `deny-${dashed(command)}`];
    if (
      /^\s*\[\[?\s*set\b/m.test(text) ||
      /^\s*permissions\s*=/m.test(text) ||
      identifiers.join() !== expected.join() ||
      lists.some((list) => list !== `"${command}"`)
    ) {
      ctx.fail(`acl     ${path}: differs from what tauri-build generates for ${command}`);
    }
  }
}

const sorted = (names) => [...new Set(names)].sort();

// Broken files are already reported by checkCapabilities.
function permissionsOf(ctx, path) {
  try {
    return JSON.parse(ctx.read(path)).permissions ?? [];
  } catch {
    return [];
  }
}

function grantedCommands(ctx) {
  return capabilityFiles(ctx)
    .filter((path) => path.endsWith(".json"))
    .flatMap((path) => permissionsOf(ctx, path))
    .filter((entry) => typeof entry === "string" && entry.startsWith("allow-"))
    .map((entry) => entry.slice("allow-".length).replaceAll("-", "_"));
}

function definedCommands(ctx) {
  const pattern = /#\[tauri::command[^\]]*\]\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+(\w+)/g;
  return walk(ctx.path("src-tauri/src"))
    .filter((file) => file.endsWith(".rs"))
    .flatMap((file) => [...stripLineComments(ctx.read(ctx.rel(file))).matchAll(pattern)].map((m) => m[1]));
}

// COMMANDS in build.rs, generate_handler!, #[tauri::command] and the ACL list the same commands.
export function checkCommandSets(ctx) {
  const lib = stripLineComments(ctx.read("src-tauri/src/lib.rs") ?? "");
  const listed = listedCommands(ctx);
  const handled = lib.match(/generate_handler!\[([^\]]*)\]/)?.[1];
  if (listed === null || handled === undefined) {
    ctx.fail("commands: COMMANDS in build.rs or generate_handler! in lib.rs not found");
    return;
  }
  const sets = {
    "COMMANDS in build.rs": sorted(listed),
    "generate_handler! in lib.rs": sorted(handled.split(",").map((s) => s.trim().split("::").pop()).filter(Boolean)),
    "#[tauri::command] functions": sorted(definedCommands(ctx)),
    "allow-* in capabilities": sorted(grantedCommands(ctx)),
  };
  const [reference, ...others] = Object.entries(sets);
  for (const [name, names] of others) {
    if (names.join(",") !== reference[1].join(",")) {
      ctx.fail(`commands: ${name} [${names.join(", ")}] differs from ${reference[0]} [${reference[1].join(", ")}]`);
    }
  }
  ctx.ok(`commands: ${reference[1].length} command(s) agree across build.rs, lib.rs, Rust and the ACL`);
}
