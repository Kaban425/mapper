// Carrying a route across a zoom change. Mapper cannot see the map, so after the zoom the
// player clicks where the route's first point is now; the rest follows from the ratio of
// the two calibrated scales. Only the player's clicks are used.

import { metersPerPx } from "./calibration";
import type { GridScale, Point, Preset } from "./types";

/** How long a parked route waits for the other zoom (the player zooms the map meanwhile). */
export const CARRY_MS = 120_000;

export interface Carried {
  /** The zoom the route was measured on. */
  readonly preset: Preset;
  /** Monitor key (`2560x1440@125`): on another monitor the points cannot go back in place. */
  readonly monitor: string;
  readonly points: readonly Point[];
  readonly dhM: number;
  readonly metersPerPx: number;
}

export function carryRoute(
  preset: Preset,
  monitor: string,
  points: readonly Point[],
  dhM: number,
  scale: GridScale,
): Carried | null {
  return points.length > 0 ? { preset, monitor, points, dhM, metersPerPx: metersPerPx(scale) } : null;
}

/** The route with its first point at `first`, drawn in a scale of `nowMetersPerPx`. */
export function reproject(carried: Carried, first: Point, nowMetersPerPx: number): Point[] {
  const ratio = carried.metersPerPx / nowMetersPerPx;
  const origin = carried.points[0];
  if (!origin || !(ratio > 0) || !Number.isFinite(ratio)) return [];
  return carried.points.map((p) => ({ x: first.x + (p.x - origin.x) * ratio, y: first.y + (p.y - origin.y) * ratio }));
}
