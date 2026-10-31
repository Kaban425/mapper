// A small Rust lexer for the guard (plan/eng.md §7.1): comments become spaces, while strings,
// raw strings and character literals stay as they are; line breaks are kept, so line numbers
// still match. Code is never dropped: a string or comment that does not end is an error, and the
// caller then scans the raw text instead. (`syn` is not used: the guard runs without Rust.)

const IDENT = /[A-Za-z0-9_]/;
const RAW_STRING = /(?:b|c)?r(#*)"/y;

const blank = (text) => text.replace(/[^\n]/g, " ");

/** The end of a nested block comment that starts at `start`, or -1. */
function blockCommentEnd(src, start) {
  let depth = 0;
  for (let j = start; j < src.length - 1; j += 1) {
    if (src[j] === "/" && src[j + 1] === "*") {
      depth += 1;
      j += 1;
    } else if (src[j] === "*" && src[j + 1] === "/") {
      depth -= 1;
      j += 1;
      if (depth === 0) return j + 1;
    }
  }
  return -1;
}

/** The end of a `"…"` string starting at `start` (escapes skipped), or -1. */
function stringEnd(src, start) {
  for (let j = start + 1; j < src.length; j += 1) {
    if (src[j] === "\\") j += 1;
    else if (src[j] === '"') return j + 1;
  }
  return -1;
}

/** A character literal at `start` ('x', '\n', '\'', '\u{1F600}'), or -1 for a lifetime or label. */
function charEnd(src, start) {
  if (src[start + 1] === "\\") {
    for (let j = start + 3; j < src.length && j - start <= 12; j += 1) {
      if (src[j] === "'") return j + 1;
      if (src[j] === "\n") return -1;
    }
    return -1;
  }
  const point = src.codePointAt(start + 1);
  if (point === undefined || src[start + 1] === "\n") return -1;
  const width = point > 0xffff ? 2 : 1;
  return src[start + 1 + width] === "'" ? start + 2 + width : -1;
}

/** `{ code, error }`: `code` is `src` with every comment blanked; `error` names what did not end. */
export function stripRustComments(src) {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];
    if (c === "/" && next === "/") {
      const end = src.indexOf("\n", i);
      const stop = end < 0 ? src.length : end;
      out += blank(src.slice(i, stop));
      i = stop;
      continue;
    }
    if (c === "/" && next === "*") {
      const end = blockCommentEnd(src, i);
      if (end < 0) return { code: src, error: "unterminated block comment" };
      out += blank(src.slice(i, end));
      i = end;
      continue;
    }
    if ((c === "r" || c === "b" || c === "c") && !IDENT.test(src[i - 1] ?? "")) {
      RAW_STRING.lastIndex = i;
      const raw = RAW_STRING.exec(src);
      if (raw) {
        const close = `"${raw[1]}`;
        const end = src.indexOf(close, i + raw[0].length);
        if (end < 0) return { code: src, error: "unterminated raw string" };
        out += src.slice(i, end + close.length);
        i = end + close.length;
        continue;
      }
    }
    if (c === '"') {
      const end = stringEnd(src, i);
      if (end < 0) return { code: src, error: "unterminated string" };
      out += src.slice(i, end);
      i = end;
      continue;
    }
    if (c === "'") {
      const end = charEnd(src, i);
      if (end > 0) {
        out += src.slice(i, end);
        i = end;
        continue;
      }
    }
    out += c;
    i += 1;
  }
  return { code: out, error: null };
}
