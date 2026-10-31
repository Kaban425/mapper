// Commands the windows may call (plan/eng.md §4). Each window's capability file decides which
// of them it can actually reach; the HUD calls none.

import { transport } from "$transport";

import type { MeasurementResult, Preset } from "../core/types";
import type { AppSnapshot, ExitReason, Folder, GridArgs, Link, ResetTarget, SettingsPatch } from "./types";

export type LogLevel = "info" | "warn" | "error";

/** What every command rejects with (`IpcError` in Rust); the UI picks the text itself. */
export type IpcErrorCode =
  | "invalid_input"
  | "not_allowed"
  | "stale_session"
  | "read_only"
  | "io"
  | "hotkey_invalid"
  | "hotkey_busy"
  | "hotkey_conflict"
  | "path_too_long"
  | "rate_limited";

export const logLine = (level: LogLevel, msg: string): Promise<void> => transport.invoke("log_line", { level, msg });

export const quitApp = (): Promise<void> => transport.invoke("quit_app");

// Main window: every change answers with the new snapshot.
export const getSnapshot = (): Promise<AppSnapshot> => transport.invoke("get_snapshot");

export const updateSettings = (patch: SettingsPatch): Promise<AppSnapshot> => transport.invoke("update_settings", { patch });

export const setHotkey = (preset: Preset, accelerator: string): Promise<AppSnapshot> =>
  transport.invoke("set_hotkey", { preset, accelerator });

/** Alt+Q and Alt+W together (a swapped pair cannot come back one at a time). */
export const resetHotkeys = (): Promise<AppSnapshot> => transport.invoke("reset_hotkeys");

export const suspendHotkeys = (suspended: boolean): Promise<AppSnapshot> => transport.invoke("suspend_hotkeys", { suspended });

export const armCalibration = (preset: Preset | null): Promise<AppSnapshot> => transport.invoke("arm_calibration", { preset });

export const resetCalibration = (monitorKey: string, preset: ResetTarget): Promise<AppSnapshot> =>
  transport.invoke("reset_calibration", { monitorKey, preset });

export const setAutostart = (enabled: boolean): Promise<AppSnapshot> => transport.invoke("set_autostart", { enabled });

/** "Check now": at most once a minute; the result arrives with `snapshot-changed`. */
export const checkUpdateNow = (): Promise<AppSnapshot> => transport.invoke("check_update_now");

export const openLink = (link: Link): Promise<void> => transport.invoke("open_link", { link });

export const openFolder = (folder: Folder): Promise<void> => transport.invoke("open_folder", { folder });

export const hideMainWindow = (): Promise<void> => transport.invoke("hide_main_window");

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
