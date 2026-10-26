import { describe, expect, it } from "vitest";

import { record, type KeyPress } from "./recorder";

const press = (code: string, mods: Partial<Omit<KeyPress, "code">> = {}): KeyPress => ({
  code,
  key: /^Key[A-Z]$/.test(code) ? code.slice(3).toLowerCase() : code,
  altKey: false,
  ctrlKey: false,
  shiftKey: false,
  metaKey: false,
  ...mods,
});

describe("hotkey recorder", () => {
  it("writes combinations the way Rust formats them", () => {
    expect(record(press("KeyE", { altKey: true }), "Alt+W")).toEqual({ kind: "key", accelerator: "Alt+E", problem: null });
    expect(record(press("Digit5", { ctrlKey: true, shiftKey: true }), "Alt+W")).toMatchObject({
      accelerator: "Ctrl+Shift+5",
      problem: null,
    });
    expect(record(press("ArrowUp", { ctrlKey: true }), "Alt+W")).toMatchObject({ accelerator: "Ctrl+Up", problem: null });
    expect(record(press("F7"), "Alt+W")).toMatchObject({ accelerator: "F7", problem: null });
    expect(record(press("F8", { shiftKey: true }), "Alt+W")).toMatchObject({ accelerator: "Shift+F8", problem: null });
  });

  it("waits while only modifiers are down", () => {
    expect(record(press("AltLeft", { altKey: true }), "Alt+W")).toEqual({ kind: "modifiers", preview: "Alt+…" });
    expect(record(press("ControlRight", { ctrlKey: true, shiftKey: true }), "Alt+W")).toEqual({
      kind: "modifiers",
      preview: "Ctrl+Shift+…",
    });
  });

  it("explains every refusal", () => {
    const problem = (e: KeyPress) => (record(e, "Alt+W") as { problem: string | null }).problem;
    expect(problem(press("KeyQ"))).toBe("settings.hotkey.single");
    expect(problem(press("KeyQ", { shiftKey: true }))).toBe("settings.hotkey.single");
    expect(problem(press("KeyQ", { metaKey: true, altKey: true }))).toBe("settings.hotkey.win");
    expect(problem(press("F4", { altKey: true }))).toBe("settings.hotkey.altF4");
    expect(problem(press("F12"))).toBe("settings.hotkey.key");
    expect(problem(press("Space", { altKey: true }))).toBe("settings.hotkey.key");
    expect(problem(press("Numpad5", { ctrlKey: true }))).toBe("settings.hotkey.key");
    expect(problem(press("Tab", { altKey: true }))).toBe("settings.hotkey.key");
    expect(problem(press("KeyW", { altKey: true }))).toBe("settings.hotkey.duplicate");
    expect(problem(press("KeyE", { altKey: true, ctrlKey: true, key: "€" }))).toBe("settings.hotkey.altGr");
    expect(problem(press("Digit2", { altKey: true, ctrlKey: true, shiftKey: true }))).toBe("settings.hotkey.altGr");
    expect(problem(press("F9", { altKey: true, ctrlKey: true }))).toBeNull();
  });

  it("names a letter by the layout, like RegisterHotKey does", () => {
    // QWERTZ: the key where US has Y types Z.
    expect(record(press("KeyY", { altKey: true, key: "z" }), "Alt+W")).toMatchObject({ accelerator: "Alt+Z" });
    // Russian: Cyrillic letters, so the US position (as Windows maps it).
    expect(record(press("KeyQ", { altKey: true, key: "й" }), "Alt+W")).toMatchObject({ accelerator: "Alt+Q" });
  });
});
