// node --test scripts/guard: the Rust lexer keeps every bit of code and drops only comments.

import assert from "node:assert/strict";
import { test } from "node:test";

import { stripRustComments } from "./lexer.mjs";

const strip = (src) => {
  const { code, error } = stripRustComments(src);
  assert.equal(error, null);
  assert.equal(code.length, src.length, "positions and line numbers are kept");
  return code;
};

test("comments go, code stays", () => {
  const code = strip("let a = 1; // SendInput\n/* FindWindowW\n /* nested */ BitBlt */ let b = 2;");
  assert.doesNotMatch(code, /SendInput|FindWindowW|BitBlt/);
  assert.match(code, /let a = 1;/);
  assert.match(code, /let b = 2;/);
  assert.equal(code.split("\n").length, 3);
});

test("comment markers inside strings and chars are not comments", () => {
  for (const src of [
    'let s = "/*"; SendInput();',
    'let s = "a // b"; SendInput();',
    'let s = r#"a "/* b"#; SendInput();',
    'let s = br##"x"#"##; SendInput();',
    "let c = '\"'; SendInput(); // \"",
    "let c = '\\''; SendInput();",
    "let c = '/'; let d = '*'; SendInput();",
    'let s = "esc \\" // still a string"; SendInput();',
    'let s = c"/*"; SendInput();',
  ]) {
    assert.match(strip(src), /SendInput\(\)/, src);
  }
});

test("lifetimes and labels are not character literals", () => {
  const code = strip("fn f<'a>(x: &'a str) -> &'a str { 'outer: loop { break 'outer; } x } // GetCursorPos");
  assert.match(code, /'outer: loop/);
  assert.doesNotMatch(code, /GetCursorPos/);
});

test("raw identifiers are code", () => {
  assert.match(strip("let r#type = 1; SendInput();"), /SendInput/);
});

test("an unterminated string or comment is an error, never a silent drop", () => {
  for (const src of ['let s = "open; SendInput();', "/* open SendInput();", 'let s = r#"open"; SendInput();']) {
    const { code, error } = stripRustComments(src);
    assert.notEqual(error, null, src);
    assert.equal(code, src, "the raw text comes back");
  }
});
