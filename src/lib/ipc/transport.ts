// How the windows reach Rust. The build picks the implementation through the `$transport`
// alias: Tauri for the app, an in-memory mock for the Playwright tests (vite --mode e2e).

import type { WindowLabel } from "./types";

export interface Transport {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
  /** Only events addressed to `label` arrive: Tauri matches `emit_to` by the listener's target. */
  listen(event: string, label: WindowLabel, handler: (payload: unknown) => void): Promise<() => void>;
}
