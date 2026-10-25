import { describe, expect, it } from "vitest";

import { forceExit, keyDown, keyUp, openGate, requestExit } from "./exitGate";

describe("exit gate", () => {
  it("exits at once when nothing is held and no key-up is awaited", () => {
    const step = requestExit(openGate(), "esc", false);
    expect(step.commit).toBe("esc");
    expect(step.gate.pending).toBeNull();
  });

  it("waits for Esc to be released before handing focus back", () => {
    const held = keyDown(openGate(), "Escape");
    const waiting = requestExit(held, "esc", false);
    expect(waiting.commit).toBeNull();
    expect(keyUp(waiting.gate, "Escape").commit).toBe("esc");
  });

  it("waits for the hotkey's key-up even though its key-down never arrived", () => {
    const waiting = requestExit(openGate(), "hotkey", true);
    expect(waiting.commit).toBeNull();
    expect(keyUp(waiting.gate, "KeyQ").commit).toBe("hotkey");
  });

  it("waits until the last of several held keys is up", () => {
    let gate = keyDown(keyDown(openGate(), "AltLeft"), "KeyQ");
    const first = requestExit(gate, "hotkey", true);
    gate = keyUp(first.gate, "KeyQ").gate;
    expect(gate.pending).not.toBeNull();
    expect(keyUp(gate, "AltLeft").commit).toBe("hotkey");
  });

  it("ignores a second request while one is pending", () => {
    const waiting = requestExit(keyDown(openGate(), "Escape"), "esc", false);
    const again = requestExit(waiting.gate, "hotkey", true);
    expect(again.gate).toBe(waiting.gate);
    expect(keyUp(again.gate, "Escape").commit).toBe("esc");
  });

  it("the timeout forces the exit and forgets held keys", () => {
    const waiting = requestExit(keyDown(openGate(), "ShiftLeft"), "esc", false);
    const forced = forceExit(waiting.gate);
    expect(forced.commit).toBe("esc");
    expect(forced.gate.held.size).toBe(0);
    expect(forceExit(openGate()).commit).toBeNull();
  });

  it("does not count a repeated key-down twice", () => {
    const gate = keyDown(keyDown(openGate(), "KeyA"), "KeyA");
    expect(gate.held.size).toBe(1);
  });
});
