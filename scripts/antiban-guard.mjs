#!/usr/bin/env node
// Anti-ban guard: fails (exit code 1) when the code base or the release binary reaches for
// anything that reads the game or the screen, enumerates processes or windows, or injects
// input. Rules and their reasons: rpi/mapper-overlay/plan/eng.md §7, data in scripts/guard/rules.mjs.
//
//   node scripts/antiban-guard.mjs               sources, config, ACL, dependencies
//   node scripts/antiban-guard.mjs --exe auto    + the release mapper.exe (or --exe <path>)
//   node scripts/antiban-guard.mjs --dist        + the built web pages in dist/ (exe mode includes it)
//   node scripts/antiban-guard.mjs --obj auto    + Mapper's own object file (npm run guard:obj builds it)
//   node scripts/antiban-guard.mjs --release     + placeholders that must not ship (OWNER/mapper)

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { checkCargoLock, checkCargoManifest, checkCrateAllowlist, checkNativeFiles } from "./guard/cargo.mjs";
import { createContext } from "./guard/context.mjs";
import { checkAuditedVersions, checkCrates, checkNpm, lockVersions } from "./guard/deps.mjs";
import { checkDist } from "./guard/dist.mjs";
import { checkBaselineDocs, checkExe, readBaseline } from "./guard/exe.mjs";
import { checkObject } from "./guard/obj.mjs";
import { checkRelease, checkRequired, checkSources, checkWords } from "./guard/sources.mjs";
import { checkCapabilities, checkCommandSets, checkTauriConfig } from "./guard/tauri.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function main() {
  const args = process.argv.slice(2);
  const exeIndex = args.indexOf("--exe");
  const objIndex = args.indexOf("--obj");
  const exeOnly = args.indexOf("--exe-only");
  const ctx = createContext(ROOT);
  if (exeOnly >= 0) {
    // The release job checks the downloaded exe only: no sources, no cargo, no dist/.
    checkExe(ctx, args[exeOnly + 1] ?? "", readBaseline(ctx), { dist: false });
    report(ctx);
    return;
  }
  const versions = lockVersions(ctx);
  const baseline = readBaseline(ctx);

  checkSources(ctx);
  checkRequired(ctx);
  checkWords(ctx);
  checkTauriConfig(ctx);
  checkCapabilities(ctx);
  checkCommandSets(ctx);
  checkCargoManifest(ctx);
  checkCargoLock(ctx);
  checkCrateAllowlist(ctx);
  checkNativeFiles(ctx);
  checkCrates(ctx, versions);
  checkAuditedVersions(ctx, baseline, versions);
  checkBaselineDocs(ctx, baseline);
  checkNpm(ctx);
  if (exeIndex >= 0) checkExe(ctx, args[exeIndex + 1] ?? "auto", baseline);
  if (args.includes("--dist") && exeIndex < 0) checkDist(ctx);
  if (objIndex >= 0) checkObject(ctx, args[objIndex + 1] ?? "auto");
  if (args.includes("--release")) checkRelease(ctx);
  report(ctx);
}

function report(ctx) {
  for (const note of ctx.notes) console.log(`  ok  ${note}`);
  if (ctx.problems.length > 0) {
    console.error(`\nanti-ban guard FAILED (${ctx.problems.length}):`);
    for (const problem of ctx.problems) console.error(`  x  ${problem}`);
    process.exit(1);
  }
  console.log("\nanti-ban guard passed");
}

main();
