// The overlay controller: what the reducer cannot cover because time or Rust is involved —
// save answers, the save pause, the parked route's lifetime, and the blank hand-over.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CARRY_MS } from "../../lib/core/carry";
import { SAVE_DEBOUNCE_MS } from "../../lib/core/constants";
import type { MockApi } from "../../lib/ipc/mock";
import type { OverlayController } from "./controller.svelte";

let controller: OverlayController;
let mock: MockApi;

const scale = { cellMeters: 100, cellPx: 100, origin: { x: 0, y: 0 }, w: 1600, h: 900, scale: 1, createdAt: "2026-10-22T00:00:00Z" };

function activating(seq: number, preset: "near" | "far" = "near") {
  return {
    seq,
    preset,
    start: "measure",
    viewport: { w: 1600, h: 900, scale: 1 },
    monitor: { key: "1600x900@100", label: "1600×900 · 100 %" },
    calibrations: { near: scale, far: { ...scale, cellMeters: 1000 } },
    settings: {
      language: "ru",
      panelOpacity: 0.65,
      speeds: { sprintMps: 6.3, daciaKmh: 100, daciaVerified: false },
      hotkeys: { near: "Alt+Q", far: "Alt+W" },
    },
  };
}

const commands = () => mock.calls.map((c) => c.command).filter((c) => c !== "log_line");
const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(async () => {
  vi.useFakeTimers();
  vi.stubGlobal("document", { hasFocus: () => true });
  vi.stubGlobal("requestAnimationFrame", (done: () => void) => setTimeout(done, 16));
  // A fresh mock transport (its listeners are module state) and controller for every test.
  vi.resetModules();
  const { OverlayController: Controller } = await import("./controller.svelte");
  mock = (globalThis as unknown as { __MAPPER_MOCK__: MockApi }).__MAPPER_MOCK__;
  controller = new Controller();
  await controller.connect();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function start(seq = 1, preset: "near" | "far" = "near"): void {
  mock.emit("overlay-activating", activating(seq, preset));
  mock.emit("overlay-activated", { seq, ok: true, attempts: 1, ms: 20 });
}

const click = (x: number, y: number) => controller.dispatch({ type: "pointerDown", button: 0, point: { x, y } });

describe("saving a scale", () => {
  it("says saved only after Rust confirms", async () => {
    start();
    controller.dispatch({ type: "wheel", deltaY: -1, deltaX: 0, shift: false, ctrl: true });
    expect(controller.session.note?.kind).toBe("nudged");
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    expect(commands()).toEqual(["save_calibration"]);
    expect(controller.session.note?.kind).toBe("saved");
  });

  it("keeps a refusal on screen with its reason", async () => {
    mock.failures.set("save_calibration", "read_only");
    start();
    controller.dispatch({ type: "wheel", deltaY: -1, deltaX: 0, shift: false, ctrl: true });
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    expect(controller.session.note).toMatchObject({ kind: "saveFailed", failure: "readOnly" });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(controller.session.note?.kind).toBe("saveFailed");
  });

  it("mouse moves do not postpone the save", async () => {
    start();
    controller.dispatch({ type: "wheel", deltaY: -1, deltaX: 0, shift: false, ctrl: true });
    for (let i = 0; i < 10; i += 1) {
      await vi.advanceTimersByTimeAsync(100);
      controller.dispatch({ type: "pointerMove", point: { x: i, y: i } });
    }
    expect(commands()).toEqual(["save_calibration"]);
  });

  it("an answer for a closed session changes nothing", async () => {
    start();
    controller.dispatch({ type: "wheel", deltaY: -1, deltaX: 0, shift: false, ctrl: true });
    mock.emit("overlay-blank-request", { seq: 1, reason: "exit" });
    await vi.advanceTimersByTimeAsync(100);
    expect(commands()).toEqual(["save_calibration", "overlay_blank"]);
    expect(controller.session.active).toBe(false);
    expect(controller.session.note).toBeNull();
  });
});

describe("a route parked for the other zoom", () => {
  async function park(): Promise<void> {
    start();
    click(100, 100);
    click(400, 100);
    mock.emit("overlay-preset", { seq: 1, preset: "far" });
    controller.onKeyUp({ code: "KeyW", preventDefault() {} } as KeyboardEvent);
    await flush();
    mock.emit("overlay-blank-request", { seq: 1, reason: "exit" });
    await vi.advanceTimersByTimeAsync(100);
  }

  it("waits for the anchor click on the other zoom", async () => {
    await park();
    expect(commands()).toEqual(["overlay_exit", "overlay_blank"]);
    expect(mock.calls[0]?.args).toEqual({ seq: 1, reason: "switchZoom" });
    start(2, "far");
    expect(controller.session.carried?.points).toHaveLength(2);
  });

  it("is gone after two minutes", async () => {
    await park();
    await vi.advanceTimersByTimeAsync(CARRY_MS + 1);
    start(2, "far");
    expect(controller.session.carried).toBeNull();
  });

  it("still tells Rust when its exit timeout came first", async () => {
    start();
    click(100, 100);
    mock.emit("overlay-preset", { seq: 1, preset: "far" });
    // No key-up yet: Rust gives up waiting and asks for the blank frame.
    mock.emit("overlay-blank-request", { seq: 1, reason: "exit" });
    await vi.advanceTimersByTimeAsync(100);
    expect(commands()).toEqual(["overlay_exit", "overlay_blank"]);
    expect(mock.calls[0]?.args).toEqual({ seq: 1, reason: "switchZoom" });
  });
});

describe("leaving", () => {
  it("hands over the result, then confirms the blank frame", async () => {
    start();
    click(100, 100);
    click(400, 100);
    mock.emit("overlay-blank-request", { seq: 1, reason: "exit" });
    await vi.advanceTimersByTimeAsync(100);
    expect(commands()).toEqual(["submit_result", "overlay_blank"]);
    expect(mock.calls.find((c) => c.command === "overlay_blank")?.args).toEqual({ seq: 1 });
  });
});
