// The release body and SHA256SUMS.txt (plan/eng.md §9), run by the release workflow:
//   node scripts/release-notes.mjs <version> <owner/repo> <folder>
// writes <folder>/SHA256SUMS.txt for the files there and prints the notes: the CHANGELOG
// section, the downloads, how to check them, and the risk text from both READMEs. The notes
// pass the same wording rule as the README (C-7).

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { findClaims } from "./guard/sources.mjs";
import { renderNotes } from "./release/notes.mjs";
import { changelogSection } from "./release/version.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const [version, repo, folder] = process.argv.slice(2);
if (!version || !/^[\w.-]+\/[\w.-]+$/.test(repo ?? "") || !folder) {
  console.error("usage: node scripts/release-notes.mjs <version> <owner/repo> <folder>");
  process.exit(1);
}

const files = readdirSync(folder)
  .filter((name) => name.endsWith(".exe"))
  .sort()
  .map((name) => ({ name, sha256: createHash("sha256").update(readFileSync(join(folder, name))).digest("hex") }));
const notes = renderNotes({
  version,
  repo,
  files,
  changes: changelogSection(read("CHANGELOG.md"), version),
  readmes: { ru: read("README.md"), en: read("README.en.md") },
});
const claims = findClaims(notes);
if (claims.length > 0) {
  console.error(`release-notes: wording rule (C-7): ${claims.map((c) => `line ${c.line} "${c.claim}"`).join(", ")}`);
  process.exit(1);
}
writeFileSync(join(folder, "SHA256SUMS.txt"), files.map((f) => `${f.sha256}  ${f.name}\n`).join(""));
process.stdout.write(notes);
