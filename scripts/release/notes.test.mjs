// node --test "scripts/release/*.test.mjs": the release body.

import assert from "node:assert/strict";
import { test } from "node:test";

import { findClaims } from "../guard/sources.mjs";
import { firstParagraph, renderNotes } from "./notes.mjs";

const readmes = {
  ru: "# Mapper\n\n## Честно о риске\n\nГарантии от бана нет.\nРешаешь ты.\n\nВторой абзац.\n\n## Дальше\n",
  en: "# Mapper\n\n## Honest about the risk\n\nThere is no guarantee against a ban.\n",
};
const files = [
  { name: "Mapper_0.1.0_x64-setup.exe", sha256: "a".repeat(64) },
  { name: "Mapper_0.1.0_x64_portable.exe", sha256: "b".repeat(64) },
];

test("the risk text is the first paragraph of each README's section", () => {
  assert.equal(firstParagraph(readmes.ru, "## Честно о риске"), "Гарантии от бана нет. Решаешь ты.");
  assert.throws(() => firstParagraph("# Mapper\n", "## Честно о риске"), /no "## Честно о риске"/);
});

test("the notes list both files with their SHA-256 and how to verify them", () => {
  const notes = renderNotes({ version: "0.1.0", repo: "someone/mapper", files, changes: "### Added\n- The ruler.", readmes });
  assert.ok(notes.startsWith("### Added\n- The ruler.\n"));
  assert.match(notes, /\| `Mapper_0\.1\.0_x64-setup\.exe` \| установщик/);
  assert.match(notes, /\| `Mapper_0\.1\.0_x64_portable\.exe` \| portable/);
  assert.match(notes, new RegExp(`${"a".repeat(64)}  Mapper_0\\.1\\.0_x64-setup\\.exe`));
  assert.match(
    notes,
    /gh attestation verify Mapper_0\.1\.0_x64-setup\.exe --repo someone\/mapper --source-ref refs\/tags\/v0\.1\.0 --signer-workflow someone\/mapper\/\.github\/workflows\/release\.yml/,
  );
  assert.match(notes, /Гарантии от бана нет\. Решаешь ты\.\n\nThere is no guarantee against a ban\./);
  assert.deepEqual(findClaims(notes), [], "the wording rule (C-7)");
});

test("nothing to release without notes or files", () => {
  assert.throws(() => renderNotes({ version: "0.1.0", repo: "a/b", files, changes: null, readmes }), /no notes/);
  assert.throws(() => renderNotes({ version: "0.1.0", repo: "a/b", files: [], changes: "x", readmes }), /no \.exe/);
});
