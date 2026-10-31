// npm run version:bump X.Y.Z (plan/eng.md §9): writes the version into package.json,
// package-lock.json, src-tauri/Cargo.toml and Cargo.lock, and turns CHANGELOG.md's Unreleased
// notes into the section of that version, dated today (UTC). Nothing is written if any step
// fails. Then merge it into main and tag that commit: the release workflow builds a draft.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { isVersion, releaseChangelog, setCargoVersion, setLockVersion, setNpmVersion } from "./release/version.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const version = process.argv[2];
if (!isVersion(version)) {
  console.error("usage: npm run version:bump X.Y.Z   (or X.Y.Z-rc.N)");
  process.exit(1);
}

const steps = {
  "package.json": (text) => setNpmVersion(text, version),
  "package-lock.json": (text) => setNpmVersion(text, version),
  "src-tauri/Cargo.toml": (text) => setCargoVersion(text, version),
  "src-tauri/Cargo.lock": (text) => setLockVersion(text, version),
  "CHANGELOG.md": (text) => releaseChangelog(text, version, new Date().toISOString().slice(0, 10)),
};

let updated;
try {
  updated = Object.entries(steps).map(([file, step]) => [file, step(readFileSync(resolve(root, file), "utf8"))]);
} catch (error) {
  console.error(`version:bump: ${error.message}`);
  process.exit(1);
}
for (const [file, text] of updated) writeFileSync(resolve(root, file), text);
console.log(`version ${version} written to ${updated.map(([file]) => file).join(", ")}`);
console.log(`next: commit "Release v${version}", merge it into main through a pull request, then tag the merge`);
console.log(`      commit on main: git tag v${version} <commit> && git push origin v${version}`);
