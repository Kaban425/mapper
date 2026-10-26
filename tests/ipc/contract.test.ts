// The IPC contract from both sides: payloads Rust writes (src-tauri/tests/ipc-fixtures, see
// events.rs) pass the TypeScript validators, and what the overlay sends has the exact shape
// Rust deserializes with `deny_unknown_fields`.

import { describe, expect, it } from "vitest";

import hudShow from "../../src-tauri/tests/ipc-fixtures/hud-show.json";
import hudShowNotice from "../../src-tauri/tests/ipc-fixtures/hud-show-notice.json";
import overlayActivated from "../../src-tauri/tests/ipc-fixtures/overlay-activated.json";
import overlayActivating from "../../src-tauri/tests/ipc-fixtures/overlay-activating.json";
import overlayBlankRequest from "../../src-tauri/tests/ipc-fixtures/overlay-blank-request.json";
import overlayPreset from "../../src-tauri/tests/ipc-fixtures/overlay-preset.json";
import saveCalibrationArgs from "../../src-tauri/tests/ipc-fixtures/save_calibration.args.json";
import snapshotChanged from "../../src-tauri/tests/ipc-fixtures/snapshot-changed.json";
import submitResultArgs from "../../src-tauri/tests/ipc-fixtures/submit_result.args.json";
import { buildResult } from "../../src/lib/core/result";
import type { EventName } from "../../src/lib/ipc/types";
import { guards, isMeasurementResult } from "../../src/lib/ipc/validate";

const fixtures: Record<string, unknown> = {
  "hud-show": hudShow,
  "hud-show-notice": hudShowNotice,
  "overlay-activated": overlayActivated,
  "overlay-activating": overlayActivating,
  "overlay-blank-request": overlayBlankRequest,
  "overlay-preset": overlayPreset,
  "save_calibration.args": saveCalibrationArgs,
  "snapshot-changed": snapshotChanged,
  "submit_result.args": submitResultArgs,
};
const fixture = (name: string): unknown => fixtures[name];

/** Every key path of a JSON value, e.g. "mortar.sightM". */
function keyPaths(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return [prefix];
  return Object.entries(value).flatMap(([key, inner]) => keyPaths(inner, prefix ? `${prefix}.${key}` : key));
}

describe("Rust → UI payloads", () => {
  const events: EventName[] = [
    "overlay-activating",
    "overlay-activated",
    "overlay-preset",
    "overlay-blank-request",
    "hud-show",
    "snapshot-changed",
  ];

  it.each(events)("%s from Rust passes its validator", (event) => {
    expect(guards[event](fixture(event))).toBe(true);
  });

  it("the HUD notice from Rust passes too", () => {
    expect(guards["hud-show"](fixture("hud-show-notice"))).toBe(true);
  });

  it("validators reject a broken payload", () => {
    const activating = fixture("overlay-activating") as Record<string, unknown>;
    expect(guards["overlay-activating"]({ ...activating, seq: -1 })).toBe(false);
    expect(guards["overlay-activating"]({ ...activating, preset: "mid" })).toBe(false);
    expect(guards["hud-show"]({ kind: "notice" })).toBe(false);
    expect(guards["overlay-blank-request"]({ seq: 1, reason: "other" })).toBe(false);
    const snapshot = fixture("snapshot-changed") as Record<string, unknown>;
    expect(guards["snapshot-changed"]({ ...snapshot, notices: ["config-gone"] })).toBe(false);
    expect(guards["snapshot-changed"]({ ...snapshot, armed: "mid" })).toBe(false);
    expect(guards["tray-hint"]({})).toBe(true);
    expect(guards["tray-hint"]({ screen: "x" })).toBe(false);
  });
});

describe("UI → Rust arguments", () => {
  it("the overlay's result has exactly the fields Rust accepts", () => {
    const result = buildResult({
      preset: "near",
      points: [
        { x: 0, y: 0 },
        { x: 300, y: 400 },
      ],
      scale: { cellMeters: 100, cellPx: 100, origin: { x: 0, y: 0 } },
      viewport: { w: 2048, h: 1151.2, scale: 1.25 },
      dhM: 35,
      speeds: { sprintMps: 6.3, daciaKmh: 100, daciaVerified: false },
    });
    expect(isMeasurementResult(result)).toBe(true);
    expect(keyPaths(result).sort()).toEqual(keyPaths(fixture("submit_result.args")).sort());
  });

  it("a scale to save has exactly the fields Rust accepts", () => {
    const grid = { cellMeters: 100, cellPx: 170.4, origin: { x: 512, y: 300 } };
    expect(keyPaths(grid).sort()).toEqual(keyPaths(fixture("save_calibration.args")).sort());
  });
});
