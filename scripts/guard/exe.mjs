// The release binary: imports by name and ordinal, embedded manifest, version resource and
// PE sections. Needs dumpbin from the MSVC build tools.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";

import { EXE_NAME, FORBIDDEN_IMPORTS, NO_ORDINAL_DLLS, PE_SECTIONS } from "./rules.mjs";

const BASELINE = "antiban/imports-baseline.txt";

// Baseline file: `Name # reason` lines plus one `# audited: crate=version ...` header.
export function readBaseline(ctx) {
  const result = { entries: new Map(), audited: new Map() };
  for (const raw of (ctx.read(BASELINE) ?? "").split(/\r?\n/)) {
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

/**
 * `auto` takes the newest release exe among CARGO_TARGET_DIR, src-tauri/target and the local
 * default, so a stale build elsewhere is never audited instead of the fresh one.
 */
export function resolveExe(ctx, arg) {
  if (arg !== "auto") return { exe: resolve(arg), tried: [] };
  const targets = [
    process.env.CARGO_TARGET_DIR,
    ctx.path("src-tauri/target"),
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "mapper-target"),
  ].filter(Boolean);
  const tried = [...new Set(targets.map((target) => resolve(target, "release", EXE_NAME)))];
  const newest = tried
    .filter(existsSync)
    .map((exe) => ({ exe, mtime: statSync(exe).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)[0];
  return { exe: newest?.exe ?? null, tried };
}

function findDumpbin() {
  const vswhere = join(
    process.env["ProgramFiles(x86)"] ?? "C:/Program Files (x86)",
    "Microsoft Visual Studio/Installer/vswhere.exe",
  );
  if (!existsSync(vswhere)) return null;
  const out = execFileSync(
    vswhere,
    ["-latest", "-products", "*", "-find", "VC/Tools/MSVC/**/bin/Hostx64/x64/dumpbin.exe"],
    { encoding: "utf8" },
  );
  return out.split(/\r?\n/).find((line) => line.trim().endsWith("dumpbin.exe"))?.trim() ?? null;
}

const dumpbin = (tool, flag, exe) =>
  execFileSync(tool, ["/nologo", flag, exe], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

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

function checkImports(ctx, exe, output, baseline) {
  const { named, ordinals } = parseImports(output);
  for (const entry of ordinals) {
    if (NO_ORDINAL_DLLS.has(entry.split("#")[0])) {
      ctx.fail(`import  ${entry} is imported by ordinal; system APIs must be imported by name`);
    }
  }
  for (const name of [...named].filter((n) => FORBIDDEN_IMPORTS.has(n)).sort()) {
    if (baseline.entries.has(name)) ctx.ok(`imports: ${name} allowed by baseline (${baseline.entries.get(name) || "no reason"})`);
    else ctx.fail(`import  ${name} is imported by ${basename(exe)} and not in ${BASELINE}`);
  }
  for (const name of baseline.entries.keys()) {
    if (!named.has(name)) ctx.fail(`baseline: ${name} is no longer imported; remove the entry`);
  }
  ctx.ok(`imports: ${named.size} functions by name, ${ordinals.length} by ordinal`);
}

function checkManifest(ctx, bytes) {
  const text = bytes.toString("latin1");
  if (!/level=["']asInvoker["']/.test(text) || !/uiAccess=["']false["']/.test(text)) {
    ctx.fail('manifest: the exe does not embed asInvoker / uiAccess="false"');
  } else if (/requireAdministrator|highestAvailable|uiAccess=["']true["']/.test(text)) {
    ctx.fail("manifest: the exe requests elevation or UI access");
  } else {
    ctx.ok("manifest: asInvoker, uiAccess=false");
  }
}

// VS_VERSIONINFO strings are UTF-16: "ProductName", padding, then the value.
function checkVersionInfo(ctx, bytes) {
  const key = bytes.indexOf(Buffer.from("ProductName\0", "utf16le"));
  const value = key < 0 ? "" : bytes.subarray(key, key + 80).toString("utf16le");
  if (/^ProductName\0+Mapper\0/.test(value)) ctx.ok("version info: ProductName Mapper");
  else ctx.fail("version info: the exe has no VS_VERSIONINFO with ProductName Mapper");
}

// C-9: no packer sections such as UPX0 or .themida.
function checkSections(ctx, output) {
  const sections = [...output.matchAll(/^SECTION HEADER #\d+\r?\n\s+(\S+) name/gm)].map((m) => m[1]);
  const unknown = sections.filter((name) => !PE_SECTIONS.has(name));
  if (sections.length === 0) ctx.fail("sections: dumpbin /headers listed no sections");
  else if (unknown.length > 0) ctx.fail(`sections: non-standard PE sections ${unknown.join(", ")}`);
  else ctx.ok(`sections: ${sections.join(" ")}`);
}

export function checkExe(ctx, arg, baseline) {
  const { exe, tried } = resolveExe(ctx, arg);
  if (!exe || !existsSync(exe)) {
    ctx.fail(`exe: ${exe ?? tried.join(" | ")} not found (build the release exe first)`);
    return;
  }
  const bytes = readFileSync(exe);
  checkManifest(ctx, bytes);
  checkVersionInfo(ctx, bytes);
  const tool = findDumpbin();
  if (!tool) {
    ctx.fail("exe: dumpbin.exe not found (install the MSVC build tools)");
    return;
  }
  checkImports(ctx, exe, dumpbin(tool, "/imports", exe), baseline);
  checkSections(ctx, dumpbin(tool, "/headers", exe));
  ctx.ok(`exe: ${exe}`);
}
