// Result texts shared by the overlay panel and the HUD, built from numbers in the reader's
// language (no text travels between windows).

import { formatError, formatMeters, formatNumber, formatSignedMeters, meterUnit } from "../core/format";
import type { CellMeters, Language, MeasurementResult, MortarStatus, Preset } from "../core/types";
import { t, type Key } from "../i18n";

export interface Line {
  readonly text: string;
  readonly warn?: boolean;
}

export const presetName = (lang: Language, preset: Preset): string => t(lang, preset === "near" ? "preset.near" : "preset.far");

export const cellsLabel = (lang: Language, cells: CellMeters): string => t(lang, cells === 1000 ? "cells.big" : "cells.small");

const MORTAR_KEYS: Record<Exclude<MortarStatus, "ok">, Key> = {
  tooClose: "ov.mortar.tooClose",
  tooFar: "ov.mortar.tooFar",
  noSolution: "ov.mortar.noSolution",
  notApplicable: "ov.mortar.onlyTwo",
};

/** "Миномёт 424 м", or why there is no value (a warning unless it is just a route). */
export function mortarLine(lang: Language, result: MeasurementResult): Line {
  const { status, sightM } = result.mortar;
  const label = t(lang, "ov.mortar");
  if (status === "ok" && sightM !== null) return { text: `${label} ${formatMeters(sightM, lang)}` };
  const reason = t(lang, MORTAR_KEYS[status === "ok" ? "noSolution" : status]);
  return { text: `${label} — ${reason}`, warn: status !== "notApplicable" };
}

export const distanceText = (lang: Language, result: MeasurementResult): { value: string; error: string } => ({
  value: formatMeters(result.totalM, lang),
  error: formatError(result.errorM, lang),
});

export const dhValue = (lang: Language, dhM: number): string => `${t(lang, "ov.dh")} ${formatSignedMeters(dhM, lang)}`;

/** "2 отрезка: 640 + 600 м" for a route; nothing for a single distance. */
export function segmentsLine(lang: Language, result: MeasurementResult): string | null {
  const n = result.segmentsM.length;
  if (n < 2) return null;
  const numbers = result.segmentsM.map((m) => formatNumber(Math.round(m), lang));
  return t(lang, "ov.segments", { n, list: `${numbers.join(" + ")} ${meterUnit(lang)}` });
}
