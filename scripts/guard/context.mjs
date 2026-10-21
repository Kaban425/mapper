// Shared helpers for the guard checks. One context per run collects problems and notes,
// so every check can also run against a fixture tree instead of the repository.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export function createContext(root) {
  const problems = [];
  const notes = [];
  const path = (relPath) => join(root, relPath);
  const exists = (relPath) => existsSync(path(relPath));
  return {
    root,
    problems,
    notes,
    fail: (message) => problems.push(message),
    ok: (message) => notes.push(message),
    path,
    exists,
    rel: (absPath) => relative(root, absPath).replaceAll("\\", "/"),
    read: (relPath) => (exists(relPath) ? readFileSync(path(relPath), "utf8") : null),
  };
}

export function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

/** Only whole-line `//` comments are skipped, so string tricks such as `" //"` hide nothing. */
export const isLineComment = (line) => /^\s*\/\//.test(line);

export const stripLineComments = (text) =>
  text
    .split("\n")
    .filter((line) => !isLineComment(line))
    .join("\n");

/** Entries ending in "/" match a directory prefix, the others one exact file. */
export const matchesPath = (path, entries) =>
  entries.some((entry) => (entry.endsWith("/") ? path.startsWith(entry) : path === entry));

/** Parses a JSON file, reporting a problem instead of throwing. */
export function readJson(ctx, relPath) {
  const text = ctx.read(relPath);
  if (text === null) {
    ctx.fail(`file    ${relPath} is missing`);
    return null;
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    ctx.fail(`file    ${relPath} is not valid JSON: ${error.message}`);
    return null;
  }
}
