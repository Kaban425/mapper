// Numbers for people (plan/ux.md §2.4): RU "1 240 м" with a narrow no-break space, "6,3 м/с";
// EN "1,240 m", "6.3 m/s". Times are m:ss (h:mm:ss from an hour) and always approximate.

import type { Language } from "./types";

const LOCALES: Record<Language, string> = { ru: "ru-RU", en: "en-US" };
const UNITS: Record<Language, { m: string; mps: string; kmh: string; px: string }> = {
  ru: { m: "м", mps: "м/с", kmh: "км/ч", px: "px" },
  en: { m: "m", mps: "m/s", kmh: "km/h", px: "px" },
};
const NBSP = " ";
const NARROW_NBSP = " ";
const MINUS = "−";

const formatters = new Map<string, Intl.NumberFormat>();

function formatter(lang: Language, digits: number): Intl.NumberFormat {
  const key = `${lang}:${digits}`;
  let found = formatters.get(key);
  if (!found) {
    found = new Intl.NumberFormat(LOCALES[lang], { minimumFractionDigits: digits, maximumFractionDigits: digits });
    formatters.set(key, found);
  }
  return found;
}

export function formatNumber(value: number, lang: Language, digits = 0): string {
  const text = formatter(lang, digits).format(value);
  // ru-RU groups with U+00A0 (and some runtimes with U+202F); the design asks for U+202F.
  return (lang === "ru" ? text.replace(/[   ]/g, NARROW_NBSP) : text).replace("-", MINUS);
}

export const meterUnit = (lang: Language): string => UNITS[lang].m;

export const formatMeters = (meters: number, lang: Language): string =>
  `${formatNumber(Math.round(meters), lang)}${NBSP}${UNITS[lang].m}`;

/** "± 3 м": never below 1 m, a ruler is not that precise. */
export const formatError = (meters: number, lang: Language): string =>
  `±${NBSP}${formatNumber(Math.max(1, Math.round(meters)), lang)}${NBSP}${UNITS[lang].m}`;

/** "+35 м", "−12 м", "+0 м". */
export function formatSignedMeters(meters: number, lang: Language): string {
  const rounded = Math.round(meters);
  const sign = rounded < 0 ? MINUS : "+";
  return `${sign}${formatNumber(Math.abs(rounded), lang)}${NBSP}${UNITS[lang].m}`;
}

export const formatSpeedMps = (mps: number, lang: Language): string =>
  `${formatNumber(mps, lang, 1)}${NBSP}${UNITS[lang].mps}`;

export const formatSpeedKmh = (kmh: number, lang: Language): string =>
  `${formatNumber(Math.round(kmh), lang)}${NBSP}${UNITS[lang].kmh}`;

export const formatPx = (px: number, lang: Language): string =>
  `${formatNumber(px, lang, 1)}${NBSP}${UNITS[lang].px}`;

/** "1:35", "1:02:07"; the caller adds "≈". */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}
