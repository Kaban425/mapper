// Grid matching: the player tells which cells they match, clicks an intersection and its
// neighbour, then fine-tunes with the wheel until the far lines sit on the map's lines.

import {
  MAX_CELL_PX,
  MIN_CELL_PX,
  STEP_COARSE,
  STEP_FINE,
  TEN_X_SCREEN_HEIGHT_M,
} from "./constants";
import type { GridScale, Point, Preset, Viewport } from "./types";

export const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/** Grid lines are axis-aligned, so the larger offset between two intersections is one cell. */
export function cellFromClicks(origin: Point, neighbour: Point): number {
  return Math.max(Math.abs(neighbour.x - origin.x), Math.abs(neighbour.y - origin.y));
}

/** The largest cell that still fits the screen (and the config's upper bound). */
export const maxCellPx = (viewport: Viewport): number => Math.min(MAX_CELL_PX, Math.max(viewport.w, viewport.h));

export function nudgeCell(cellPx: number, factor: number, viewport: Viewport): number {
  return clamp(cellPx * factor, MIN_CELL_PX, maxCellPx(viewport));
}

/**
 * Size factor for one wheel notch: away from the player grows the cell. Chromium turns
 * Shift+wheel into horizontal scrolling, so whichever axis moved counts.
 */
export function wheelFactor(deltaY: number, deltaX: number, fine: boolean): number {
  const delta = deltaY || deltaX;
  if (delta === 0) return 1;
  const step = fine ? STEP_FINE : STEP_COARSE;
  return delta < 0 ? step : 1 / step;
}

export const metersPerPx = (scale: GridScale): number => scale.cellMeters / scale.cellPx;

export function metersOnScreen(scale: GridScale, viewport: Viewport): { w: number; h: number } {
  const mpp = metersPerPx(scale);
  return { w: viewport.w * mpp, h: viewport.h * mpp };
}

/** A saved scale belongs to one overlay size and monitor scale (spike rule, ±1 CSS px). */
export function fitsViewport(saved: { w: number; h: number; scale: number }, viewport: Viewport): boolean {
  return (
    Math.abs(saved.w - viewport.w) < 1 && Math.abs(saved.h - viewport.h) < 1 && Math.abs(saved.scale - viewport.scale) < 0.005
  );
}

/**
 * The most common mistake is matching 1 km cells while saying 100 m (or the reverse): the
 * result is 10× off. Zoomed in all the way, the screen shows well under 3 km of map height.
 */
export function looksTenTimesOff(preset: Preset, scale: GridScale, viewport: Viewport): boolean {
  const height = metersOnScreen(scale, viewport).h;
  return preset === "near" ? height > TEN_X_SCREEN_HEIGHT_M : height < TEN_X_SCREEN_HEIGHT_M;
}

/** "Mark two intersections 3 cells apart": the expected answer for the matched cells. */
export const checkDistanceM = (scale: GridScale): number => 3 * scale.cellMeters;
