import { describe, expect, it } from "vitest";

import { idleSession, reduce, type Action, type Session } from "../../lib/core/session";
import type { GridScale, MeasurementResult } from "../../lib/core/types";
import { dhLine, fineScale, liveCellPx, liveMeters, mortarLine, panelSide, segmentsLine, travelRows, verifyLine } from "./view";

const NBSP = " ";
const scale: GridScale = { cellMeters: 100, cellPx: 100, origin: { x: 0, y: 0 } };

function session(...actions: Action[]): Session {
  const start: Action = {
    type: "activate",
    seq: 1,
    preset: "near",
    monitor: "2560x1440@125",
    start: "measure",
    viewport: { w: 2048, h: 1151.2, scale: 1.25 },
    speeds: { sprintMps: 6.3, daciaKmh: 100, daciaVerified: false },
    scales: { near: scale, far: null },
    focused: true,
    carried: null,
  };
  return [start, ...actions].reduce((s, a) => reduce(s, a).session, idleSession());
}

const result = (overrides: Partial<MeasurementResult> = {}): MeasurementResult => ({
  preset: "near",
  totalM: 412,
  errorM: 2,
  segmentsM: [412],
  dhM: 35,
  mortar: { status: "ok", sightM: 424.4 },
  travel: { sprintS: 65, daciaS: 14.8, daciaVerified: false },
  ...overrides,
});

describe("panel texts", () => {
  it("shows the mortar value or why there is none", () => {
    expect(mortarLine("ru", result())).toEqual({ text: `Миномёт 424${NBSP}м` });
    expect(mortarLine("en", result({ mortar: { status: "tooFar", sightM: null } }))).toEqual({
      text: "Mortar — beyond 700 m — out of range",
      warn: true,
    });
    expect(mortarLine("ru", result({ mortar: { status: "notApplicable", sightM: null } })).warn).toBe(false);
  });

  it("says which way the target is", () => {
    expect(dhLine("ru", 35)).toBe(`ΔH +35${NBSP}м — цель выше`);
    expect(dhLine("en", -12)).toBe(`ΔH −12${NBSP}m — target lower`);
    expect(dhLine("ru", 0)).toBe(`ΔH +0${NBSP}м`);
  });

  it("lists the segments of a route only", () => {
    expect(segmentsLine("ru", result())).toBeNull();
    expect(segmentsLine("ru", result({ segmentsM: [640.2, 599.6], totalM: 1239.8 }))).toBe(`2 отрезка: 640 + 600${NBSP}м`);
  });

  it("marks the Dacia speed as not verified", () => {
    const [run, dacia] = travelRows("ru", result(), 6.3, 100);
    expect(run).toEqual({ label: "Бегом", time: "≈ 1:05", speed: `6,3${NBSP}м/с`, note: null });
    expect(dacia).toEqual({ label: "Dacia", time: "≈ 0:15", speed: `100${NBSP}км/ч`, note: "не проверено" });
    const verified = travelRows("en", result({ travel: { sprintS: 1, daciaS: 1, daciaVerified: true } }), 6.3, 100);
    expect(verified[1]?.note).toBeNull();
  });
});

describe("live values", () => {
  it("measures from the last point to the cursor", () => {
    const s = session({ type: "pointerDown", button: 0, point: { x: 0, y: 0 } }, { type: "pointerMove", point: { x: 300, y: 400 } });
    expect(liveMeters(s)).toBe(500);
    expect(liveMeters(session())).toBeNull();
  });

  it("shows the cell size the next setup click would give", () => {
    const s = session(
      { type: "key", code: "KeyC" },
      { type: "key", code: "Digit2" },
      { type: "pointerDown", button: 0, point: { x: 100, y: 100 } },
      { type: "pointerMove", point: { x: 271, y: 98 } },
    );
    expect(liveCellPx(s.draft!, s.cursor)).toBe(171);
  });

  it("warns on step 4 when the scale looks 10× off", () => {
    const step4 = (cells: string) =>
      session(
        { type: "key", code: "KeyC" },
        { type: "key", code: cells },
        { type: "pointerDown", button: 0, point: { x: 100, y: 100 } },
        { type: "pointerDown", button: 0, point: { x: 270, y: 100 } },
      );
    expect(fineScale("ru", step4("Digit2"))?.tenX).toBe(false);
    expect(fineScale("ru", step4("Digit1"))?.tenX).toBe(true);
    expect(fineScale("ru", session())).toBeNull();
  });

  it("asks for the 3-cell check after a new scale", () => {
    const saved = session(
      { type: "key", code: "KeyC" },
      { type: "key", code: "Digit2" },
      { type: "pointerDown", button: 0, point: { x: 100, y: 100 } },
      { type: "pointerDown", button: 0, point: { x: 270, y: 100 } },
      { type: "key", code: "Enter" },
    );
    expect(verifyLine("ru", saved)).toContain(`300${NBSP}м`);
    expect(verifyLine("ru", session())).toBeNull();
  });
});

describe("panelSide", () => {
  const left = { x: 24, y: 24, w: 360, h: 300 };
  const right = { x: 1664, y: 24, w: 360, h: 300 };

  it("stays left unless the cursor or a point comes within 32 px", () => {
    expect(panelSide(left, right, { x: 1000, y: 600 }, [])).toBe("left");
    expect(panelSide(left, right, { x: 400, y: 200 }, [])).toBe("right");
    expect(panelSide(left, right, null, [{ x: 100, y: 100 }])).toBe("right");
  });

  it("goes back left when both corners are taken", () => {
    expect(panelSide(left, right, { x: 100, y: 100 }, [{ x: 1700, y: 100 }])).toBe("left");
  });
});
