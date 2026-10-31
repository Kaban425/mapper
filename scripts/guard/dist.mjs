// The built web pages (plan/eng.md §7.3): the same API groups as the sources, now over the
// bundled JavaScript, so code that came from npm is checked too. A few exact snippets of the
// bundled libraries would match; they are masked with a reason (DIST_ALLOW), nothing else is.

import { readFileSync } from "node:fs";

import { walk } from "./context.mjs";
import { DIST_ALLOW, DIST_RULES } from "./rules.mjs";

/** Blanks every allowed snippet; returns the text and how many were masked. */
export function maskAllowed(text) {
  let masked = 0;
  let result = text;
  for (const { pattern } of DIST_ALLOW) {
    result = result.replace(new RegExp(pattern.source, `${pattern.flags.replace("g", "")}g`), (match) => {
      masked += 1;
      return " ".repeat(match.length);
    });
  }
  return { text: result, masked };
}

export function findDistViolations(text) {
  const { text: open, masked } = maskAllowed(text);
  const found = [];
  for (const rule of DIST_RULES) {
    for (const match of open.matchAll(new RegExp(rule.pattern.source, `${rule.pattern.flags.replace("g", "")}g`))) {
      const at = match.index ?? 0;
      found.push({ group: rule.group, snippet: open.slice(Math.max(0, at - 40), at + 60).replace(/\s+/g, " ") });
    }
  }
  return { found, masked };
}

export function checkDist(ctx) {
  const files = walk(ctx.path("dist")).filter((file) => /\.(js|mjs|html)$/.test(file));
  if (files.length === 0) {
    ctx.fail("dist: no pages in dist/ (run `npm run build` first)");
    return;
  }
  let masked = 0;
  for (const file of files) {
    const result = findDistViolations(readFileSync(file, "utf8"));
    masked += result.masked;
    for (const { group, snippet } of result.found) ctx.fail(`dist    ${ctx.rel(file)}  [${group}]  …${snippet}…`);
  }
  ctx.ok(`dist: ${files.length} file(s) checked against ${DIST_RULES.length} groups, ${masked} allowed library snippet(s)`);
}
