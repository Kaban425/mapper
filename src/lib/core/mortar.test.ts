import fc from "fast-check";
import { describe, expect, it } from "vitest";

import golden from "../../../tests/golden/mortar.json";
import { MORTAR_MAX_M, MORTAR_MIN_M } from "./constants";
import { solveMortar } from "./mortar";

describe("solveMortar", () => {
  it("matches the worked example: 400 m, target 35 m higher → about 412 m", () => {
    const { status, sightM } = solveMortar(400, 35);
    expect(status).toBe("ok");
    expect(sightM).toBeCloseTo(411.7, 1);
  });

  it.each(golden.cases)("golden: L=$distanceM Δh=$dhM → $status $sightM", ({ distanceM, dhM, status, sightM }) => {
    const result = solveMortar(distanceM, dhM);
    expect(result.status).toBe(status);
    if (sightM === null) expect(result.sightM).toBeNull();
    else expect(result.sightM).toBeCloseTo(sightM, 2);
  });

  it("refuses targets outside the 121–700 m range", () => {
    expect(solveMortar(120, 0).status).toBe("tooClose");
    expect(solveMortar(701, 0).status).toBe("tooFar");
    expect(solveMortar(MORTAR_MIN_M, 0)).toEqual({ status: "ok", sightM: MORTAR_MIN_M });
    expect(solveMortar(MORTAR_MAX_M, 0)).toEqual({ status: "ok", sightM: MORTAR_MAX_M });
  });

  it("refuses a sight value the mortar cannot set, even when the distance is in range", () => {
    // 125 m to a target 50 m lower needs a sight below 121 m. (Above 700 m cannot happen:
    // for L ≤ M every solvable shot has R ≤ 2·L·M² / (M² + L²) ≤ M.)
    expect(solveMortar(125, -50).status).toBe("tooClose");
  });

  it("reports no solution when the target is too high to reach", () => {
    expect(solveMortar(600, 400)).toEqual({ status: "noSolution", sightM: null });
  });

  it("rejects non-finite or non-positive input", () => {
    expect(solveMortar(Number.NaN, 0).status).toBe("noSolution");
    expect(solveMortar(300, Number.POSITIVE_INFINITY).status).toBe("noSolution");
    expect(solveMortar(-1, 0).status).toBe("noSolution");
    expect(solveMortar(0, 0).status).toBe("tooClose");
    expect(solveMortar(0, 35).status).toBe("tooClose");
  });

  it("flat ground gives the distance itself", () => {
    fc.assert(
      fc.property(fc.double({ min: MORTAR_MIN_M, max: MORTAR_MAX_M, noNaN: true }), (distance) => {
        expect(solveMortar(distance, 0)).toEqual({ status: "ok", sightM: distance });
      }),
    );
  });

  it("a higher target always needs a longer sight value", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 150, max: 600 }),
        fc.integer({ min: -100, max: 60 }),
        fc.integer({ min: 1, max: 30 }),
        (distance, dh, more) => {
          const low = solveMortar(distance, dh);
          const high = solveMortar(distance, dh + more);
          if (low.sightM !== null && high.sightM !== null) expect(high.sightM).toBeGreaterThan(low.sightM);
        },
      ),
    );
  });
});
