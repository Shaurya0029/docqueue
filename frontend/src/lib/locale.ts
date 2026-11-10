/** Current UI language, readable outside React (formatters, date helpers). */
export type Lang = "en" | "hi";
let current: Lang = "en";
export const setLocale = (lang: Lang) => {
  current = lang;
};
export const getLang = () => current;
/** BCP-47 locale for Intl date/number formatting. */
export const intlLocale = () => (current === "hi" ? "hi-IN" : "en-IN");
