// The hotkey recorder's rules (plan/ux.md §6.4), the same as `check_recordable` in Rust:
// Alt or Ctrl (Shift optional, not both Alt and Ctrl with a letter or digit — that is AltGr on
// many layouts) with a letter, digit or arrow, or F1–F24 with or without modifiers; no Win, no
// Alt+F4, no F12, not the other preset's combination. Rust checks again.

import type { MainKey } from "../../lib/i18n/main";

export interface KeyPress {
  readonly code: string;
  /** The character of the player's layout: a letter is named by it (QWERTZ, AZERTY). */
  readonly key: string;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly metaKey: boolean;
}

export type Recorded =
  /** Only modifiers so far: wait for the main key. */
  | { readonly kind: "modifiers"; readonly preview: string }
  | { readonly kind: "key"; readonly accelerator: string; readonly problem: MainKey | null };

const MODIFIER_CODES = new Set(["AltLeft", "AltRight", "ControlLeft", "ControlRight", "ShiftLeft", "ShiftRight", "MetaLeft", "MetaRight"]);
const ARROWS: Readonly<Record<string, string>> = { ArrowLeft: "Left", ArrowUp: "Up", ArrowRight: "Right", ArrowDown: "Down" };

/**
 * The key's name as Rust's `spec::format` writes it, or null for keys Rust does not know.
 * RegisterHotKey takes the layout's virtual key, so a letter is the one the layout types
 * (Z on the QWERTZ key where US has Y); a non-Latin layout uses the US position, as Windows does.
 */
function keyName(code: string, key: string): string | null {
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return /^[a-z]$/i.test(key) ? key.toUpperCase() : letter[1]!;
  const digit = /^Digit([0-9])$/.exec(code);
  if (digit) return digit[1]!;
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code;
  return ARROWS[code] ?? null;
}

function modifiers(e: KeyPress): string[] {
  return [e.ctrlKey && "Ctrl", e.altKey && "Alt", e.shiftKey && "Shift", e.metaKey && "Win"].filter(
    (m): m is string => typeof m === "string",
  );
}

function problem(e: KeyPress, name: string | null, accelerator: string, other: string): MainKey | null {
  if (e.metaKey) return "settings.hotkey.win";
  if (name === null || name === "F12") return "settings.hotkey.key";
  const functionKey = /^F\d+$/.test(name);
  if (functionKey && name === "F4" && e.altKey) return "settings.hotkey.altF4";
  if (!functionKey && !e.altKey && !e.ctrlKey) return "settings.hotkey.single";
  if (/^[A-Z0-9]$/.test(name) && e.altKey && e.ctrlKey) return "settings.hotkey.altGr";
  if (accelerator === other) return "settings.hotkey.duplicate";
  return null;
}

/** One key-down while recording; `other` is the other preset's combination. */
export function record(e: KeyPress, other: string): Recorded {
  const mods = modifiers(e);
  if (MODIFIER_CODES.has(e.code)) return { kind: "modifiers", preview: `${mods.join("+")}+…` };
  const name = keyName(e.code, e.key);
  const accelerator = [...mods, name ?? e.code].join("+");
  return { kind: "key", accelerator, problem: problem(e, name, accelerator, other) };
}
