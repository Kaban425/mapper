// Focus goes back to the game only when no key-up can still reach it: a release delivered
// to the game after the overlay closes would be a key event Mapper caused. The overlay
// tracks the keys held inside it and finishes a requested exit once all are up.

/** "switchZoom": the other zoom's hotkey; the route is parked for it. */
export type ExitReason = "esc" | "hotkey" | "noCalibration" | "switchZoom";

interface Pending {
  readonly reason: ExitReason;
  /** The hotkey's own key-down never arrives (RegisterHotKey consumes it), its key-up does. */
  readonly needKeyUp: boolean;
  readonly sawKeyUp: boolean;
}

export interface ExitGate {
  readonly held: ReadonlySet<string>;
  readonly pending: Pending | null;
}

export interface GateStep {
  readonly gate: ExitGate;
  /** Set when the exit may happen now. */
  readonly commit: ExitReason | null;
}

export const openGate = (): ExitGate => ({ held: new Set(), pending: null });

function settle(gate: ExitGate): GateStep {
  const { pending } = gate;
  const ready = pending !== null && gate.held.size === 0 && (!pending.needKeyUp || pending.sawKeyUp);
  return ready ? { gate: { ...gate, pending: null }, commit: pending.reason } : { gate, commit: null };
}

export function keyDown(gate: ExitGate, code: string): ExitGate {
  if (gate.held.has(code)) return gate;
  return { ...gate, held: new Set(gate.held).add(code) };
}

export function keyUp(gate: ExitGate, code: string): GateStep {
  const held = new Set(gate.held);
  held.delete(code);
  const pending = gate.pending && { ...gate.pending, sawKeyUp: true };
  return settle({ held, pending });
}

/** A second request while one is pending changes nothing. */
export function requestExit(gate: ExitGate, reason: ExitReason, needKeyUp: boolean): GateStep {
  if (gate.pending) return { gate, commit: null };
  return settle({ ...gate, pending: { reason, needKeyUp, sawKeyUp: false } });
}

/** The safety timeout: exit even if some key never reported its release. */
export function forceExit(gate: ExitGate): GateStep {
  return gate.pending ? { gate: openGate(), commit: gate.pending.reason } : { gate, commit: null };
}
