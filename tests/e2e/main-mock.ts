// Plays Rust's part for the main window: a snapshot that the window's commands change the way
// Rust would (src-tauri/src/commands/main_window.rs), kept inside the page.

import type { Page } from "@playwright/test";

import fixture from "../../src-tauri/tests/ipc-fixtures/snapshot-changed.json" with { type: "json" };
import type { AppSnapshot } from "../../src/lib/ipc/types";

export type Snapshot = AppSnapshot;

/** A fresh install: wizard step 1, both hotkeys working, one monitor without scales. */
export function freshSnapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  const base = fixture as unknown as Snapshot;
  return {
    ...base,
    notices: [],
    settings: { ...base.settings, monitor: { mode: "cursor" }, firstRunDone: false, wizardStep: 1, riskAccepted: false },
    hotkeys: {
      near: { accelerator: "Alt+Q", registered: true },
      far: { accelerator: "Alt+W", registered: true },
      suspended: false,
    },
    displays: [{ name: "\\\\.\\DISPLAY1", key: "2560x1440@125", label: "2560×1440 · 125 %", primary: true, pinned: false }],
    scales: [{ key: "2560x1440@125", label: "2560×1440 · 125 %", connected: true, primary: true, near: null, far: null }],
    pinnedMissing: false,
    armed: null,
    overlay: null,
    lastMeasurement: null,
    autostart: { enabled: false, approvedByWindows: true, pathMatches: false },
    update: { state: "idle", latest: null, current: "0.1.0", checkedAt: null, dismissed: false },
    ...overrides,
  };
}

export const calibration = (cellMeters: 100 | 1000, cellPx: number) => ({
  cellMeters,
  cellPx,
  origin: { x: 512, y: 300 },
  w: 2048,
  h: 1151.2,
  scale: 1.25,
  createdAt: "2026-10-25T10:00:00.000Z",
});

/** Opens the main window page with `snapshot` as Rust's state. */
export async function openMain(page: Page, snapshot: Snapshot): Promise<void> {
  await page.goto("/main.html");
  await page.waitForFunction(() => "__MAPPER_MOCK__" in window);
  await page.waitForTimeout(50);
  await page.evaluate((initial) => {
    type Args = Record<string, unknown> | undefined;
    const mock = (window as unknown as { __MAPPER_MOCK__: { handlers: Map<string, (a: Args) => unknown>; emit(e: string, p: unknown): void } })
      .__MAPPER_MOCK__;
    let state = structuredClone(initial) as Record<string, any>;
    let revision = 100;
    // Every snapshot Rust builds is newer than the one before.
    const answer = () => structuredClone({ ...state, revision: ++revision });
    mock.handlers.set("get_snapshot", answer);
    mock.handlers.set("update_settings", (args) => {
      const patch = { ...(args?.patch as Record<string, any>) };
      const settings = { ...state.settings };
      const speeds = patch.resetSpeeds ? { sprintMps: 6.3, daciaKmh: 100, daciaVerified: false } : { ...settings.speeds };
      if (patch.sprintMps !== undefined) speeds.sprintMps = patch.sprintMps;
      if (patch.daciaKmh !== undefined) Object.assign(speeds, { daciaKmh: patch.daciaKmh, daciaVerified: true });
      for (const key of ["language", "panelOpacity", "updatesEnabled", "firstRunDone", "wizardStep", "riskAccepted", "uiZoom"]) {
        if (patch[key] !== undefined) settings[key] = patch[key];
      }
      if (patch.monitor?.mode === "cursor") settings.monitor = { mode: "cursor" };
      if (patch.dismissUpdate !== undefined && patch.dismissUpdate === state.update.latest) {
        state.update = { ...state.update, dismissed: true };
      }
      state = { ...state, settings: { ...settings, speeds } };
      return answer();
    });
    mock.handlers.set("set_hotkey", (args) => {
      const preset = args?.preset as "near" | "far";
      const accelerator = args?.accelerator as string;
      state.settings = { ...state.settings, hotkeys: { ...state.settings.hotkeys, [preset]: accelerator } };
      state.hotkeys = { ...state.hotkeys, [preset]: { accelerator, registered: !state.hotkeys.suspended } };
      return answer();
    });
    mock.handlers.set("check_update_now", () => {
      state.update = { ...state.update, state: "checking" };
      return answer();
    });
    mock.handlers.set("reset_hotkeys", () => {
      state.settings = { ...state.settings, hotkeys: { near: "Alt+Q", far: "Alt+W" } };
      state.hotkeys = { near: { accelerator: "Alt+Q", registered: true }, far: { accelerator: "Alt+W", registered: true }, suspended: false };
      return answer();
    });
    mock.handlers.set("suspend_hotkeys", (args) => {
      const suspended = Boolean(args?.suspended);
      const status = (s: { accelerator: string }) => ({ accelerator: s.accelerator, registered: !suspended });
      state.hotkeys = { near: status(state.hotkeys.near), far: status(state.hotkeys.far), suspended };
      return answer();
    });
    mock.handlers.set("arm_calibration", (args) => {
      state.armed = args?.preset ?? null;
      return answer();
    });
    mock.handlers.set("reset_calibration", (args) => {
      const target = args?.preset as string;
      state.scales = state.scales.map((m: Record<string, unknown>) =>
        m.key === args?.monitorKey
          ? { ...m, near: target === "far" ? m.near : null, far: target === "near" ? m.far : null }
          : m,
      );
      return answer();
    });
    mock.handlers.set("set_autostart", (args) => {
      state.autostart = { ...state.autostart, enabled: Boolean(args?.enabled), pathMatches: Boolean(args?.enabled) };
      return answer();
    });
    // What Rust pushes while the player is in game.
    (window as unknown as { __push: (s: unknown) => void }).__push = (next) => {
      state = structuredClone(next) as Record<string, any>;
      mock.emit("snapshot-changed", answer());
    };
    mock.emit("snapshot-changed", answer());
  }, snapshot);
}

/** Rust's state changes on its own (overlay events, a scale saved in game). */
export const push = (page: Page, snapshot: Snapshot): Promise<void> =>
  page.evaluate((s) => (window as unknown as { __push: (s: unknown) => void }).__push(s), snapshot);
