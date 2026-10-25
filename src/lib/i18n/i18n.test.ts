import { describe, expect, it } from "vitest";

import { dictionaries, t, type Key } from "./index";
import type { Entry } from "./types";

const placeholders = (entry: Entry): string[] => {
  const texts = typeof entry === "string" ? [entry] : Object.values(entry);
  return [...new Set(texts.flatMap((text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!)))].sort();
};

const keys = Object.keys(dictionaries.ru) as Key[];

describe("dictionaries", () => {
  it("have the same keys", () => {
    expect(Object.keys(dictionaries.en).sort()).toEqual([...keys].sort());
  });

  it.each(keys)("%s has the same placeholders in both languages and no empty text", (key) => {
    expect(placeholders(dictionaries.en[key])).toEqual(placeholders(dictionaries.ru[key]));
    for (const lang of ["ru", "en"] as const) {
      const entry = dictionaries[lang][key];
      const texts = typeof entry === "string" ? [entry] : Object.values(entry);
      expect(texts.every((text) => text.trim().length > 0)).toBe(true);
    }
  });

  it("Russian plurals cover one, few and many", () => {
    for (const key of keys) {
      const entry = dictionaries.ru[key];
      if (typeof entry !== "string") expect(Object.keys(entry).sort()).toEqual(["few", "many", "one", "other"]);
    }
  });
});

describe("t", () => {
  it("fills placeholders and leaves unknown ones visible", () => {
    expect(t("ru", "hud.routeKept.body", { hotkey: "Alt+W" })).toBe("Смени зум и нажми Alt+W");
    expect(t("en", "hud.routeKept.body")).toBe("Change the zoom and press {hotkey}");
  });

  it("picks plural forms", () => {
    expect(t("ru", "hud.segments", { n: 1 })).toBe("1 отрезок");
    expect(t("ru", "hud.segments", { n: 3 })).toBe("3 отрезка");
    expect(t("ru", "hud.segments", { n: 5 })).toBe("5 отрезков");
    expect(t("ru", "hud.segments", { n: 21 })).toBe("21 отрезок");
    expect(t("en", "hud.segments", { n: 1 })).toBe("1 segment");
    expect(t("en", "hud.segments", { n: 2 })).toBe("2 segments");
  });
});
