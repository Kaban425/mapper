// The only place that talks to Rust. Phase 1 exposes the two commands every window needs;
// the rest of the contract (plan/eng.md §4) lands with the screens that use it.
import { invoke } from "@tauri-apps/api/core";

export type LogLevel = "info" | "warn" | "error";

/** What every command rejects with (`IpcError` in Rust); the UI picks the text itself. */
export type IpcErrorCode = "invalid_input" | "not_allowed";

export function logLine(level: LogLevel, msg: string): Promise<void> {
  return invoke("log_line", { level, msg });
}

export function quitApp(): Promise<void> {
  return invoke("quit_app");
}

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
