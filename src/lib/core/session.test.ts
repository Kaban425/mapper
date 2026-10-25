import { describe, expect, it } from "vitest";

import type { Carried } from "./carry";
import { DH_LIMIT_M, MAX_POINTS } from "./constants";
import { currentResult, idleSession, reduce, stageNumber, type Action, type Effect, type Session } from "./session";
import type { GridScale, Preset } from "./types";

const scale: GridScale = { cellMeters: 100, cellPx: 100, origin: { x: 0, y: 0 } };
const viewport = { w: 2048, h: 1151.2, scale: 1.25 };
const speeds = { sprintMps: 6.3, daciaKmh: 100, daciaVerified: false };
const MONITOR = "2560x1440@125";

function activation(
  preset: Preset,
  scales: Record<Preset, GridScale | null>,
  start: "measure" | "calibrate" = "measure",
  carried: Carried | null = null,
  monitor = MONITOR,
): Action {
  return { type: "activate", seq: 7, preset, monitor, start, viewport, speeds, scales, focused: true, carried };
}

function run(start: Session, ...actions: Action[]): { session: Session; effects: Effect[] } {
  let session = start;
  const effects: Effect[] = [];
  for (const action of actions) {
    const step = reduce(session, action);
    session = step.session;
    effects.push(...step.effects);
  }
  return { session, effects };
}

const click = (x: number, y: number, button = 0): Action => ({ type: "pointerDown", button, point: { x, y } });
const key = (code: string): Action => ({ type: "key", code });
const wheel = (deltaY: number, extra: { shift?: boolean; ctrl?: boolean } = {}): Action => ({
  type: "wheel",
  deltaY,
  deltaX: 0,
  shift: extra.shift ?? false,
  ctrl: extra.ctrl ?? false,
});
const measuring = () => run(idleSession(), activation("near", { near: scale, far: null })).session;

describe("activation", () => {
  it("measures when the preset has a scale for this monitor", () => {
    const s = measuring();
    expect(s).toMatchObject({ active: true, seq: 7, mode: "measure", preset: "near", draft: null });
  });

  it("opens the setup when the preset has no scale, and says so", () => {
    const { session } = run(idleSession(), activation("far", { near: scale, far: null }));
    expect(session.mode).toBe("calibrate");
    expect(session.draft).toMatchObject({ stage: "step", missing: true });
  });

  it("opens the setup when Rust asks for it (armed from the main window)", () => {
    const { session } = run(idleSession(), activation("near", { near: scale, far: null }, "calibrate"));
    expect(session.draft).toMatchObject({ stage: "step", missing: false });
  });

  it("forgets the previous session", () => {
    const used = run(measuring(), click(1, 1), click(2, 2), wheel(-1)).session;
    const again = run(used, activation("near", { near: scale, far: null })).session;
    expect(again.points).toEqual([]);
    expect(again.dhM).toBe(0);
  });
});

describe("scale setup", () => {
  const calibrating = () => run(idleSession(), activation("near", { near: null, far: null })).session;

  it("walks the four steps and saves the matched grid", () => {
    let s = calibrating();
    expect(stageNumber(s.draft!.stage)).toBe(1);
    ({ session: s } = run(s, key("Digit2")));
    expect(s.draft).toMatchObject({ stage: "origin", cellMeters: 100 });
    ({ session: s } = run(s, click(200, 300)));
    expect(s.draft).toMatchObject({ stage: "neighbour", origin: { x: 200, y: 300 } });
    ({ session: s } = run(s, click(372, 302)));
    expect(s.draft).toMatchObject({ stage: "fine", cellPx: 172 });
    ({ session: s } = run(s, wheel(100)));
    expect(s.draft!.cellPx).toBeCloseTo(172 / 1.02);
    const done = run(s, key("Enter"));
    expect(done.session).toMatchObject({ mode: "measure", draft: null, verifyPending: true });
    expect(done.session.note).toBeNull(); // "saved" only once Rust confirms
    expect(done.effects).toEqual([{ type: "save", preset: "near", scale: done.session.scales.near }]);
    expect(done.session.scales.near).toMatchObject({ cellMeters: 100, origin: { x: 200, y: 300 } });
    expect(run(done.session, { type: "saveDone", failure: null }).session.note?.kind).toBe("saved");
  });

  it("says when Rust refused the scale, and why", () => {
    const refused = run(measuring(), { type: "saveDone", failure: "readOnly" }).session;
    expect(refused.note).toMatchObject({ kind: "saveFailed", failure: "readOnly" });
    expect(refused.scales.near).toEqual(scale); // still usable until the overlay closes
    expect(run(idleSession(), { type: "saveDone", failure: "io" }).session.note).toBeNull();
  });

  it("keeps the 3-cell check through the first two-point measurement, then drops it", () => {
    let s = run(calibrating(), key("Digit2"), click(100, 100), click(200, 100), key("Enter")).session;
    s = run(s, click(100, 100), click(400, 100)).session;
    expect(s.verifyPending).toBe(true);
    expect(run(s, click(400, 400)).session.verifyPending).toBe(false);
    expect(run(s, key("Backspace")).session.verifyPending).toBe(false);
    expect(run(s, wheel(-1)).session.verifyPending).toBe(true);
  });

  it("ignores map clicks on step 1 and a neighbour closer than the minimum cell", () => {
    let s = run(calibrating(), click(10, 10)).session;
    expect(s.draft!.stage).toBe("step");
    s = run(s, key("Digit1"), click(100, 100), click(103, 101)).session;
    expect(s.draft!.stage).toBe("neighbour");
  });

  it("steps back with the right button or Backspace", () => {
    let s = run(calibrating(), key("Numpad1"), click(100, 100), click(300, 100)).session;
    expect(s.draft!.stage).toBe("fine");
    s = run(s, click(0, 0, 2)).session;
    expect(s.draft).toMatchObject({ stage: "neighbour", cellPx: null });
    s = run(s, key("Backspace")).session;
    expect(s.draft).toMatchObject({ stage: "origin", origin: null });
    s = run(s, key("Backspace"), key("Backspace")).session;
    expect(s.draft!.stage).toBe("step");
  });

  it("moves the origin with a click on step 4 and keeps the cells when 1/2 is pressed late", () => {
    const s = run(calibrating(), key("Digit2"), click(100, 100), click(300, 100), click(150, 160), key("Digit1")).session;
    expect(s.draft).toMatchObject({ stage: "fine", origin: { x: 150, y: 160 }, cellPx: 200, cellMeters: 1000 });
  });

  it("Enter before step 4 saves nothing", () => {
    expect(run(calibrating(), key("Digit2"), key("Enter")).effects).toEqual([]);
  });

  it("Esc without any scale leaves the overlay; with a scale it returns to measuring", () => {
    expect(run(calibrating(), key("Escape")).effects).toEqual([{ type: "exit", reason: "noCalibration", needKeyUp: false }]);
    const recalibrating = run(measuring(), key("KeyC")).session;
    expect(recalibrating.mode).toBe("calibrate");
    const back = run(recalibrating, key("Escape"));
    expect(back.session.mode).toBe("measure");
    expect(back.effects).toEqual([]);
  });

  it("the wheel only resizes on step 4", () => {
    const s = run(calibrating(), key("Digit2"), wheel(-1)).session;
    expect(s.draft!.cellPx).toBeNull();
  });
});

describe("measuring", () => {
  it("adds points with the left button and removes them with the right one, Backspace and Delete", () => {
    let s = run(measuring(), click(0, 0), click(300, 400), click(300, 1000)).session;
    expect(s.points).toHaveLength(3);
    s = run(s, click(5, 5, 2)).session;
    expect(s.points).toHaveLength(2);
    s = run(s, key("Backspace")).session;
    expect(s.points).toHaveLength(1);
    s = run(s, click(1, 1), key("Delete")).session;
    expect(s.points).toEqual([]);
  });

  it("stops at the maximum number of points", () => {
    const clicks = Array.from({ length: MAX_POINTS + 5 }, (_, i) => click(i, i));
    expect(run(measuring(), ...clicks).session.points).toHaveLength(MAX_POINTS);
  });

  it("the wheel sets the target height: ±1 m, Shift ±10 m, within the limit", () => {
    let s = run(measuring(), wheel(-100), wheel(-100), wheel(100, { shift: true })).session;
    expect(s.dhM).toBe(-8);
    s = run(s, ...Array.from({ length: 120 }, () => wheel(-1, { shift: true }))).session;
    expect(s.dhM).toBe(DH_LIMIT_M);
  });

  it("Ctrl+wheel and the middle button adjust the scale and save it later", () => {
    let s = run(measuring(), wheel(-1, { ctrl: true })).session;
    expect(s.scales.near!.cellPx).toBeCloseTo(102);
    expect(s.dirty.near).toBe(true);
    expect(s.note?.kind).toBe("nudged");
    s = run(s, key("KeyT"), click(40, 50, 1)).session;
    // T does nothing any more (author's choice: G alone shows and hides the grid).
    expect(s.scales.near).toMatchObject({ cellMeters: 100, origin: { x: 40, y: 50 } });
    const flushed = run(s, { type: "flush" });
    expect(flushed.effects).toEqual([{ type: "save", preset: "near", scale: s.scales.near }]);
    expect(run(flushed.session, { type: "flush" }).effects).toEqual([]);
  });

  it("G toggles the grid and H the key list", () => {
    const s = run(measuring(), key("KeyG"), key("KeyH")).session;
    expect(s.showGrid).toBe(false);
    expect(s.showKeys).toBe(true);
  });

  it("Esc asks to leave", () => {
    expect(run(measuring(), key("Escape")).effects).toEqual([{ type: "exit", reason: "esc", needKeyUp: false }]);
  });

  it("computes the result from two points on", () => {
    const one = run(measuring(), click(0, 0)).session;
    expect(currentResult(one)).toBeNull();
    const two = run(one, click(300, 400)).session;
    expect(currentResult(two)).toMatchObject({ preset: "near", totalM: 500, segmentsM: [500] });
    expect(currentResult(two)?.mortar.status).toBe("ok");
    const three = run(two, click(300, 1000)).session;
    expect(currentResult(three)?.mortar.status).toBe("notApplicable");
  });
});

describe("focus", () => {
  it("swallows the click that activates the window when focus was not taken", () => {
    let s = run(measuring(), { type: "activated", ok: false }).session;
    expect(s.focusMissed).toBe(true);
    s = run(s, { type: "focus", focused: true }, click(10, 10)).session;
    expect(s.focusMissed).toBe(false);
    expect(s.points).toEqual([]);
    expect(run(s, click(20, 20)).session.points).toHaveLength(1);
  });

  it("ignores clicks while the window is not focused", () => {
    const s = run(measuring(), { type: "focus", focused: false }, click(10, 10)).session;
    expect(s.points).toEqual([]);
  });
});

describe("changing the zoom", () => {
  const far: GridScale = { cellMeters: 1000, cellPx: 100, origin: { x: 0, y: 0 } }; // 10 m per px
  const both = { near: scale, far };

  it("the other hotkey parks the route and leaves once the keys are up", () => {
    const s0 = run(idleSession(), activation("near", both), click(0, 0), click(300, 400), wheel(-1)).session;
    const step = run(s0, { type: "preset", preset: "far" });
    expect(step.effects).toEqual([
      { type: "park", carried: { preset: "near", monitor: MONITOR, points: s0.points, dhM: 1, metersPerPx: 1 } },
      { type: "exit", reason: "switchZoom", needKeyUp: true },
    ]);
    expect(step.session.leaving).toBe(true);
    // A parked route is not a result.
    expect(run(step.session, { type: "end" }).effects).toEqual([]);
  });

  it("with nothing measured it simply leaves", () => {
    expect(run(measuring(), { type: "preset", preset: "far" }).effects).toEqual([
      { type: "park", carried: null },
      { type: "exit", reason: "hotkey", needKeyUp: true },
    ]);
  });

  it("saves the old zoom's pending scale change before leaving", () => {
    const step = run(measuring(), wheel(-1, { ctrl: true }), { type: "preset", preset: "far" });
    expect(step.effects.map((e) => e.type)).toEqual(["save", "park", "exit"]);
  });

  it("the other zoom places the route at the anchor click, keeping its length and height", () => {
    const points = [{ x: 0, y: 0 }, { x: 300, y: 400 }];
    const carried: Carried = { preset: "near", monitor: MONITOR, points, dhM: 12, metersPerPx: 1 };
    const s0 = run(idleSession(), activation("far", both, "measure", carried)).session;
    expect(s0.carried).toEqual(carried);
    expect(s0.points).toEqual([]);
    const s = run(s0, wheel(-1), click(500, 500)).session;
    expect(s.points).toEqual([{ x: 500, y: 500 }, { x: 530, y: 540 }]);
    expect(s.dhM).toBe(12);
    expect(s.note?.kind).toBe("carried");
    expect(currentResult(s)?.totalM).toBeCloseTo(500);
  });

  it("the same zoom gets its points back where they were", () => {
    const carried: Carried = { preset: "near", monitor: MONITOR, points: [{ x: 1, y: 2 }], dhM: 3, metersPerPx: 1 };
    const s = run(idleSession(), activation("near", both, "measure", carried)).session;
    expect(s).toMatchObject({ points: [{ x: 1, y: 2 }], dhM: 3, carried: null });
  });

  it("the same zoom on another monitor asks for the anchor click instead", () => {
    const carried: Carried = { preset: "near", monitor: MONITOR, points: [{ x: 0, y: 0 }, { x: 300, y: 0 }], dhM: 3, metersPerPx: 2 };
    const s0 = run(idleSession(), activation("near", both, "measure", carried, "1920x1080@100")).session;
    expect(s0).toMatchObject({ points: [], carried });
    const s = run(s0, click(10, 10)).session;
    expect(s.points).toEqual([{ x: 10, y: 10 }, { x: 610, y: 10 }]); // 2 m/px then, 1 m/px now
  });

  it("the right button or Delete drops a carried route", () => {
    const carried: Carried = { preset: "near", monitor: MONITOR, points: [{ x: 1, y: 2 }], dhM: 3, metersPerPx: 1 };
    expect(run(idleSession(), activation("far", both, "measure", carried), click(5, 5, 2)).session.carried).toBeNull();
    expect(run(idleSession(), activation("far", both, "measure", carried), key("Delete")).session.carried).toBeNull();
  });

  it("a carried route waits through the setup of a zoom without a scale", () => {
    const carried: Carried = { preset: "near", monitor: MONITOR, points: [{ x: 0, y: 0 }], dhM: 0, metersPerPx: 1 };
    let s = run(idleSession(), activation("far", { near: scale, far: null }, "measure", carried)).session;
    expect(s.mode).toBe("calibrate");
    s = run(s, key("Digit1"), click(100, 100), click(200, 100), key("Enter")).session;
    expect(s.carried).toEqual(carried);
    expect(run(s, click(300, 300)).session.points).toEqual([{ x: 300, y: 300 }]);
  });

  it("a setup in progress is left without parking anything", () => {
    const s0 = run(idleSession(), activation("near", both), key("KeyC"), key("Digit2")).session;
    expect(run(s0, { type: "preset", preset: "far" }).effects).toContainEqual({ type: "park", carried: null });
  });
});

describe("end of the session", () => {
  it("submits the result, saves pending scales and forgets everything", () => {
    const s = run(measuring(), click(0, 0), click(300, 400), wheel(-1, { ctrl: true })).session;
    const end = run(s, { type: "end" });
    expect(end.effects.map((e) => e.type)).toEqual(["save", "submit"]);
    expect(end.session.active).toBe(false);
    expect(end.session.points).toEqual([]);
  });

  it("submits nothing with fewer than two points", () => {
    expect(run(measuring(), click(0, 0), { type: "end" }).effects).toEqual([]);
  });

  it("notes are cleared only by their own timer", () => {
    const s = run(measuring(), wheel(-1, { ctrl: true })).session;
    const id = s.note!.id;
    expect(run(s, { type: "clearNote", id: id - 1 }).session.note).not.toBeNull();
    expect(run(s, { type: "clearNote", id }).session.note).toBeNull();
  });

  it("does nothing while inactive", () => {
    const idle = idleSession();
    expect(run(idle, click(1, 1), key("Escape"), { type: "end" }, { type: "preset", preset: "far" }).session).toEqual(idle);
  });
});
