// The overlay window's state: the core session reducer plus everything with time in it —
// the exit gate, note timers, delayed saves, the "click to start" countdown — and the link
// to Rust. Components only read it and call its handlers.

import { fitsViewport } from "../../lib/core/calibration";
import { CARRY_MS, type Carried } from "../../lib/core/carry";
import { CLICK_TO_START_S, EXIT_WAIT_MS, NOTE_MS, SAVE_DEBOUNCE_MS } from "../../lib/core/constants";
import { forceExit, keyDown, keyUp, openGate, requestExit, type ExitGate, type GateStep } from "../../lib/core/exitGate";
import { idleSession, reduce, type Action, type Effect, type SaveFailure, type Session } from "../../lib/core/session";
import type { GridScale, Language, Point, Preset, Viewport } from "../../lib/core/types";
import {
  describeError,
  logFailure,
  overlayBlank,
  overlayExit,
  saveCalibration,
  submitResult,
} from "../../lib/ipc/commands";
import { on } from "../../lib/ipc/events";
import type { BlankRequest, Calibration, ExitReason, OverlayActivating } from "../../lib/ipc/types";

const LABEL = "overlay";

const nextFrame = (): Promise<void> => new Promise((done) => requestAnimationFrame(() => done()));

function failureOf(error: unknown): SaveFailure {
  const code = describeError(error);
  if (code === "read_only") return "readOnly";
  return code === "io" ? "io" : "other";
}

function usable(saved: Calibration | null, viewport: Viewport): GridScale | null {
  if (!saved || !fitsViewport(saved, viewport)) return null;
  return { cellMeters: saved.cellMeters, cellPx: saved.cellPx, origin: saved.origin };
}

export class OverlayController {
  session = $state.raw<Session>(idleSession());
  lang = $state<Language>("ru");
  opacity = $state(0.65);
  hotkeys = $state.raw<Readonly<Record<Preset, string>>>({ near: "Alt+Q", far: "Alt+W" });
  monitorLabel = $state("");
  countdown = $state(CLICK_TO_START_S);

  private gate: ExitGate = openGate();
  private exitTimer: ReturnType<typeof setTimeout> | undefined;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  private countdownTimer: ReturnType<typeof setInterval> | undefined;
  private pendingMove: Point | null = null;
  /** A route parked by the other zoom's hotkey; it survives the hidden overlay for CARRY_MS. */
  private parked: { carried: Carried; at: number } | null = null;

  /** Subscribes to every overlay event; resolves once all listeners are in place. */
  async connect(): Promise<void> {
    const invalid = (event: string) => void logFailure("event", `${event}: unexpected payload`);
    await Promise.all([
      on("overlay-activating", LABEL, (p) => this.activate(p), invalid),
      on("overlay-activated", LABEL, (p) => p.seq === this.session.seq && this.dispatch({ type: "activated", ok: p.ok }), invalid),
      on("overlay-focused", LABEL, (p) => p.seq === this.session.seq && this.dispatch({ type: "focus", focused: true }), invalid),
      on("overlay-preset", LABEL, (p) => p.seq === this.session.seq && this.dispatch({ type: "preset", preset: p.preset }), invalid),
      on("overlay-exit-request", LABEL, (p) => p.seq === this.session.seq && this.exitWhenReleased("hotkey", true), invalid),
      on("overlay-blank-request", LABEL, (p) => void this.blank(p), invalid),
    ]);
  }

  private activate(p: OverlayActivating): void {
    this.reset();
    this.lang = p.settings.language;
    this.opacity = p.settings.panelOpacity;
    this.hotkeys = p.settings.hotkeys;
    this.monitorLabel = p.monitor.label;
    const viewport: Viewport = p.viewport;
    const scales = { near: usable(p.calibrations.near, viewport), far: usable(p.calibrations.far, viewport) };
    const parked = this.parked && Date.now() - this.parked.at < CARRY_MS ? this.parked.carried : null;
    this.parked = null;
    this.dispatch({
      type: "activate",
      seq: p.seq,
      preset: p.preset,
      monitor: p.monitor.key,
      start: p.start,
      viewport,
      speeds: p.settings.speeds,
      scales,
      focused: document.hasFocus(),
      carried: parked,
    });
  }

  dispatch(action: Action): void {
    const before = this.session;
    const step = reduce(before, action);
    this.session = step.session;
    for (const effect of step.effects) void this.carry(effect, before.seq);
    this.afterChange(before);
  }

  private carry(effect: Effect, seq: number): Promise<void> {
    switch (effect.type) {
      case "save":
        return saveCalibration(seq, effect.preset, effect.scale).then(
          () => this.saveDone(seq, null),
          (e: unknown) => {
            this.saveDone(seq, failureOf(e));
            return logFailure("save_calibration", e);
          },
        );
      case "submit":
        return submitResult(seq, effect.result).catch((e) => logFailure("submit_result", e));
      case "exit":
        this.exitWhenReleased(effect.reason, effect.needKeyUp);
        return Promise.resolve();
      case "park":
        this.parked = effect.carried ? { carried: effect.carried, at: Date.now() } : null;
        return Promise.resolve();
    }
  }

  /** Only the session that asked hears the answer; a closed overlay has nothing to show. */
  private saveDone(seq: number, failure: SaveFailure | null): void {
    if (this.session.active && this.session.seq === seq) this.dispatch({ type: "saveDone", failure });
  }

  /** Notes fade on their own (a failed save stays), scale tweaks are saved after a pause, the countdown ticks. */
  private afterChange(before: Session): void {
    const { note, dirty, focusMissed, active, scales } = this.session;
    if (note && note.id !== before.note?.id && note.kind !== "saveFailed") {
      const id = note.id;
      setTimeout(() => this.dispatch({ type: "clearNote", id }), NOTE_MS);
    }
    // Restarted by scale changes only, not by every mouse move in between.
    if ((dirty.near || dirty.far) && scales !== before.scales) {
      clearTimeout(this.saveTimer);
      this.saveTimer = setTimeout(() => this.dispatch({ type: "flush" }), SAVE_DEBOUNCE_MS);
    }
    const counting = active && focusMissed && !this.session.focused;
    if (counting && this.countdownTimer === undefined) {
      this.countdown = CLICK_TO_START_S;
      this.countdownTimer = setInterval(() => (this.countdown = Math.max(0, this.countdown - 1)), 1000);
    } else if (!counting && this.countdownTimer !== undefined) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = undefined;
    }
  }

  // ---------------------------------------------------------------- exit

  private exitWhenReleased(reason: ExitReason, needKeyUp: boolean): void {
    if (!this.session.active) return;
    const step = requestExit(this.gate, reason, needKeyUp);
    if (step.commit === null && this.exitTimer === undefined) {
      this.exitTimer = setTimeout(() => this.settle(forceExit(this.gate)), EXIT_WAIT_MS);
    }
    this.settle(step);
  }

  private settle(step: GateStep): void {
    this.gate = step.gate;
    if (step.commit === null) return;
    clearTimeout(this.exitTimer);
    this.exitTimer = undefined;
    const reason = step.commit;
    overlayExit(this.session.seq, reason).catch((e) => logFailure("overlay_exit", e));
  }

  /** Rust hides the window after this: hand over what matters, paint an empty frame, confirm. */
  private async blank(request: BlankRequest): Promise<void> {
    const seq = this.session.seq;
    // Rust's exit timeout came first: it still learns the route was parked, so the HUD says so.
    const parked = this.gate.pending?.reason === "switchZoom";
    const step = reduce(this.session, { type: "end" });
    this.session = step.session;
    this.reset();
    const late = parked ? [overlayExit(seq, "switchZoom").catch((e) => logFailure("overlay_exit", e))] : [];
    await Promise.allSettled([...late, ...step.effects.map((effect) => this.carry(effect, seq))]);
    await nextFrame();
    await nextFrame();
    overlayBlank(request.seq).catch((e) => logFailure("overlay_blank", e));
  }

  private reset(): void {
    this.gate = openGate();
    clearTimeout(this.exitTimer);
    clearTimeout(this.saveTimer);
    clearInterval(this.countdownTimer);
    this.exitTimer = this.saveTimer = this.countdownTimer = undefined;
    this.pendingMove = null;
  }

  // ---------------------------------------------------------------- input

  onKeyDown(event: KeyboardEvent): void {
    if (!this.session.active) return;
    event.preventDefault();
    this.gate = keyDown(this.gate, event.code);
    if (!event.repeat) this.dispatch({ type: "key", code: event.code });
  }

  onKeyUp(event: KeyboardEvent): void {
    if (!this.session.active) return;
    event.preventDefault();
    this.settle(keyUp(this.gate, event.code));
  }

  onPointerDown(event: PointerEvent): void {
    if (!this.session.active) return;
    event.preventDefault();
    this.dispatch({ type: "pointerDown", button: event.button, point: { x: event.clientX, y: event.clientY } });
  }

  /** At most one move per frame. */
  onPointerMove(event: PointerEvent): void {
    if (!this.session.active) return;
    const first = this.pendingMove === null;
    this.pendingMove = { x: event.clientX, y: event.clientY };
    if (!first) return;
    requestAnimationFrame(() => {
      const point = this.pendingMove;
      this.pendingMove = null;
      if (point) this.dispatch({ type: "pointerMove", point });
    });
  }

  onWheel(event: WheelEvent): void {
    if (!this.session.active) return;
    event.preventDefault();
    this.dispatch({ type: "wheel", deltaY: event.deltaY, deltaX: event.deltaX, shift: event.shiftKey, ctrl: event.ctrlKey });
  }

  onFocusChange(focused: boolean): void {
    if (this.session.active) this.dispatch({ type: "focus", focused });
  }

  chooseCells(cellMeters: 100 | 1000): void {
    this.dispatch({ type: "chooseCells", cellMeters });
  }
}
