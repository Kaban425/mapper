// node --test "scripts/release/*.test.mjs": the version helpers the release workflow relies on.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  cargoVersion,
  changelogSection,
  lockVersion,
  parseTag,
  releaseChangelog,
  setCargoVersion,
  setLockVersion,
  setNpmVersion,
} from "./version.mjs";

const CARGO = '[package]\nname = "mapper"\nversion = "0.1.0"\ndescription = "costs $& and $`"\n\n[dependencies]\nwindows = { version = "0.62" }\n';
const LOCK = '[[package]]\nname = "lzma"\nversion = "0.1.0"\n\n[[package]]\nname = "mapper"\nversion = "0.1.0"\ndependencies = []\n';
const CHANGELOG = [
  "# Changelog",
  "",
  "## [Unreleased]",
  "",
  "### Added",
  "- The ruler.",
  "",
  "## [0.0.9] - 2026-10-01",
  "",
  "- Spike.",
  "",
  "[0.0.9]: https://example.invalid/0.0.9",
  "",
].join("\n");

test("tags are vX.Y.Z or vX.Y.Z-rc.N", () => {
  assert.deepEqual(parseTag("v1.2.3"), { version: "1.2.3", prerelease: false });
  assert.deepEqual(parseTag("v1.2.3-rc.2"), { version: "1.2.3-rc.2", prerelease: true });
  for (const bad of ["1.2.3", "v1.2", "v01.2.3", "v1.2.3-beta", "main", "", undefined]) assert.equal(parseTag(bad), null, bad);
});

test("only Mapper's own version is read and written", () => {
  assert.equal(cargoVersion(CARGO), "0.1.0");
  const cargo = setCargoVersion(CARGO, "1.0.0");
  assert.equal(cargoVersion(cargo), "1.0.0");
  assert.match(cargo, /windows = \{ version = "0\.62" \}/, "dependency versions stay");
  assert.match(cargo, /description = "costs \$& and \$`"/, "no replacement patterns expand");
  assert.equal(lockVersion(LOCK), "0.1.0");
  const lock = setLockVersion(LOCK, "1.0.0");
  assert.equal(lockVersion(lock), "1.0.0");
  assert.match(lock, /name = "lzma"\nversion = "0\.1\.0"/, "another crate with the same version stays");
});

test("npm files keep their layout and line endings", () => {
  const lock = '{\r\n  "name": "mapper",\r\n  "version": "0.1.0",\r\n  "packages": {\r\n    "": {\r\n      "version": "0.1.0"\r\n    }\r\n  }\r\n}\r\n';
  const next = setNpmVersion(lock, "1.0.0");
  assert.deepEqual(JSON.parse(next), { name: "mapper", version: "1.0.0", packages: { "": { version: "1.0.0" } } });
  assert.ok(next.endsWith("}\r\n") && !/[^\r]\n/.test(next));
});

test("a release takes the Unreleased notes", () => {
  const released = releaseChangelog(CHANGELOG, "0.1.0", "2026-11-01");
  assert.equal(changelogSection(released, "0.1.0"), "### Added\n- The ruler.");
  assert.equal(changelogSection(released, "Unreleased"), "");
  assert.equal(changelogSection(released, "0.0.9"), "- Spike.", "link references are not notes");
  assert.throws(() => releaseChangelog(released, "0.1.0", "2026-11-02"), /already has/);
  assert.throws(() => releaseChangelog(released, "0.2.0", "2026-11-02"), /empty/);
});
