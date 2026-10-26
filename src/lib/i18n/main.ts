// The main window's own dictionary and `tm()`: same rules as `t()`, separate so the overlay
// and the HUD never load these texts.

import type { Language } from "../core/types";
import { render, type Params } from "./index";
import { mainEn } from "./main.en";
import { mainRu } from "./main.ru";
import type { Entry } from "./types";

export type MainKey = keyof typeof mainRu;

export const mainDictionaries: Readonly<Record<Language, Readonly<Record<MainKey, Entry>>>> = { ru: mainRu, en: mainEn };

export const tm = (lang: Language, key: MainKey, params: Params = {}): string =>
  render(mainDictionaries[lang][key], lang, params);
