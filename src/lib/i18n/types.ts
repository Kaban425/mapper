// Dictionary entries: a plain string, or plural forms chosen by Intl.PluralRules on `{n}`.

export interface Plural {
  readonly one?: string;
  readonly few?: string;
  readonly many?: string;
  readonly other: string;
}

export type Entry = string | Plural;
