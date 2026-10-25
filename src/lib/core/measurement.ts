// Lengths of a route of points, tick marks along its segments and the error estimate.

import { ALIGN_ERROR_PX, CLICK_ERROR_PX, GRID_MAJOR_M, GRID_MINOR_M, MIN_TICK_SPACING_PX } from "./constants";
import { metersPerPx } from "./calibration";
import type { GridScale, Point, Viewport } from "./types";

export const segmentPx = (a: Point, b: Point): number => Math.hypot(b.x - a.x, b.y - a.y);

export function routePx(points: readonly Point[]): number {
  let px = 0;
  for (let i = 1; i < points.length; i += 1) px += segmentPx(points[i - 1]!, points[i]!);
  return px;
}

export function segmentsMeters(points: readonly Point[], scale: GridScale): number[] {
  const mpp = metersPerPx(scale);
  return points.slice(1).map((p, i) => segmentPx(points[i]!, p) * mpp);
}

/**
 * Error of a measured route, in metres (plan/eng.md §5):
 * every segment end is a click (±1.5 px, √2 for two ends, √n for n segments), and the scale
 * itself is off by at most 0.5 px over the span the lines were compared on (whole cells,
 * up to 90 % of the screen width).
 */
export function errorMeters(points: readonly Point[], scale: GridScale, viewport: Viewport): number {
  const segments = points.length - 1;
  if (segments < 1) return 0;
  const mpp = metersPerPx(scale);
  const click = CLICK_ERROR_PX * Math.SQRT2 * Math.sqrt(segments) * mpp;
  const span = Math.max(scale.cellPx, Math.floor((viewport.w * 0.9) / scale.cellPx) * scale.cellPx);
  return click + routePx(points) * mpp * (ALIGN_ERROR_PX / span);
}

export interface Tick {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  readonly major: boolean;
}

/** Ticks every 100 m (long ones every 1 km); only 1 km ticks if 100 m are closer than 6 px. */
export function ticks(a: Point, b: Point, scale: GridScale): Tick[] {
  const mpp = metersPerPx(scale);
  const lengthPx = segmentPx(a, b);
  const tickMeters = GRID_MINOR_M / mpp >= MIN_TICK_SPACING_PX ? GRID_MINOR_M : GRID_MAJOR_M;
  const stepPx = tickMeters / mpp;
  if (lengthPx < 1 || stepPx < MIN_TICK_SPACING_PX) return [];
  const ux = (b.x - a.x) / lengthPx;
  const uy = (b.y - a.y) / lengthPx;
  const result: Tick[] = [];
  for (let i = 1; i * stepPx < lengthPx; i += 1) {
    const major = tickMeters === GRID_MAJOR_M || i % 10 === 0;
    const half = major ? 9 : 5;
    const cx = a.x + ux * i * stepPx;
    const cy = a.y + uy * i * stepPx;
    result.push({ x1: cx + uy * half, y1: cy - ux * half, x2: cx - uy * half, y2: cy + ux * half, major });
  }
  return result;
}
