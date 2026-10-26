// What the main window says, as pure functions of the snapshot (tested without a DOM).

import { looksTenTimesOff, metersOnScreen } from "../../lib/core/calibration";
import { formatDuration, formatMeters, formatNumber, formatPx } from "../../lib/core/format";
import type { GridScale, Language, Preset, Viewport } from "../../lib/core/types";
import { tm } from "../../lib/i18n/main";
import type { AppSnapshot, Calibration, LastMeasurement, MonitorScales } from "../../lib/ipc/types";
import { cellsLabel, distanceText, mortarLine, presetName, segmentsLine } from "../../lib/view/result";

export const PRESETS: readonly Preset[] = ["near", "far"];

const grid = (c: Calibration): GridScale => ({ cellMeters: c.cellMeters, cellPx: c.cellPx, origin: c.origin });
const viewport = (c: Calibration): Viewport => ({ w: c.w, h: c.h, scale: c.scale });

/** The monitor the Home cards describe first: the pinned one, else the main one. */
export function defaultMonitorKey(s: AppSnapshot): string | null {
  const shown = s.displays.find((d) => d.pinned) ?? s.displays.find((d) => d.primary) ?? s.displays[0];
  return shown?.key ?? s.scales[0]?.key ?? null;
}

export const scalesFor = (s: AppSnapshot, key: string | null): MonitorScales | null =>
  s.scales.find((m) => m.key === key) ?? null;

/** "2560×1440 · 125 % · основной · закреплён". */
export function monitorOption(lang: Language, m: MonitorScales, pinned = false): string {
  const tags = [
    m.primary ? tm(lang, "home.monitor.primary") : null,
    pinned ? tm(lang, "home.monitor.pinned") : null,
    m.connected ? null : tm(lang, "home.monitor.unplugged"),
  ];
  return [m.label, ...tags.filter((tag) => tag !== null)].join(" · ");
}

/** "На экране 1 204 × 677 м". */
export function visibleText(lang: Language, c: Calibration): string {
  const seen = metersOnScreen(grid(c), viewport(c));
  return tm(lang, "status.visible", { w: formatNumber(Math.round(seen.w), lang), h: formatMeters(seen.h, lang) });
}

/** "Клетка 100 м = 170,1 px". */
export const cellText = (lang: Language, c: Calibration): string =>
  tm(lang, "home.cell", { cells: cellsLabel(lang, c.cellMeters), px: formatPx(c.cellPx, lang) });

export const tenTimesOff = (preset: Preset, c: Calibration): boolean => looksTenTimesOff(preset, grid(c), viewport(c));

export type CardState =
  /** "Recalibrate" was pressed: the next press of the hotkey opens the setup. */
  | { readonly kind: "armed" }
  | { readonly kind: "ready"; readonly calibration: Calibration; readonly tenX: boolean }
  /** `kept`: another monitor key has a scale for this preset (it comes back with that resolution). */
  | { readonly kind: "notSet"; readonly kept: string | null };

export function cardState(s: AppSnapshot, key: string | null, preset: Preset): CardState {
  if (s.armed === preset) return { kind: "armed" };
  const calibration = scalesFor(s, key)?.[preset] ?? null;
  if (calibration) return { kind: "ready", calibration, tenX: tenTimesOff(preset, calibration) };
  const kept = s.scales.find((m) => m.key !== key && m[preset] !== null);
  return { kind: "notSet", kept: kept?.label ?? null };
}

export type WizardStatus =
  | { readonly kind: "busy" }
  | { readonly kind: "calibrating" }
  | { readonly kind: "ready"; readonly label: string; readonly calibration: Calibration; readonly tenX: boolean }
  | { readonly kind: "waiting" };

/**
 * Wizard step 4, per preset: the player may set it up on any connected monitor, so the newest
 * scale of a connected one counts. An open setup of this preset wins over an older scale.
 */
export function wizardStatus(s: AppSnapshot, preset: Preset): WizardStatus {
  if (s.hotkeys[preset].error === "busy") return { kind: "busy" };
  if (s.overlay?.preset === preset && s.overlay.start === "calibrate") return { kind: "calibrating" };
  const newest = s.scales
    .filter((m) => m.connected && m[preset] !== null)
    .map((m) => ({ label: m.label, calibration: m[preset]! }))
    .sort((a, b) => b.calibration.createdAt.localeCompare(a.calibration.createdAt))[0];
  if (!newest) return { kind: "waiting" };
  return { kind: "ready", ...newest, tenX: tenTimesOff(preset, newest.calibration) };
}

export const wizardReady = (s: AppSnapshot): boolean => PRESETS.every((p) => wizardStatus(s, p).kind === "ready");

export interface LastLines {
  readonly meta: string;
  /** For Narrator: "1240 метров, плюс-минус 2 метра" (plan/ux.md §7). */
  readonly spoken: string;
  readonly value: string;
  readonly error: string;
  readonly segments: string | null;
  readonly travel: string;
  readonly mortar: string;
  readonly mortarWarn: boolean;
}

const LOCALES: Record<Language, string> = { ru: "ru-RU", en: "en-GB" };

/** "Последний замер · 14:32 · ПРИБЛИЖЕНО", "1 240 м ± 2 м", "Бегом ≈ 3:17 · Dacia ≈ 0:37", the mortar line. */
export function lastLines(lang: Language, last: LastMeasurement): LastLines {
  const { result } = last;
  const time = new Intl.DateTimeFormat(LOCALES[lang], { hour: "2-digit", minute: "2-digit" }).format(new Date(last.at));
  const distance = distanceText(lang, result);
  const mortar = mortarLine(lang, result);
  return {
    meta: tm(lang, "home.last.meta", { time, preset: presetName(lang, result.preset).toLocaleUpperCase(LOCALES[lang]) }),
    spoken: tm(lang, "home.last.spoken", {
      distance: tm(lang, "spoken.meters", { n: Math.round(result.totalM) }),
      error: tm(lang, "spoken.meters", { n: Math.max(1, Math.round(result.errorM)) }),
    }),
    value: distance.value,
    error: distance.error,
    segments: segmentsLine(lang, result),
    travel: tm(lang, "home.last.travel", { run: formatDuration(result.travel.sprintS), dacia: formatDuration(result.travel.daciaS) }),
    mortar: mortar.text,
    mortarWarn: mortar.warn ?? false,
  };
}

// Panel transparency: the slider shows 0–100 % of the allowed range, 0 % being the densest glass.
const OPACITY_MAX = 0.94;
const OPACITY_MIN = 0.5;

export const transparencyPercent = (opacity: number): number =>
  Math.round(((OPACITY_MAX - opacity) / (OPACITY_MAX - OPACITY_MIN)) * 100);

export const opacityFromPercent = (percent: number): number =>
  Math.round((OPACITY_MAX - (percent / 100) * (OPACITY_MAX - OPACITY_MIN)) * 1000) / 1000;
