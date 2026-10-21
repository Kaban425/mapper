// Source rules: forbidden APIs per line, statements that must exist, and wording.

import { readdirSync } from "node:fs";
import { extname } from "node:path";

import { isLineComment, matchesPath, stripLineComments, walk } from "./context.mjs";
import {
  CLAIMS,
  EXTRA_FILES,
  NEGATION_BEFORE,
  REQUIRED,
  SOURCE_DIRS,
  SOURCE_EXT,
  SOURCE_RULES,
  WORD_DIRS,
  WORD_FILES,
} from "./rules.mjs";

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

const applies = (rule, path) =>
  (!rule.ext || rule.ext.includes(extname(path))) &&
  (!rule.only || matchesPath(path, rule.only)) &&
  !matchesPath(path, rule.allow ?? []);

export function checkSources(ctx) {
  const files = sourceFiles(ctx);
  for (const path of files) {
    const rules = SOURCE_RULES.filter((rule) => applies(rule, path));
    ctx
      .read(path)
      .split("\n")
      .forEach((line, index) => {
        if (isLineComment(line)) return;
        for (const rule of rules) {
          if (rule.pattern.test(line)) {
            ctx.fail(`source  ${path}:${index + 1}  [${rule.group}]  ${line.trim().slice(0, 160)}`);
          }
        }
      });
  }
  ctx.ok(`sources: ${files.length} files scanned against ${SOURCE_RULES.length} rules`);
}

export function checkRequired(ctx) {
  let present = 0;
  for (const rule of REQUIRED) {
    const text = stripLineComments(ctx.read(rule.file) ?? "");
    const wanted = rule.count ?? 1;
    const found = text.match(new RegExp(rule.pattern.source, `${rule.pattern.flags}g`))?.length ?? 0;
    if (rule.exact ? found === wanted : found >= wanted) {
      present += 1;
    } else {
      const times = wanted > 1 || rule.exact ? ` x${wanted}${rule.exact ? " exactly" : ""}, found ${found}` : "";
      ctx.fail(`missing ${rule.file}: ${rule.pattern.source}${times} (${rule.why})`);
    }
  }
  ctx.ok(`required statements: ${present}/${REQUIRED.length} present`);
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
