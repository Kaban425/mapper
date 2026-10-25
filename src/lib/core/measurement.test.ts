import fc from "fast-check";
import { describe, expect, it } from "vitest";

import golden from "../../../tests/golden/error.json";
import { errorMeters, routePx, segmentPx, segmentsMeters, ticks } from "./measurement";
import type { GridScale, Point, Viewport } from "./types";

const viewport: Viewport = { w: 2048, h: 1151.2, scale: 1.25 };
// 1 m per CSS px: 100 m cells of 100 px.
const metre: GridScale = { cellMeters: 100, cellPx: 100, origin: { x: 0, y: 0 } };

describe("lengths", () => {
  it("measures segments and the whole route", () => {
    const points: Point[] = [
      { x: 0, y: 0 },
      { x: 300, y: 400 },
      { x: 300, y: 1000 },
    ];
    expect(segmentPx(points[0]!, points[1]!)).toBe(500);
    expect(routePx(points)).toBe(1100);
    expect(segmentsMeters(points, metre)).toEqual([500, 600]);
    expect(segmentsMeters(points, { ...metre, cellMeters: 1000 })).toEqual([5000, 6000]);
  });

  it("gives nothing for fewer than two points", () => {
    expect(routePx([])).toBe(0);
    expect(segmentsMeters([{ x: 1, y: 1 }], metre)).toEqual([]);
    expect(errorMeters([{ x: 1, y: 1 }], metre, viewport)).toBe(0);
  });
});

describe("errorMeters", () => {
  it.each(golden.cases)("golden: $label", ({ points, cellMeters, cellPx, viewportW, errorM }) => {
    const scale: GridScale = { cellMeters: cellMeters as 100 | 1000, cellPx, origin: { x: 0, y: 0 } };
    expect(errorMeters(points, scale, { w: viewportW, h: 1000, scale: 1 })).toBeCloseTo(errorM, 3);
  });

  it("grows with the length of the route", () => {
    fc.assert(
      fc.property(fc.integer({ min: 10, max: 1500 }), fc.integer({ min: 1, max: 500 }), (length, more) => {
        const short = errorMeters([{ x: 0, y: 0 }, { x: length, y: 0 }], metre, viewport);
        const long = errorMeters([{ x: 0, y: 0 }, { x: length + more, y: 0 }], metre, viewport);
        expect(long).toBeGreaterThan(short);
      }),
    );
  });
});

describe("ticks", () => {
  it("marks every 100 m with a long tick every kilometre", () => {
    const marks = ticks({ x: 0, y: 0 }, { x: 1500, y: 0 }, metre);
    expect(marks).toHaveLength(14);
    expect(marks.filter((t) => t.major)).toHaveLength(1);
    expect(marks[9]).toMatchObject({ x1: 1000, x2: 1000, major: true });
  });

  it("falls back to 1 km ticks when 100 m would be closer than 6 px", () => {
    const zoomedOut: GridScale = { cellMeters: 1000, cellPx: 50, origin: { x: 0, y: 0 } }; // 100 m = 5 px
    const marks = ticks({ x: 0, y: 0 }, { x: 0, y: 260 }, zoomedOut);
    expect(marks).toHaveLength(5);
    expect(marks.every((t) => t.major)).toBe(true);
  });

  it("draws nothing when even 1 km ticks would merge", () => {
    expect(ticks({ x: 0, y: 0 }, { x: 100, y: 0 }, { cellMeters: 1000, cellPx: 5, origin: { x: 0, y: 0 } })).toEqual([]);
  });

  it("puts ticks perpendicular to the segment", () => {
    const [first] = ticks({ x: 0, y: 0 }, { x: 0, y: 500 }, metre);
    expect(first).toMatchObject({ x1: 5, y1: 100, x2: -5, y2: 100 });
  });
});
