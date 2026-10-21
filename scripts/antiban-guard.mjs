#!/usr/bin/env node
// Anti-ban guard: fails (exit code 1) when the code base or the release binary reaches for
// anything that reads the game or the screen, enumerates processes or windows, or injects
// input. Rules and their reasons: rpi/mapper-overlay/plan/eng.md §7, data in scripts/guard/rules.mjs.
//
//   node scripts/antiban-guard.mjs               sources, config, ACL, dependencies
//   node scripts/antiban-guard.mjs --exe auto    + the release mapper.exe (or --exe <path>)

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { checkCargoLock, checkCargoManifest, checkCrateAllowlist, checkNativeFiles } from "./guard/cargo.mjs";
import { createContext } from "./guard/context.mjs";
import { checkAuditedVersions, checkCrates, checkNpm, lockVersions } from "./guard/deps.mjs";
import { checkExe, readBaseline } from "./guard/exe.mjs";
import { checkRequired, checkSources, checkWords } from "./guard/sources.mjs";
import { checkCapabilities, checkCommandSets, checkTauriConfig } from "./guard/tauri.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function main() {
  const args = process.argv.slice(2);
  const exeIndex = args.indexOf("--exe");
  const ctx = createContext(ROOT);
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
  checkNpm(ctx);
  if (exeIndex >= 0) checkExe(ctx, args[exeIndex + 1] ?? "auto", baseline);

  for (const note of ctx.notes) console.log(`  ok  ${note}`);
  if (ctx.problems.length > 0) {
    console.error(`\nanti-ban guard FAILED (${ctx.problems.length}):`);
    for (const problem of ctx.problems) console.error(`  x  ${problem}`);
    process.exit(1);
  }
  console.log("\nanti-ban guard passed");
}

main();
