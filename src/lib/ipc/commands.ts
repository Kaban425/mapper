// Commands the windows may call (plan/eng.md §4). Each window's capability file decides which
// of them it can actually reach; the HUD calls none.

import { transport } from "$transport";

import type { MeasurementResult, Preset } from "../core/types";
import type { ExitReason, GridArgs } from "./types";

export type LogLevel = "info" | "warn" | "error";

/** What every command rejects with (`IpcError` in Rust); the UI picks the text itself. */
export type IpcErrorCode = "invalid_input" | "not_allowed" | "stale_session" | "read_only" | "io";

export const logLine = (level: LogLevel, msg: string): Promise<void> => transport.invoke("log_line", { level, msg });

export const quitApp = (): Promise<void> => transport.invoke("quit_app");

export const overlayExit = (seq: number, reason: ExitReason): Promise<void> =>
  transport.invoke("overlay_exit", { seq, reason });

export const overlayBlank = (seq: number): Promise<void> => transport.invoke("overlay_blank", { seq });

export const saveCalibration = (seq: number, preset: Preset, calibration: GridArgs): Promise<void> =>
  transport.invoke("save_calibration", { seq, preset, calibration });

export const submitResult = (seq: number, result: MeasurementResult): Promise<void> =>
  transport.invoke("submit_result", { seq, result });

/** The error code of a rejected command, or a short description of anything else. */
export function describeError(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error && typeof error.code === "string") {
    return error.code;
  }
  return error instanceof Error ? error.message : String(error);
}

/** Logs a failed action and never rejects: if logging fails too, there is nowhere left to report. */
export async function logFailure(action: string, error: unknown): Promise<void> {
  try {
    await logLine("error", `${action} failed: ${describeError(error)}`);
  } catch {
    // The log is the last resort.
  }
}
