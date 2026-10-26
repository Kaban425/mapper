// `t(lang, key, params)`: `{name}` placeholders, plural forms on `{n}`. Each window gets its
// language from Rust (overlay and HUD in their payloads), so there is no global state here.

import type { Language } from "../core/types";
import { en } from "./en";
import { ru } from "./ru";
import type { Entry, Plural } from "./types";

export type Key = keyof typeof ru;
export type Params = Readonly<Record<string, string | number>>;

export const dictionaries: Readonly<Record<Language, Readonly<Record<Key, Entry>>>> = { ru, en };

const LOCALES: Record<Language, string> = { ru: "ru-RU", en: "en-US" };
const pluralRules = new Map<Language, Intl.PluralRules>();

function pluralForm(lang: Language, entry: Plural, n: number): string {
  let rules = pluralRules.get(lang);
  if (!rules) {
    rules = new Intl.PluralRules(LOCALES[lang]);
    pluralRules.set(lang, rules);
  }
  const category = rules.select(n) as keyof Plural;
  return entry[category] ?? entry.other;
}

/** One entry in `lang`: the plural form for `{n}`, then the placeholders filled in. */
export function render(entry: Entry, lang: Language, params: Params = {}): string {
  const text = typeof entry === "string" ? entry : pluralForm(lang, entry, Number(params.n ?? 0));
  return text.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match));
}

export function t(lang: Language, key: Key, params: Params = {}): string {
  return render(dictionaries[lang][key], lang, params);
}

/** A translator bound to one language, for components. */
export const translator =
  (lang: Language) =>
  (key: Key, params?: Params): string =>
    t(lang, key, params);
