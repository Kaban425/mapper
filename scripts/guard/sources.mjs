// Source rules: forbidden APIs per line, statements that must exist, and wording. Rust goes
// through the lexer, so comments anywhere are ignored and a statement inside one does not count;
// other files skip whole-line `//` comments only (a web lexer would have to guess where regex
// literals start, and a wrong guess hides code; the bundle in dist/ is checked separately).

import { readdirSync } from "node:fs";
import { extname, posix } from "node:path";

import { isLineComment, matchesPath, stripLineComments, walk } from "./context.mjs";
import { stripRustComments } from "./lexer.mjs";
import {
  CLAIMS,
  EXTRA_FILES,
  IMPORT_RULES,
  NEGATION_BEFORE,
  RELEASE_PLACEHOLDERS,
  REQUIRED,
  SOURCE_DIRS,
  SOURCE_EXT,
  SOURCE_RULES,
  WEB,
  WORD_DIRS,
  WORD_FILES,
} from "./rules.mjs";

const WEB_EXT = new Set(WEB);

function sourceFiles(ctx) {
  const configs = readdirSync(ctx.path("src-tauri"))
    .filter((name) => /^tauri(\..+)?\.conf\.json5?$|^Tauri\.toml$/.test(name))
    .map((name) => `src-tauri/${name}`);
  const files = [
    ...SOURCE_DIRS.flatMap((dir) => walk(ctx.path(dir)).map(ctx.rel)),
    ...EXTRA_FILES.filter(ctx.exists),
    ...configs,
  ];
  return [...new Set(files)].filter((file) => SOURCE_EXT.has(extname(file)));
}

const isTest = (path) => /\.test\.ts$/.test(path);

const applies = (rule, path) =>
  (!rule.ext || rule.ext.includes(extname(path))) &&
  (!rule.only || matchesPath(path, rule.only)) &&
  !(rule.skipTests && isTest(path)) &&
  !matchesPath(path, rule.allow ?? []);

// `from "..."`, `import "..."` and `import("...")` with a relative path.
const RELATIVE_IMPORT = /(?:\bfrom\s*|\bimport\s*\(?\s*)["'](\.{1,2}\/[^"']*)["']/g;

const importBlocked = (rule, path) =>
  rule.only ? matchesPath(path, rule.only) : !matchesPath(path, rule.from ?? []);

/**
 * Web code under src/ may not reach files outside it, where no rule looks, and the IPC
 * limits hold for the resolved path too. Tests may: they read golden files and the mock.
 */
function checkImports(ctx, path, text) {
  if (!path.startsWith("src/") || !WEB_EXT.has(extname(path)) || isTest(path)) return;
  for (const match of text.matchAll(RELATIVE_IMPORT)) {
    const target = posix.normalize(posix.join(posix.dirname(path), match[1]));
    if (!target.startsWith("src/")) ctx.fail(`source  ${path}  [import outside src/]  ${match[1]}`);
    for (const rule of IMPORT_RULES) {
      if (rule.target.test(target) && importBlocked(rule, path)) ctx.fail(`source  ${path}  [${rule.group}]  ${match[1]}`);
    }
  }
}

/** Rust code with every comment blanked; null (and a problem) when it does not tokenize. */
function rustCode(ctx, path, text) {
  const { code, error } = stripRustComments(text);
  if (error === null) return code;
  ctx.fail(`source  ${path}  [could not tokenize: ${error}]  scanned as raw text`);
  return null;
}

export function checkSources(ctx) {
  const files = sourceFiles(ctx);
  for (const path of files) {
    const rules = SOURCE_RULES.filter((rule) => applies(rule, path));
    const text = ctx.read(path);
    checkImports(ctx, path, stripLineComments(text));
    const code = extname(path) === ".rs" ? rustCode(ctx, path, text) : null;
    (code ?? text)
      .split("\n")
      .forEach((line, index) => {
        if (code === null && isLineComment(line)) return;
        for (const rule of rules) {
          if (rule.pattern.test(line)) {
            ctx.fail(`source  ${path}:${index + 1}  [${rule.group}]  ${line.trim().slice(0, 160)}`);
          }
        }
      });
  }
  ctx.ok(`sources: ${files.length} files scanned against ${SOURCE_RULES.length} rules`);
}

// Comment forms removed loosely, strings included, before counting the least number of matches:
// that removes only too much, so whatever still matches is code. The most is counted with only
// whole-line `//` comments removed (never code in web files), or over the raw text.
const JS_COMMENTS = [/\/\*[\s\S]*?(?:\*\/|$)/g, /\/\/.*$/gm];
const XML_COMMENTS = [/<!--[\s\S]*?(?:-->|$)/g];
const LOOSE_COMMENTS = {
  ...Object.fromEntries(WEB.map((ext) => [ext, JS_COMMENTS])),
  ".svelte": [...JS_COMMENTS, ...XML_COMMENTS],
  ".html": [...JS_COMMENTS, ...XML_COMMENTS],
  ".xml": XML_COMMENTS,
  ".toml": [/#.*$/gm],
};

const blank = (text) => text.replace(/[^\n]/g, " ");

/** How often `pattern` occurs as code: exact in Rust, a `least..most` range elsewhere. */
export function countCode(file, text, pattern) {
  const count = (source) => source.match(new RegExp(pattern.source, `${pattern.flags}g`))?.length ?? 0;
  const ext = extname(file);
  if (ext === ".rs") {
    const { code, error } = stripRustComments(text);
    return error === null ? { least: count(code), most: count(code) } : { error };
  }
  const loose = (LOOSE_COMMENTS[ext] ?? []).reduce((source, comment) => source.replace(comment, blank), text);
  return { least: count(loose), most: count(WEB_EXT.has(ext) ? stripLineComments(text) : text) };
}

export function checkRequired(ctx) {
  let present = 0;
  for (const rule of REQUIRED) {
    const found = countCode(rule.file, ctx.read(rule.file) ?? "", rule.pattern);
    const wanted = rule.count ?? 1;
    if (found.error) {
      ctx.fail(`missing ${rule.file}: could not tokenize (${found.error}), ${rule.pattern.source} unverified`);
    } else if (found.least >= wanted && (!rule.exact || found.most === wanted)) {
      present += 1;
    } else {
      const seen = found.least === found.most ? `${found.least}` : `${found.least}..${found.most}`;
      const times = wanted > 1 || rule.exact ? ` x${wanted}${rule.exact ? " exactly" : ""}, found ${seen}` : "";
      ctx.fail(`missing ${rule.file}: ${rule.pattern.source}${times} (${rule.why})`);
    }
  }
  ctx.ok(`required statements: ${present}/${REQUIRED.length} present`);
}

/** Release builds: no placeholder left (the repository name, Phase 5). */
export function checkRelease(ctx) {
  for (const { file, pattern, why } of RELEASE_PLACEHOLDERS) {
    if (pattern.test(stripLineComments(ctx.read(file) ?? ""))) ctx.fail(`release ${file}: ${why}`);
  }
  ctx.ok(`release: ${RELEASE_PLACEHOLDERS.length} placeholder check(s)`);
}

/** A claim counts unless a negation stands right before it. */
export function findClaim(line) {
  for (const claim of CLAIMS) {
    for (const match of line.matchAll(new RegExp(claim.source, `${claim.flags}g`))) {
      if (!NEGATION_BEFORE.test(line.slice(0, match.index))) return match[0];
    }
  }
  return null;
}

// C-7: the README and every user-facing text never promise that the tool is safe or undetected.
export function checkWords(ctx) {
  const readmes = readdirSync(ctx.root).filter((name) => /^README.*\.md$/i.test(name));
  const files = [
    ...readmes,
    ...WORD_FILES.filter(ctx.exists),
    ...WORD_DIRS.flatMap((dir) => walk(ctx.path(dir)).map(ctx.rel)),
  ];
  for (const path of files) {
    ctx
      .read(path)
      .split("\n")
      .forEach((line, index) => {
        if (isLineComment(line)) return; // e.g. `// SAFETY:` notes in Rust
        const claim = findClaim(line);
        if (claim) ctx.fail(`words   ${path}:${index + 1}  "${claim}"  ${line.trim().slice(0, 140)}`);
      });
  }
  ctx.ok(`wording: ${files.length} file(s) checked for safety claims`);
}
