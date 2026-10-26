// What the overlay panels say, as pure functions of the session (tested without a DOM).

import { checkDistanceM, looksTenTimesOff, metersOnScreen, metersPerPx } from "../../lib/core/calibration";
import { MORTAR_DH_EXPERIMENTAL, PANEL_AVOID_PX } from "../../lib/core/constants";
import { formatDuration, formatMeters, formatPx, formatSpeedKmh, formatSpeedMps } from "../../lib/core/format";
import { segmentPx } from "../../lib/core/measurement";
import { currentResult, type Draft, type Session } from "../../lib/core/session";
import type { Language, MeasurementResult, Point } from "../../lib/core/types";
import { t } from "../../lib/i18n";
import { cellsLabel, dhValue, distanceText, mortarLine, presetName, segmentsLine, type Line } from "../../lib/view/result";

export { distanceText, mortarLine, presetName, segmentsLine, type Line };

/** Distance from the last point to the cursor while placing the next one. */
export function liveMeters(s: Session): number | null {
  const scale = s.scales[s.preset];
  const last = s.points[s.points.length - 1];
  if (!scale || !last || !s.cursor || s.mode !== "measure") return null;
  return segmentPx(last, s.cursor) * metersPerPx(scale);
}

export function dhLine(lang: Language, dhM: number): string {
  const value = dhValue(lang, dhM);
  if (dhM === 0) return value;
  const tail = `${t(lang, dhM > 0 ? "ov.dh.up" : "ov.dh.down")}${MORTAR_DH_EXPERIMENTAL ? ` · ${t(lang, "ov.mortar.experimental")}` : ""}`;
  return `${value} — ${tail}`;
}


/** One row of the travel table: label · ≈ time · speed (and a note under the speed). */
export interface TravelRow {
  readonly label: string;
  readonly time: string;
  readonly speed: string;
  readonly note: string | null;
}

export function travelRows(lang: Language, result: MeasurementResult, sprintMps: number, daciaKmh: number): TravelRow[] {
  const { sprintS, daciaS, daciaVerified } = result.travel;
  return [
    { label: t(lang, "ov.run"), time: `≈ ${formatDuration(sprintS)}`, speed: formatSpeedMps(sprintMps, lang), note: null },
    {
      label: t(lang, "ov.dacia"),
      time: `≈ ${formatDuration(daciaS)}`,
      speed: formatSpeedKmh(daciaKmh, lang),
      note: daciaVerified ? null : t(lang, "ov.unverified"),
    },
  ];
}

export { currentResult };

/** Step 3: the cell size the next click would give, from the origin to the cursor. */
export function liveCellPx(draft: Draft, cursor: Point | null): number | null {
  if (draft.stage !== "neighbour" || !draft.origin || !cursor) return null;
  return Math.max(Math.abs(cursor.x - draft.origin.x), Math.abs(cursor.y - draft.origin.y));
}

/** Step 4: "cell 100 m = 170.1 px · on screen 1,204 × 677 m", and whether it looks 10× off. */
export function fineScale(lang: Language, s: Session): { text: string; tenX: boolean } | null {
  const d = s.draft;
  if (!d || d.stage !== "fine" || d.cellMeters === null || d.cellPx === null || d.origin === null) return null;
  const scale = { cellMeters: d.cellMeters, cellPx: d.cellPx, origin: d.origin };
  const screen = metersOnScreen(scale, s.viewport);
  const text = t(lang, "cal.step4.scale", {
    cells: cellsLabel(lang, d.cellMeters),
    px: formatPx(d.cellPx, lang),
    w: formatMeters(screen.w, lang),
    h: formatMeters(screen.h, lang),
  });
  return { text, tenX: looksTenTimesOff(s.preset, scale, s.viewport) };
}

export function verifyLine(lang: Language, s: Session): string | null {
  const scale = s.scales[s.preset];
  return s.verifyPending && scale ? t(lang, "cal.verify", { m: formatMeters(checkDistanceM(scale), lang) }) : null;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

const near = (p: Point, r: Rect): boolean =>
  p.x > r.x - PANEL_AVOID_PX && p.x < r.x + r.w + PANEL_AVOID_PX && p.y > r.y - PANEL_AVOID_PX && p.y < r.y + r.h + PANEL_AVOID_PX;

/**
 * The measuring panel sits top-left and moves to the top-right corner while the cursor or a
 * point comes within 32 px of it; it comes back once that corner is free again.
 */
export function panelSide(left: Rect, right: Rect, cursor: Point | null, points: readonly Point[]): "left" | "right" {
  const blocks = (r: Rect) => (cursor !== null && near(cursor, r)) || points.some((p) => near(p, r));
  if (!blocks(left)) return "left";
  return blocks(right) ? "left" : "right";
}
