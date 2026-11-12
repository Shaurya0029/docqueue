import { usePreferences } from "./preferences";
import { HI } from "./i18n.hi";

export type Vars = Record<string, string | number>;

const fill = (s: string, vars?: Vars) => (vars ? s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`)) : s);

/** Translate an English UI string. English text is the key; untranslated strings fall back to English. */
export function translate(lang: "en" | "hi", text: string, vars?: Vars) {
  return fill(lang === "hi" ? (HI[text] ?? text) : text, vars);
}

/**
 * Marks an English string stored in a constant (a menu label, a status name)
 * as translatable, so scripts/check-i18n.mjs can check it has Hindi. It
 * returns the string unchanged; translate it with t() where it is shown.
 */
export const msg = (text: string): string => text;

export function useT() {
  const { appearance } = usePreferences();
  return (text: string, vars?: Vars) => translate(appearance.lang, text, vars);
}
