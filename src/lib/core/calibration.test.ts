import { describe, expect, it } from "vitest";

import {
  cellFromClicks,
  checkDistanceM,
  fitsViewport,
  looksTenTimesOff,
  maxCellPx,
  metersOnScreen,
  metersPerPx,
  nudgeCell,
  wheelFactor,
} from "./calibration";
import { MIN_CELL_PX, STEP_COARSE, STEP_FINE } from "./constants";
import type { GridScale, Viewport } from "./types";

const viewport: Viewport = { w: 2048, h: 1151.2, scale: 1.25 };
const small: GridScale = { cellMeters: 100, cellPx: 170, origin: { x: 10, y: 20 } };

describe("cellFromClicks", () => {
  it("takes the larger axis offset, so a slightly diagonal click still gives one cell", () => {
    expect(cellFromClicks({ x: 100, y: 100 }, { x: 270, y: 103 })).toBe(170);
    expect(cellFromClicks({ x: 100, y: 100 }, { x: 98, y: -70 })).toBe(170);
  });
});

describe("wheelFactor", () => {
  it("grows the cell away from the player and shrinks it towards", () => {
    expect(wheelFactor(-100, 0, false)).toBe(STEP_COARSE);
    expect(wheelFactor(100, 0, false)).toBeCloseTo(1 / STEP_COARSE);
    expect(wheelFactor(-100, 0, true)).toBe(STEP_FINE);
  });

  it("reads the horizontal axis that Chromium uses for Shift+wheel", () => {
    expect(wheelFactor(0, -100, true)).toBe(STEP_FINE);
    expect(wheelFactor(0, 0, false)).toBe(1);
  });
});

describe("nudgeCell", () => {
  it("stays between the minimum cell and the screen size", () => {
    expect(nudgeCell(MIN_CELL_PX, 0.5, viewport)).toBe(MIN_CELL_PX);
    expect(nudgeCell(2040, 2, viewport)).toBe(maxCellPx(viewport));
    expect(nudgeCell(100, STEP_COARSE, viewport)).toBeCloseTo(102);
  });
});

describe("screen size and the 10× check", () => {
  it("converts the viewport to metres", () => {
    const { w, h } = metersOnScreen(small, viewport);
    expect(w).toBeCloseTo((2048 * 100) / 170);
    expect(h).toBeCloseTo((1151.2 * 100) / 170);
  });

  it("flags a zoomed-in scale that shows kilometres, and a zoomed-out one that shows less", () => {
    expect(looksTenTimesOff("near", small, viewport)).toBe(false); // ≈ 677 m high
    expect(looksTenTimesOff("near", { ...small, cellMeters: 1000 }, viewport)).toBe(true); // ≈ 6.8 km
    expect(looksTenTimesOff("far", { ...small, cellMeters: 1000 }, viewport)).toBe(false);
    expect(looksTenTimesOff("far", small, viewport)).toBe(true);
  });

  it("tells the expected answer of the 3-cell check", () => {
    expect(checkDistanceM(small)).toBe(300);
    expect(checkDistanceM({ ...small, cellMeters: 1000 })).toBe(3000);
  });
});

describe("fitsViewport", () => {
  it("accepts a saved scale for the same overlay size within 1 px", () => {
    expect(fitsViewport({ w: 2048.4, h: 1151.2, scale: 1.25 }, viewport)).toBe(true);
  });

  it("rejects another resolution or Windows scale", () => {
    expect(fitsViewport({ w: 1920, h: 1079, scale: 1.25 }, viewport)).toBe(false);
    expect(fitsViewport({ w: 2048, h: 1151.2, scale: 1.5 }, viewport)).toBe(false);
  });
});
