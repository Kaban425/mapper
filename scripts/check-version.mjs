// Release gate (plan/eng.md §9): the tag, package.json, package-lock.json, Cargo.toml and
// Cargo.lock name one version, and CHANGELOG.md has its section.
//   node scripts/check-version.mjs v1.2.3   a tag push: the tag must match
//   node scripts/check-version.mjs          a trial run: the version in package.json
// Prints `version=`, `tag=` and `prerelease=` lines, also appended to $GITHUB_OUTPUT in CI.

import { appendFileSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { cargoVersion, changelogSection, lockVersion, parseTag } from "./release/version.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");

function check(tag) {
  const version = JSON.parse(read("package.json")).version;
  const lock = JSON.parse(read("package-lock.json"));
  const mirrors = {
    "package-lock.json": lock.version,
    'package-lock.json packages[""]': lock.packages?.[""]?.version,
    "src-tauri/Cargo.toml": cargoVersion(read("src-tauri/Cargo.toml")),
    "src-tauri/Cargo.lock": lockVersion(read("src-tauri/Cargo.lock")),
  };
  const problems = Object.entries(mirrors)
    .filter(([, found]) => found !== version)
    .map(([file, found]) => `${file} has ${found}, package.json ${version} (npm run version:bump ${version})`);
  const parsed = parseTag(tag ?? `v${version}`);
  if (!parsed) problems.push(`"${tag ?? version}" is not vX.Y.Z or vX.Y.Z-rc.N`);
  else if (parsed.version !== version) problems.push(`the tag ${tag} does not match package.json ${version}`);
  if (!changelogSection(read("CHANGELOG.md"), version)) {
    problems.push(`CHANGELOG.md has no notes under "## [${version}]" (npm run version:bump ${version})`);
  }
  return { version, prerelease: parsed?.prerelease ?? false, problems };
}

const { version, prerelease, problems } = check(process.argv[2] || undefined);
if (problems.length > 0) {
  for (const problem of problems) console.error(`version: ${problem}`);
  process.exit(1);
}
const output = `version=${version}\ntag=v${version}\nprerelease=${prerelease}\n`;
process.stdout.write(output);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, output);
