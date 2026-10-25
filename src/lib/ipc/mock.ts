// In-memory transport for the Playwright tests (vite --mode e2e). The test drives it through
// `window.__MAPPER_MOCK__`: it emits the events Rust would send and reads the commands the
// UI invoked. Never part of the app build (the guard checks dist for the marker, Phase 4).

import type { Transport } from "./transport";

export interface MockCall {
  readonly command: string;
  readonly args: Record<string, unknown> | undefined;
}

export interface MockApi {
  emit(event: string, payload: unknown): void;
  readonly calls: MockCall[];
  /** Commands that should reject, with the IpcError code to reject with. */
  readonly failures: Map<string, string>;
}

const listeners = new Map<string, Set<(payload: unknown) => void>>();

const api: MockApi = {
  emit(event, payload) {
    for (const handler of listeners.get(event) ?? []) handler(payload);
  },
  calls: [],
  failures: new Map(),
};

(globalThis as unknown as { __MAPPER_MOCK__: MockApi }).__MAPPER_MOCK__ = api;

export const transport: Transport = {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
    api.calls.push({ command, args });
    const code = api.failures.get(command);
    return code ? Promise.reject({ code }) : Promise.resolve(undefined as T);
  },
  listen(event, _label, handler) {
    const set = listeners.get(event) ?? new Set();
    set.add(handler);
    listeners.set(event, set);
    return Promise.resolve(() => set.delete(handler));
  },
};
