// The real transport. Listeners always name their own window as the target: the default
// target `Any` would also receive events Rust sends to the other windows.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import type { Transport } from "./transport";

export const transport: Transport = {
  invoke: <T>(command: string, args?: Record<string, unknown>) => invoke<T>(command, args),
  listen: (event, label, handler) =>
    listen(event, (e) => handler(e.payload), { target: { kind: "WebviewWindow", label } }),
};
