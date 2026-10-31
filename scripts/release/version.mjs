// Version bookkeeping for releases (plan/eng.md §9): the version lives in package.json and is
// mirrored in package-lock.json, src-tauri/Cargo.toml and Cargo.lock; CHANGELOG.md follows
// Keep a Changelog. Pure functions over file texts; the scripts in scripts/ do the reading.

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-rc\.(0|[1-9]\d*))?$/;

export const isVersion = (text) => SEMVER.test(text ?? "");

/** `v1.2.3` or `v1.2.3-rc.1` → `{ version, prerelease }`; anything else → null. */
export function parseTag(tag) {
  const version = /^v(.+)$/.exec(tag ?? "")?.[1];
  return isVersion(version) ? { version, prerelease: version.includes("-rc.") } : null;
}

/** The `[package]` table's text (up to the next table). */
const packageTable = (toml) => /^\[package\][^\S\n]*\r?\n([\s\S]*?)(?=^\[|(?![\s\S]))/m.exec(toml);

export const cargoVersion = (toml) => /^version\s*=\s*"([^"]+)"/m.exec(packageTable(toml)?.[1] ?? "")?.[1] ?? null;

const LOCK_ENTRY = /(\[\[package\]\]\r?\nname = "mapper"\r?\nversion = ")([^"]+)(")/;

export const lockVersion = (lock) => LOCK_ENTRY.exec(lock)?.[2] ?? null;

export function setCargoVersion(toml, version) {
  const table = packageTable(toml);
  if (!table) throw new Error("Cargo.toml has no [package] table");
  const body = table[1].replace(/^(version\s*=\s*")[^"]+(")/m, `$1${version}$2`);
  const start = table.index + table[0].length - table[1].length;
  return toml.slice(0, start) + body + toml.slice(start + table[1].length);
}

export function setLockVersion(lock, version) {
  if (!LOCK_ENTRY.test(lock)) throw new Error("Cargo.lock has no mapper entry");
  return lock.replace(LOCK_ENTRY, `$1${version}$3`);
}

/** package.json and package-lock.json: their own version fields, nothing else (npm's layout kept). */
export function setNpmVersion(json, version) {
  const data = JSON.parse(json);
  data.version = version;
  if (data.packages?.[""]) data.packages[""].version = version;
  const text = `${JSON.stringify(data, null, 2)}\n`;
  return json.includes("\r\n") ? text.replaceAll("\n", "\r\n") : text;
}

const HEADING = /^## \[([^\]]+)\]/;
const LINK_REFERENCE = /^\[[^\]]+\]:\s/;

/** The text under `## [version]` (link references at the end excluded), or null. */
export function changelogSection(text, version) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => HEADING.exec(line)?.[1] === version);
  if (start < 0) return null;
  const next = lines.findIndex((line, index) => index > start && (HEADING.test(line) || LINK_REFERENCE.test(line)));
  return lines
    .slice(start + 1, next < 0 ? undefined : next)
    .join("\n")
    .trim();
}

/** "## [Unreleased]" becomes "## [version] - date" under a new, empty Unreleased section. */
export function releaseChangelog(text, version, date) {
  if (changelogSection(text, version) !== null) throw new Error(`CHANGELOG.md already has ${version}`);
  if (!changelogSection(text, "Unreleased")) throw new Error("CHANGELOG.md: ## [Unreleased] is missing or empty");
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  return text.replace(/^## \[Unreleased\][^\r\n]*/m, `## [Unreleased]${eol}${eol}## [${version}] - ${date}`);
}
