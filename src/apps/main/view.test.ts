import { describe, expect, it } from "vitest";

import snapshotFixture from "../../../src-tauri/tests/ipc-fixtures/snapshot-changed.json";
import type { AppSnapshot, Calibration, MonitorScales } from "../../lib/ipc/types";
import {
  cardState,
  defaultMonitorKey,
  lastLines,
  monitorOption,
  opacityFromPercent,
  transparencyPercent,
  updateLine,
  updateOffered,
  visibleText,
  wizardReady,
  wizardStatus,
} from "./view";

const NNBSP = "\u202f";
const NBSP = "\u00a0";
const base = snapshotFixture as unknown as AppSnapshot;

const near: Calibration = {
  cellMeters: 100,
  cellPx: 170.4,
  origin: { x: 512, y: 300 },
  w: 2048,
  h: 1151.2,
  scale: 1.25,
  createdAt: "2026-10-21T18:04:11.512Z",
};
const far: Calibration = { ...near, cellMeters: 1000, cellPx: 120, createdAt: "2026-10-22T10:00:00.000Z" };

function snapshot(overrides: Partial<AppSnapshot> = {}): AppSnapshot {
  return { ...base, armed: null, overlay: null, ...overrides };
}

const monitor = (over: Partial<MonitorScales>): MonitorScales => ({
  key: "2560x1440@125",
  label: "2560×1440 · 125 %",
  connected: true,
  primary: true,
  near: null,
  far: null,
  ...over,
});

describe("Home cards", () => {
  it("describe the pinned monitor first, else the main one", () => {
    expect(defaultMonitorKey(base)).toBe("2560x1440@125");
    const pinned = snapshot({
      displays: [
        { name: "a", key: "2560x1440@125", label: "x", primary: true, pinned: false },
        { name: "b", key: "1080x1920@125", label: "y", primary: false, pinned: true },
      ],
    });
    expect(defaultMonitorKey(pinned)).toBe("1080x1920@125");
  });

  it("show a ready scale with what fits on screen", () => {
    const s = snapshot({ scales: [monitor({ near })] });
    expect(cardState(s, "2560x1440@125", "near")).toEqual({ kind: "ready", calibration: near, tenX: false });
    expect(visibleText("ru", near)).toBe(`На экране 1${NNBSP}202 × 676${NBSP}м`);
  });

  it("say when a scale is kept for another resolution, or the setup is armed", () => {
    const kept = monitor({ key: "1920x1080@100", label: "1920×1080 · 100 %", connected: false, primary: false, far });
    const s = snapshot({ scales: [monitor({}), kept] });
    expect(cardState(s, "2560x1440@125", "far")).toEqual({ kind: "notSet", kept: "1920×1080 · 100 %" });
    expect(cardState(s, "2560x1440@125", "near")).toEqual({ kind: "notSet", kept: null });
    expect(cardState({ ...s, armed: "far" }, "2560x1440@125", "far")).toEqual({ kind: "armed" });
    expect(monitorOption("ru", s.scales[1]!)).toBe("1920×1080 · 100 % · не подключён");
    expect(monitorOption("en", s.scales[0]!)).toBe("2560×1440 · 125 % · main");
    expect(monitorOption("ru", s.scales[0]!, true)).toBe("2560×1440 · 125 % · основной · закреплён");
  });
});

describe("wizard step 4", () => {
  it("follows the setup in game", () => {
    const waiting = snapshot({ scales: [monitor({})], hotkeys: { ...base.hotkeys, far: { accelerator: "Alt+W", registered: true } } });
    expect(wizardStatus(waiting, "near")).toEqual({ kind: "waiting" });
    expect(wizardStatus({ ...waiting, overlay: { preset: "near", start: "calibrate" } }, "near")).toEqual({ kind: "calibrating" });
    expect(wizardStatus({ ...waiting, overlay: { preset: "near", start: "measure" } }, "near")).toEqual({ kind: "waiting" });
    const done = { ...waiting, scales: [monitor({ near, far })] };
    expect(wizardStatus(done, "far")).toMatchObject({ kind: "ready", label: "2560×1440 · 125 %" });
    expect(wizardReady(done)).toBe(true);
    expect(wizardReady(waiting)).toBe(false);
  });

  it("counts only connected monitors and says when a hotkey is busy", () => {
    const unplugged = snapshot({ scales: [monitor({ connected: false, near })] });
    expect(wizardStatus(unplugged, "near")).toEqual({ kind: "waiting" });
    expect(wizardStatus(base, "far")).toEqual({ kind: "busy" });
  });

  it("warns about a scale that looks 10× off", () => {
    const wrong = { ...near, cellMeters: 1000 as const };
    const s = snapshot({ scales: [monitor({ near: wrong })] });
    expect(wizardStatus(s, "near")).toMatchObject({ kind: "ready", tenX: true });
  });
});

describe("last measurement", () => {
  it("reads like the HUD", () => {
    const lines = lastLines("ru", base.lastMeasurement!);
    expect(lines.meta).toMatch(/^\d\d:\d\d · ПРИБЛИЖЕНО$/);
    expect(lines.value).toBe(`412${NBSP}м`);
    expect(lines.error).toContain("±");
    expect(lines.travel).toBe("Бегом ≈ 1:05 · Dacia ≈ 0:15");
    expect(lines.spoken).toBe("412 метров, плюс-минус 2 метра");
    expect(lastLines("en", base.lastMeasurement!).spoken).toBe("412 meters, plus or minus 2 meters");
    expect(lines.mortar).toContain("Миномёт");
  });
});

describe("panel transparency", () => {
  it("maps 0–100 % onto the allowed glass density", () => {
    expect(transparencyPercent(0.94)).toBe(0);
    expect(transparencyPercent(0.5)).toBe(100);
    expect(transparencyPercent(0.65)).toBe(66);
    expect(opacityFromPercent(0)).toBe(0.94);
    expect(opacityFromPercent(100)).toBe(0.5);
    expect(transparencyPercent(opacityFromPercent(25))).toBe(25);
  });
});

describe("update texts", () => {
  const view = (over: Partial<AppSnapshot["update"]> = {}): AppSnapshot["update"] => ({
    state: "upToDate",
    latest: null,
    current: "0.1.0",
    checkedAt: 1_792_919_290,
    dismissed: false,
    ...over,
  });

  it("offer a newer version until Later", () => {
    expect(updateOffered(view({ state: "available", latest: "v1.1.0" }))).toBe("1.1.0");
    expect(updateOffered(view({ state: "available", latest: "v1.1.0", dismissed: true }))).toBeNull();
    expect(updateOffered(view({ state: "offline", latest: "v1.1.0" })), "a later check failed").toBe("1.1.0");
    expect(updateOffered(view())).toBeNull();
  });

  it("say when Mapper last asked and what it heard", () => {
    expect(updateLine("ru", view()).text).toMatch(/^Последняя проверка: .+ — у тебя последняя версия$/);
    expect(updateLine("en", view({ checkedAt: null, state: "idle" })).text).toBe("Not checked yet");
    expect(updateLine("ru", view({ state: "offline" }))).toMatchObject({ warn: true });
    expect(updateLine("en", view({ state: "noRepository" })).text).toContain("no network request");
  });
});
