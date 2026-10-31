// Mapper's own object file (plan/eng.md §7.6): `cargo rustc --profile guard-obj --lib -- --emit=obj`
// builds mapper_lib without LTO, so its import table holds only the Win32 calls of Mapper's code
// (and of generic dependency code instantiated in it). Every name must be on
// antiban/own-imports.txt; forbidden names never pass; a canary proves the right object was read.

import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { dumpbin, findDumpbin } from "./exe.mjs";
import { FORBIDDEN_IMPORTS } from "./rules.mjs";

const OWN_IMPORTS = "antiban/own-imports.txt";
const CANARY = ["RegisterHotKey", "SetForegroundWindow", "GetRegisteredRawInputDevices"];

/** `Name  # reason` lines; the reason is required. */
export function readOwnImports(ctx) {
  const entries = new Map();
  for (const raw of (ctx.read(OWN_IMPORTS) ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const match = line.match(/^(\w+)\s+#\s*(\S.*)$/);
    if (match) entries.set(match[1], match[2]);
    else ctx.fail(`${OWN_IMPORTS}: "${line}" needs a name and a reason`);
  }
  return entries;
}

/** The newest mapper_lib object in the guard-obj profile of the target directory. */
function findObject(ctx, arg) {
  if (arg !== "auto") return arg;
  const targets = [process.env.CARGO_TARGET_DIR, ctx.path("src-tauri/target")].filter(Boolean);
  const objects = targets
    .map((dir) => join(dir, "guard-obj", "deps"))
    .filter(existsSync)
    .flatMap((dir) => readdirSync(dir).filter((n) => /^mapper_lib-[0-9a-f]+\.o$/.test(n)).map((n) => join(dir, n)));
  return objects.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0] ?? null;
}

/** `UNDEF … External | __imp_<name>`: Win32 functions only (Rust statics are mangled `_R…`). */
export function parseObjectImports(output) {
  const names = [...output.matchAll(/\bUNDEF\s+notype(?:\s+\(\))?\s+External\s+\|\s+__imp_(\S+)/g)].map((m) => m[1]);
  return new Set(names.filter((name) => !/^_R|^_ZN/.test(name)));
}

export function checkObjectImports(ctx, imports, allowed) {
  for (const name of CANARY) {
    if (!imports.has(name)) ctx.fail(`object: ${name} is not imported — not Mapper's object, or a stale build`);
  }
  for (const name of imports) {
    if (FORBIDDEN_IMPORTS.has(name)) ctx.fail(`object: Mapper's code imports ${name}, which is forbidden`);
    else if (!allowed.has(name)) ctx.fail(`object: new Win32 call ${name} — add it to ${OWN_IMPORTS} with a reason`);
  }
  for (const name of allowed.keys()) {
    if (!imports.has(name)) ctx.fail(`${OWN_IMPORTS}: ${name} is no longer imported; remove the line`);
  }
  ctx.ok(`object: ${imports.size} Win32 imports, all on ${OWN_IMPORTS}, canary present`);
}

export function checkObject(ctx, arg) {
  const object = findObject(ctx, arg);
  if (!object || !existsSync(object)) {
    ctx.fail("object: mapper_lib-*.o not found (run `npm run guard:obj`, which builds it first)");
    return;
  }
  const tool = findDumpbin();
  if (!tool) {
    ctx.fail("object: dumpbin.exe not found (install the MSVC build tools)");
    return;
  }
  checkObjectImports(ctx, parseObjectImports(dumpbin(tool, "/symbols", object)), readOwnImports(ctx));
}
