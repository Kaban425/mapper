import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { carryRoute, reproject } from "./carry";
import { routePx } from "./measurement";

describe("carrying a route", () => {
  it("parks nothing without points", () => {
    expect(carryRoute("near", "1920x1080@100", [], 0, { cellMeters: 100, cellPx: 100, origin: { x: 0, y: 0 } })).toBeNull();
  });

  it("keeps the route's length in metres in any scale", () => {
    const point = fc.record({ x: fc.integer({ min: -2000, max: 2000 }), y: fc.integer({ min: -2000, max: 2000 }) });
    fc.assert(
      fc.property(
        fc.array(point, { minLength: 2, maxLength: 10 }),
        fc.double({ min: 0.05, max: 20, noNaN: true }),
        fc.double({ min: 0.05, max: 20, noNaN: true }),
        point,
        (points, before, after, anchor) => {
          const carried = { preset: "near" as const, monitor: "1920x1080@100", points, dhM: 0, metersPerPx: before };
          const moved = reproject(carried, anchor, after);
          expect(moved[0]).toEqual(anchor);
          expect(routePx(moved) * after).toBeCloseTo(routePx(points) * before, 6);
        },
      ),
    );
  });

  it("refuses a broken ratio", () => {
    const carried = { preset: "far" as const, monitor: "1920x1080@100", points: [{ x: 0, y: 0 }], dhM: 0, metersPerPx: 1 };
    expect(reproject(carried, { x: 1, y: 1 }, 0)).toEqual([]);
  });
});
