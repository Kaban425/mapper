// Mortar sight value for a target at horizontal distance L and height difference Δh
// (target higher is positive). Drag-free lob trajectory, as in PUBGMortar.NET
// (MortarCalculator.cs); the algebra is checked, the match with the game is not (G-2).

import { BETA_EPS, MORTAR_MAX_M, MORTAR_MIN_M } from "./constants";
import type { MortarSolution } from "./types";

const outOfRange = (meters: number): MortarSolution | null => {
  if (meters < MORTAR_MIN_M) return { status: "tooClose", sightM: null };
  if (meters > MORTAR_MAX_M) return { status: "tooFar", sightM: null };
  return null;
};

/**
 * t = Δh / L; flat ground (|t| < 0.001) gives R = L. Otherwise δ = M² − 2·L·M·t − L²;
 * δ < 0 means the target cannot be reached; R = (L + t·(M − √δ)) / (t² + 1).
 * The sight only covers 121–700 m, so both L and R must be in that range.
 */
export function solveMortar(distanceM: number, dhM: number): MortarSolution {
  // Zero (two clicks on one spot) is simply closer than 121 m, not "too high".
  if (!Number.isFinite(distanceM) || !Number.isFinite(dhM) || distanceM < 0) {
    return { status: "noSolution", sightM: null };
  }
  const tooFarOrClose = outOfRange(distanceM);
  if (tooFarOrClose) return tooFarOrClose;
  const t = dhM / distanceM;
  if (Math.abs(t) < BETA_EPS) return { status: "ok", sightM: distanceM };
  const m = MORTAR_MAX_M;
  const delta = m * m - 2 * distanceM * m * t - distanceM * distanceM;
  if (delta < 0) return { status: "noSolution", sightM: null };
  const sight = (distanceM + t * (m - Math.sqrt(delta))) / (t * t + 1);
  return outOfRange(sight) ?? { status: "ok", sightM: sight };
}
