// One overlay session as a pure reducer: measuring, and the four-step scale setup
// (which cells → an intersection → its neighbour → wheel until the far lines match).
// The Svelte shell feeds it actions and carries out the returned effects.

import { DH_LIMIT_M, DH_STEP_FAST_M, DH_STEP_M, MAX_POINTS, MIN_CELL_PX } from "./constants";
import { cellFromClicks, clamp, maxCellPx, metersPerPx, nudgeCell, wheelFactor } from "./calibration";
import { carryRoute, reproject, type Carried } from "./carry";
import type { ExitReason } from "./exitGate";
import { buildResult } from "./result";
import type { CellMeters, GridScale, MeasurementResult, Point, Preset, Speeds, Viewport } from "./types";

export type Mode = "measure" | "calibrate";
export type Stage = "step" | "origin" | "neighbour" | "fine";
export const STAGES: readonly Stage[] = ["step", "origin", "neighbour", "fine"];
/** "Step N of 4". */
export const stageNumber = (stage: Stage): number => STAGES.indexOf(stage) + 1;

export interface Draft {
  readonly stage: Stage;
  readonly cellMeters: CellMeters | null;
  readonly cellPx: number | null;
  readonly origin: Point | null;
  /** No scale existed for this preset on this monitor when the setup began. */
  readonly missing: boolean;
}

export type NoteKind = "carried" | "nudged" | "saved" | "saveFailed";
/** Why Rust refused a scale: a file from a newer Mapper, a disk error, anything else. */
export type SaveFailure = "readOnly" | "io" | "other";
export interface Note {
  readonly kind: NoteKind;
  readonly id: number;
  readonly failure?: SaveFailure;
}

type PerPreset<T> = Readonly<Record<Preset, T>>;

export interface Session {
  readonly active: boolean;
  readonly seq: number;
  readonly preset: Preset;
  /** Monitor key of this session, e.g. `2560x1440@125`. */
  readonly monitor: string;
  readonly viewport: Viewport;
  readonly speeds: Speeds;
  readonly scales: PerPreset<GridScale | null>;
  readonly mode: Mode;
  readonly draft: Draft | null;
  readonly points: readonly Point[];
  readonly dhM: number;
  readonly showGrid: boolean;
  readonly showKeys: boolean;
  readonly focused: boolean;
  /** Windows did not hand focus over: "click to start", and that click is not a point. */
  readonly focusMissed: boolean;
  readonly swallowNextClick: boolean;
  readonly cursor: Point | null;
  readonly note: Note | null;
  readonly noteSeq: number;
  /** A scale was just set up: show the "3 cells" check until the first two-point measurement is done. */
  readonly verifyPending: boolean;
  /** Scale changed while measuring (Ctrl+wheel, middle click), not saved yet. */
  readonly dirty: PerPreset<boolean>;
  /** A route from the other zoom, waiting for the click that shows where its first point is now. */
  readonly carried: Carried | null;
  /** Closing for a zoom change: the route is parked, not handed over as a result. */
  readonly leaving: boolean;
}

export type Effect =
  | { readonly type: "save"; readonly preset: Preset; readonly scale: GridScale }
  | { readonly type: "exit"; readonly reason: ExitReason; readonly needKeyUp: boolean }
  | { readonly type: "submit"; readonly result: MeasurementResult }
  /** Keep this route for the next activation (or forget a parked one: null). */
  | { readonly type: "park"; readonly carried: Carried | null };

export interface Activation {
  readonly seq: number;
  readonly preset: Preset;
  readonly monitor: string;
  readonly start: Mode;
  readonly viewport: Viewport;
  readonly speeds: Speeds;
  readonly scales: PerPreset<GridScale | null>;
  readonly focused: boolean;
  /** A route parked by the other zoom's hotkey, if it is still fresh. */
  readonly carried: Carried | null;
}

export type Action =
  | ({ readonly type: "activate" } & Activation)
  | { readonly type: "activated"; readonly ok: boolean }
  | { readonly type: "focus"; readonly focused: boolean }
  | { readonly type: "preset"; readonly preset: Preset }
  | { readonly type: "pointerDown"; readonly button: number; readonly point: Point }
  | { readonly type: "pointerMove"; readonly point: Point }
  | { readonly type: "wheel"; readonly deltaY: number; readonly deltaX: number; readonly shift: boolean; readonly ctrl: boolean }
  | { readonly type: "key"; readonly code: string }
  | { readonly type: "chooseCells"; readonly cellMeters: CellMeters }
  | { readonly type: "clearNote"; readonly id: number }
  | { readonly type: "flush" }
  /** Rust answered a save of this session: stored, or refused and why. */
  | { readonly type: "saveDone"; readonly failure: SaveFailure | null }
  | { readonly type: "end" };

export interface Step {
  readonly session: Session;
  readonly effects: readonly Effect[];
}

const NO_SCALES: PerPreset<null> = { near: null, far: null };
const CLEAN: PerPreset<boolean> = { near: false, far: false };

export function idleSession(): Session {
  return {
    active: false,
    seq: 0,
    preset: "near",
    monitor: "",
    viewport: { w: 0, h: 0, scale: 1 },
    speeds: { sprintMps: 6.3, daciaKmh: 100, daciaVerified: false },
    scales: NO_SCALES,
    mode: "measure",
    draft: null,
    points: [],
    dhM: 0,
    showGrid: true,
    showKeys: false,
    focused: false,
    focusMissed: false,
    swallowNextClick: false,
    cursor: null,
    note: null,
    noteSeq: 0,
    verifyPending: false,
    dirty: CLEAN,
    carried: null,
    leaving: false,
  };
}

const same = (session: Session): Step => ({ session, effects: [] });
const scaleOf = (s: Session): GridScale | null => s.scales[s.preset];

function withNote(s: Session, kind: NoteKind, failure?: SaveFailure): Session {
  const id = s.noteSeq + 1;
  return { ...s, note: failure ? { kind, id, failure } : { kind, id }, noteSeq: id };
}

function startCalibration(s: Session): Session {
  const draft: Draft = { stage: "step", cellMeters: null, cellPx: null, origin: null, missing: scaleOf(s) === null };
  return { ...s, mode: "calibrate", draft };
}

function withScale(s: Session, scale: GridScale, dirty: boolean): Session {
  return {
    ...s,
    scales: { ...s.scales, [s.preset]: scale },
    dirty: { ...s.dirty, [s.preset]: dirty },
  };
}

function saveDirty(s: Session, presets: readonly Preset[]): Step {
  const effects: Effect[] = [];
  let dirty = s.dirty;
  for (const preset of presets) {
    const scale = s.scales[preset];
    if (dirty[preset] && scale) {
      effects.push({ type: "save", preset, scale });
      dirty = { ...dirty, [preset]: false };
    }
  }
  return { session: { ...s, dirty }, effects };
}

function activate(a: Activation, noteSeq: number): Step {
  const session: Session = {
    ...idleSession(),
    active: true,
    seq: a.seq,
    preset: a.preset,
    monitor: a.monitor,
    viewport: a.viewport,
    speeds: a.speeds,
    scales: a.scales,
    focused: a.focused,
    noteSeq,
    ...withCarried(a.carried, a.preset, a.monitor),
  };
  const calibrate = a.start === "calibrate" || session.scales[session.preset] === null;
  return same(calibrate ? startCalibration(session) : session);
}

/**
 * Same zoom on the same monitor: the points go back where they were. Another zoom or another
 * monitor (other metres per pixel): wait for the anchor click.
 */
function withCarried(
  carried: Carried | null,
  preset: Preset,
  monitor: string,
): Pick<Session, "points" | "dhM" | "carried"> {
  if (!carried) return { points: [], dhM: 0, carried: null };
  if (carried.preset === preset && carried.monitor === monitor) {
    return { points: carried.points, dhM: carried.dhM, carried: null };
  }
  return { points: [], dhM: 0, carried };
}

/**
 * The other zoom's hotkey while open: the player is about to change the map's zoom. The
 * overlay closes (once the keys are up) and parks the route for the other hotkey.
 */
function switchZoom(s: Session, preset: Preset): Step {
  if (preset === s.preset || s.leaving) return same(s);
  const saved = saveDirty(s, [s.preset]);
  const scale = scaleOf(s);
  const carry = () => (scale && s.mode === "measure" ? carryRoute(s.preset, s.monitor, s.points, s.dhM, scale) : null);
  const route = s.carried ?? carry();
  const effects: Effect[] = [
    ...saved.effects,
    { type: "park", carried: route },
    { type: "exit", reason: route ? "switchZoom" : "hotkey", needKeyUp: true },
  ];
  return { session: { ...saved.session, leaving: true }, effects };
}

/** The anchor click: the carried route is laid out from where its first point is now. */
function placeCarried(s: Session, carried: Carried, scale: GridScale, button: number, point: Point): Session {
  if (button === 2) return { ...s, carried: null };
  if (button !== 0) return s;
  const points = reproject(carried, point, metersPerPx(scale)).slice(0, MAX_POINTS);
  return withNote({ ...s, points, dhM: carried.dhM, carried: null }, "carried");
}

function stepBack(draft: Draft): Draft {
  switch (draft.stage) {
    case "fine":
      return { ...draft, stage: "neighbour", cellPx: null };
    case "neighbour":
      return { ...draft, stage: "origin", origin: null };
    case "origin":
      return { ...draft, stage: "step" };
    case "step":
      return draft;
  }
}

function chooseCells(s: Session, cellMeters: CellMeters): Session {
  if (s.mode !== "calibrate" || !s.draft) return s;
  const stage = s.draft.stage === "step" ? "origin" : s.draft.stage;
  return { ...s, draft: { ...s.draft, cellMeters, stage } };
}

function calibrationPointer(s: Session, draft: Draft, button: number, point: Point): Session {
  if (button === 2) return { ...s, draft: stepBack(draft) };
  if (button !== 0) return s;
  switch (draft.stage) {
    case "step":
      return s; // the panel's buttons choose the cells
    case "origin":
      return { ...s, draft: { ...draft, origin: point, stage: "neighbour" } };
    case "neighbour": {
      const cell = draft.origin ? cellFromClicks(draft.origin, point) : 0;
      if (cell < MIN_CELL_PX) return s;
      return { ...s, draft: { ...draft, cellPx: Math.min(cell, maxCellPx(s.viewport)), stage: "fine" } };
    }
    case "fine":
      return { ...s, draft: { ...draft, origin: point } };
  }
}

function measurePointer(s: Session, button: number, point: Point): Session {
  const scale = scaleOf(s);
  if (!scale) return s;
  if (s.carried) return placeCarried(s, s.carried, scale, button, point);
  if (button === 0) return s.points.length < MAX_POINTS ? { ...s, points: [...s.points, point] } : s;
  if (button === 2) return { ...s, points: s.points.slice(0, -1) };
  if (button === 1) return withScale(s, { ...scale, origin: point }, true);
  return s;
}

function pointerDown(s: Session, button: number, point: Point): Step {
  if (!s.active) return same(s);
  // The click that activates the window (or lands while it is not focused) is not a point.
  if (s.swallowNextClick || !s.focused) return same({ ...s, swallowNextClick: false });
  if (s.mode === "calibrate" && s.draft) return same(calibrationPointer(s, s.draft, button, point));
  return same(measurePointer(s, button, point));
}

function wheel(s: Session, action: Extract<Action, { type: "wheel" }>): Step {
  const factor = wheelFactor(action.deltaY, action.deltaX, action.shift);
  if (!s.active || factor === 1) return same(s);
  if (s.mode === "calibrate") {
    const draft = s.draft;
    if (draft?.stage !== "fine" || draft.cellPx === null) return same(s);
    return same({ ...s, draft: { ...draft, cellPx: nudgeCell(draft.cellPx, factor, s.viewport) } });
  }
  const scale = scaleOf(s);
  if (action.ctrl && scale) {
    const nudged = withScale(s, { ...scale, cellPx: nudgeCell(scale.cellPx, factor, s.viewport) }, true);
    return same(withNote(nudged, "nudged"));
  }
  // The carried route brings its own height; the anchor click restores it.
  if (s.carried) return same(s);
  const step = action.shift ? DH_STEP_FAST_M : DH_STEP_M;
  const dhM = clamp(s.dhM + (factor > 1 ? step : -step), -DH_LIMIT_M, DH_LIMIT_M);
  return same({ ...s, dhM });
}

function commitCalibration(s: Session, draft: Draft): Step {
  const { cellMeters, cellPx, origin } = draft;
  if (draft.stage !== "fine" || cellMeters === null || cellPx === null || origin === null) return same(s);
  const scale: GridScale = { cellMeters, cellPx, origin };
  // "Saved" is said once Rust confirms it (saveDone), not before.
  const saved = withScale({ ...s, mode: "measure", draft: null, verifyPending: true }, scale, false);
  return { session: saved, effects: [{ type: "save", preset: s.preset, scale }] };
}

function calibrationKey(s: Session, draft: Draft, code: string): Step {
  switch (code) {
    case "Escape":
      // Without any scale there is nothing to measure with: leave the overlay instead.
      return scaleOf(s)
        ? same({ ...s, mode: "measure", draft: null })
        : { session: s, effects: [{ type: "exit", reason: "noCalibration", needKeyUp: false }] };
    case "Enter":
    case "NumpadEnter":
      return commitCalibration(s, draft);
    case "Digit1":
    case "Numpad1":
      return same(chooseCells(s, 1000));
    case "Digit2":
    case "Numpad2":
      return same(chooseCells(s, 100));
    case "Backspace":
      return same({ ...s, draft: stepBack(draft) });
    case "KeyH":
      return same({ ...s, showKeys: !s.showKeys });
    default:
      return same(s);
  }
}

function measureKey(s: Session, code: string): Step {
  switch (code) {
    case "Escape":
      return { session: s, effects: [{ type: "exit", reason: "esc", needKeyUp: false }] };
    case "KeyC":
      return same(startCalibration(s));
    case "KeyG":
      return same({ ...s, showGrid: !s.showGrid });
    case "Backspace":
      return same(s.carried ? { ...s, carried: null } : { ...s, points: s.points.slice(0, -1) });
    case "Delete":
      return same({ ...s, points: [], carried: null });
    case "KeyH":
      return same({ ...s, showKeys: !s.showKeys });
    default:
      return same(s);
  }
}

/** The current numbers, or null until there are two points and a scale. */
export function currentResult(s: Session): MeasurementResult | null {
  const scale = scaleOf(s);
  if (!scale || s.mode !== "measure") return null;
  return buildResult({ preset: s.preset, points: s.points, scale, viewport: s.viewport, dhM: s.dhM, speeds: s.speeds });
}

/**
 * The overlay is about to blank: save pending scales, hand over the result (not when leaving for
 * a zoom change — that route is parked), forget everything.
 */
function end(s: Session): Step {
  if (!s.active) return same(s);
  const saved = saveDirty(s, ["near", "far"]);
  const result = s.leaving ? null : currentResult(s);
  const effects: Effect[] = result ? [...saved.effects, { type: "submit", result }] : [...saved.effects];
  return { session: { ...idleSession(), noteSeq: s.noteSeq }, effects };
}

/** The check line goes once the player moves on from the first two-point measurement. */
function settleVerify(before: Session, step: Step): Step {
  const s = step.session;
  const movedOn = s.verifyPending && before.points.length === 2 && s.points !== before.points;
  return movedOn ? { ...step, session: { ...s, verifyPending: false } } : step;
}

function saveDone(s: Session, failure: SaveFailure | null): Session {
  if (!s.active) return s;
  return failure ? withNote(s, "saveFailed", failure) : withNote(s, "saved");
}

export function reduce(s: Session, action: Action): Step {
  switch (action.type) {
    case "activate":
      return activate(action, s.noteSeq);
    case "activated":
      // Same view as Rust's phase machine: after four failed attempts the window is not focused.
      return same(
        action.ok
          ? { ...s, focused: true, focusMissed: false }
          : { ...s, focused: false, focusMissed: true, swallowNextClick: true },
      );
    case "focus":
      return same(action.focused ? { ...s, focused: true, focusMissed: false } : { ...s, focused: false });
    case "preset":
      return s.active ? switchZoom(s, action.preset) : same(s);
    case "pointerDown":
      return settleVerify(s, pointerDown(s, action.button, action.point));
    case "pointerMove":
      return same(s.active ? { ...s, cursor: action.point } : s);
    case "wheel":
      return wheel(s, action);
    case "key":
      if (!s.active) return same(s);
      return settleVerify(
        s,
        s.mode === "calibrate" && s.draft ? calibrationKey(s, s.draft, action.code) : measureKey(s, action.code),
      );
    case "chooseCells":
      return same(chooseCells(s, action.cellMeters));
    case "clearNote":
      return same(s.note?.id === action.id ? { ...s, note: null } : s);
    case "flush":
      return saveDirty(s, ["near", "far"]);
    case "saveDone":
      return same(saveDone(s, action.failure));
    case "end":
      return end(s);
  }
}
