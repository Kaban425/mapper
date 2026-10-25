// Helpers that play Rust's part through window.__MAPPER_MOCK__ (src/lib/ipc/mock.ts).

import type { Page } from "@playwright/test";

export interface Call {
  readonly command: string;
  readonly args: Record<string, unknown> | undefined;
}

interface Mock {
  emit(event: string, payload: unknown): void;
  calls: Call[];
}

export const emit = (page: Page, event: string, payload: unknown): Promise<void> =>
  page.evaluate(
    ([name, data]) => (window as unknown as { __MAPPER_MOCK__: Mock }).__MAPPER_MOCK__.emit(name as string, data),
    [event, payload] as const,
  );

export const calls = (page: Page, command?: string): Promise<Call[]> =>
  page.evaluate(
    (name) => (window as unknown as { __MAPPER_MOCK__: Mock }).__MAPPER_MOCK__.calls.filter((c) => !name || c.command === name),
    command,
  );

/** A 100 m grid where 100 CSS px are 100 m: easy numbers. */
export const metreScale = (w: number, h: number) => ({
  cellMeters: 100,
  cellPx: 100,
  origin: { x: 0, y: 0 },
  w,
  h,
  scale: 1,
  createdAt: "2026-10-22T00:00:00Z",
});

export interface Activation {
  readonly preset?: "near" | "far";
  readonly start?: "measure" | "calibrate";
  readonly near?: unknown;
  readonly far?: unknown;
  readonly language?: "ru" | "en";
  readonly opacity?: number;
  /** Whether Rust managed to give the overlay focus. */
  readonly ok?: boolean;
}

/** Opens the overlay page and starts a session as Rust would after Alt+Q / Alt+W. */
export async function activate(page: Page, a: Activation = {}): Promise<{ w: number; h: number }> {
  if (!page.url().endsWith("/overlay.html")) {
    await page.goto("/overlay.html");
    await page.waitForFunction(() => "__MAPPER_MOCK__" in window);
    // Listeners are attached right after mount.
    await page.waitForTimeout(50);
  }
  const { w, h } = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
  const scale = metreScale(w, h);
  await emit(page, "overlay-activating", {
    seq: 1,
    preset: a.preset ?? "near",
    start: a.start ?? "measure",
    viewport: { w, h, scale: 1 },
    monitor: { key: "1600x900@100", label: "1600×900 · 100 %" },
    calibrations: { near: "near" in a ? a.near : scale, far: "far" in a ? a.far : null },
    settings: {
      language: a.language ?? "ru",
      panelOpacity: a.opacity ?? 0.65,
      speeds: { sprintMps: 6.3, daciaKmh: 100, daciaVerified: false },
      hotkeys: { near: "Alt+Q", far: "Alt+W" },
    },
  });
  const ok = a.ok ?? true;
  await emit(page, "overlay-activated", { seq: 1, ok, attempts: ok ? 1 : 4, ms: ok ? 20 : 140 });
  return { w, h };
}
