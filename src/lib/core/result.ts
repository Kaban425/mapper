// One measurement as numbers: what the panel shows, Rust stores and the HUD prints.

import { errorMeters, segmentsMeters } from "./measurement";
import { solveMortar } from "./mortar";
import { kmhToMps, travelSeconds } from "./travel";
import type { GridScale, MeasurementResult, MortarSolution, Point, Preset, Speeds, Viewport } from "./types";

export interface ResultInput {
  readonly preset: Preset;
  readonly points: readonly Point[];
  readonly scale: GridScale;
  readonly viewport: Viewport;
  readonly dhM: number;
  readonly speeds: Speeds;
}

const NOT_APPLICABLE: MortarSolution = { status: "notApplicable", sightM: null };

/** Null until there are two points. The mortar needs exactly two: mortar, then target. */
export function buildResult({ preset, points, scale, viewport, dhM, speeds }: ResultInput): MeasurementResult | null {
  if (points.length < 2) return null;
  const segmentsM = segmentsMeters(points, scale);
  const totalM = segmentsM.reduce((sum, m) => sum + m, 0);
  return {
    preset,
    totalM,
    errorM: errorMeters(points, scale, viewport),
    segmentsM,
    dhM,
    mortar: points.length === 2 ? solveMortar(totalM, dhM) : NOT_APPLICABLE,
    travel: {
      sprintS: travelSeconds(totalM, speeds.sprintMps),
      daciaS: travelSeconds(totalM, kmhToMps(speeds.daciaKmh)),
      daciaVerified: speeds.daciaVerified,
    },
  };
}
