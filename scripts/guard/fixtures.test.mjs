// node --test "scripts/guard/*.test.mjs": every planted violation in antiban/fixtures/violations
// is caught, nothing else fires for it, and every rule group has at least one planted case.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";

import { createContext } from "./context.mjs";
import { IMPORT_RULES, SOURCE_RULES } from "./rules.mjs";
import { checkRequired, checkSources, checkWords } from "./sources.mjs";
import { checkInstallerHooks, NSIS_HOOKS } from "./tauri.mjs";

const FIXTURES = new URL("../../antiban/fixtures/violations/", import.meta.url);
const CASE = /^=== (\S+) -> (.+)$/;
const KINDS = ["import outside src/", "could not tokenize", "missing", "words", "config"];

/** `=== <path> -> <groups>` starts a case; its text runs to the next one. */
function readCases(name) {
  const cases = [];
  readFileSync(new URL(name, FIXTURES), "utf8")
    .split(/\r?\n/)
    .forEach((line, index) => {
      const head = CASE.exec(line);
      if (head) {
        const expect = head[2] === "none" ? [] : head[2].split(";").map((group) => group.trim());
        cases.push({ where: `${name}:${index + 1}`, path: head[1], expect, lines: [] });
      } else {
        cases.at(-1)?.lines.push(line);
      }
    });
  return cases;
}

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** What the guard reported about `path`: rule groups for sources, else the kind of problem. */
function reported(problems, path) {
  const about = new RegExp(`^(source|missing|words|config)\\s+${escape(path)}(?=[:\\s])`);
  const groups = new Set();
  for (const problem of problems) {
    const kind = about.exec(problem)?.[1];
    if (kind) groups.add(kind === "source" ? /\[([^\]:]+)/.exec(problem)[1] : kind);
  }
  return [...groups].sort();
}

function runCase({ path, lines }) {
  const root = mkdtempSync(join(tmpdir(), "mapper-guard-"));
  try {
    mkdirSync(join(root, "src-tauri"), { recursive: true });
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), `${lines.join("\n").replace(/^\n+|\s+$/g, "")}\n`);
    const ctx = createContext(root);
    checkSources(ctx);
    checkRequired(ctx);
    checkWords(ctx);
    if (path === `src-tauri/${NSIS_HOOKS}`) checkInstallerHooks(ctx, NSIS_HOOKS);
    return reported(ctx.problems, path);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const cases = readdirSync(FIXTURES)
  .filter((name) => name.endsWith(".txt"))
  .sort()
  .flatMap(readCases);
const groups = new Set([...SOURCE_RULES, ...IMPORT_RULES].map((rule) => rule.group).concat(KINDS));

for (const fixture of cases) {
  test(`${fixture.where}  ${fixture.path} -> ${fixture.expect.join("; ") || "none"}`, () => {
    assert.deepEqual(runCase(fixture), [...fixture.expect].sort());
  });
}

test("cases name only real groups", () => {
  assert.deepEqual(
    cases.flatMap((fixture) => fixture.expect.filter((group) => !groups.has(group)).map((group) => `${fixture.where}: ${group}`)),
    [],
  );
});

test("every rule group has a planted violation", () => {
  const planted = new Set(cases.flatMap((fixture) => fixture.expect));
  assert.deepEqual([...groups].filter((group) => !planted.has(group)), []);
});
