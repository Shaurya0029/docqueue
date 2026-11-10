/*
 * MEDORA theming engine.
 *
 * Every colour utility (bg-brand-600, text-slate-500, …) reads a CSS variable
 * holding an "r g b" triplet. This file computes those variables for each
 * colour theme × light/dark mode. Text gets its own ramp (`--t-*`) so that in
 * dark mode text-brand-600 can be a light, readable blue while bg-brand-600
 * stays a saturated button colour that white text reads well on.
 */

export const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;
type Shade = (typeof SHADES)[number];
type Ramp = Record<Shade, string>;

export type ThemeId = "blue" | "teal" | "violet" | "rose";
export type Mode = "light" | "dark";

export const THEMES: Record<ThemeId, { label: string; ramp: Ramp }> = {
  blue: {
    label: "MEDORA Blue",
    ramp: { 50: "#F4F7FF", 100: "#E6EDFF", 200: "#CCDBFF", 300: "#A3C0FF", 400: "#78A6FF", 500: "#4779F5", 600: "#3157D5", 700: "#2745B0", 800: "#213A8C", 900: "#1E336F", 950: "#141F45" },
  },
  teal: {
    label: "Mint Teal",
    ramp: { 50: "#EFFCF9", 100: "#D2F6EE", 200: "#A6ECDD", 300: "#6DDCC6", 400: "#34C3AB", 500: "#14A08A", 600: "#0C7A6C", 700: "#0E675D", 800: "#10534C", 900: "#11443F", 950: "#032825" },
  },
  violet: {
    label: "Royal Violet",
    ramp: { 50: "#F6F3FF", 100: "#EDE7FF", 200: "#DCD1FF", 300: "#C2AEFF", 400: "#A283FB", 500: "#8B5CF6", 600: "#7340E0", 700: "#6230C2", 800: "#51289E", 900: "#432481", 950: "#2A1457" },
  },
  rose: {
    label: "Coral Rose",
    ramp: { 50: "#FFF2F3", 100: "#FFE1E4", 200: "#FFC7CE", 300: "#FE9CAA", 400: "#FA6680", 500: "#EE3B5E", 600: "#D11F48", 700: "#B0163C", 800: "#931638", 900: "#7E1735", 950: "#470718" },
  },
};

const LAVENDER: Ramp = { 50: "#F6F5FF", 100: "#E9E7FF", 200: "#D6D2FF", 300: "#B9B1FF", 400: "#988BF8", 500: "#7C6CEE", 600: "#6753DD", 700: "#5642BE", 800: "#46379A", 900: "#3A317B", 950: "#251F52" };
const AMBER: Ramp = { 50: "#FFFBEB", 100: "#FEF3C7", 200: "#FDE68A", 300: "#FCD34D", 400: "#FBBF24", 500: "#F59E0B", 600: "#D97706", 700: "#B45309", 800: "#92400E", 900: "#78350F", 950: "#451A03" };

const SLATE_LIGHT: Ramp = { 50: "#F4F7FF", 100: "#EDF1FA", 200: "#DFE5F2", 300: "#C6CFE2", 400: "#858FA6", 500: "#5F6D87", 600: "#4E5B75", 700: "#3A4762", 800: "#26314D", 900: "#17213B", 950: "#0E1528" };
// Inverted neutral ramp for dark mode: low shades are dark surfaces, high shades are light text.
const SLATE_DARK: Ramp = { 50: "#0B1120", 100: "#151E33", 200: "#222D45", 300: "#33405C", 400: "#6B7894", 500: "#9AA6BD", 600: "#B3BDCF", 700: "#CBD3E1", 800: "#DEE4EE", 900: "#EEF2F8", 950: "#F8FAFC" };

const LIGHT_BASE = { canvas: "#F4F7FF", surface: "#FFFFFF", ink: "#17213B", muted: "#5C6A84" };
const DARK_BASE = { canvas: "#0B1120", surface: "#121A2E", ink: "#EEF2F8", muted: "#9AA6BD" };

// Status colours, darkened slightly from the brief (#16A36A / #E05252) so white text and small text pass WCAG AA.
const STATUS = {
  light: { success: "#12855A", successText: "#0F7A50", successSoft: "#E3F6EC", danger: "#C93C3C", dangerText: "#C03636", dangerSoft: "#FDECEC" },
  dark: { success: "#12855A", successText: "#5BD69A", danger: "#C93C3C", dangerText: "#FF9B9B" },
};

/* ───────── colour maths ───────── */

const toRgb = (hex: string): [number, number, number] => {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
};
const toHex = (rgb: number[]) => "#" + rgb.map((c) => Math.round(c).toString(16).padStart(2, "0")).join("");
/** Mix colour `a` into `b` by `t` (0 → b, 1 → a). */
export const mix = (a: string, b: string, t: number) => {
  const [x, y] = [toRgb(a), toRgb(b)];
  return toHex(x.map((c, i) => c * t + y[i] * (1 - t)));
};
const triplet = (hex: string) => toRgb(hex).join(" ");

export function luminance(hex: string) {
  const [r, g, b] = toRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a: string, b: string) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (l1 + 0.05) / (l2 + 0.05);
}

/* ───────── ramps per mode ───────── */

/** Background ramp: light = palette; dark = low shades become tinted dark surfaces. */
function bgRamp(r: Ramp, mode: Mode, surface: string): Ramp {
  if (mode === "light") return r;
  return { ...r, 50: mix(r[500], surface, 0.14), 100: mix(r[500], surface, 0.22), 200: mix(r[500], surface, 0.34) };
}

/** Text ramp: light = palette; dark = mid/high shades become light so text stays readable on dark surfaces. */
function textRamp(r: Ramp, mode: Mode, surface: string): Ramp {
  if (mode === "light") return r;
  const bg = bgRamp(r, mode, surface);
  return { 50: bg[50], 100: bg[100], 200: r[200], 300: r[300], 400: r[300], 500: r[300], 600: r[300], 700: r[200], 800: r[100], 900: r[100], 950: r[50] };
}

export type ResolvedColors = Record<string, string>; // var name → hex

export function resolveColors(themeId: ThemeId, mode: Mode): ResolvedColors {
  const brand = THEMES[themeId].ramp;
  const base = mode === "light" ? LIGHT_BASE : DARK_BASE;
  const slate = mode === "light" ? SLATE_LIGHT : SLATE_DARK;
  const out: ResolvedColors = { ...base };

  const add = (name: string, r: Ramp) => {
    const b = bgRamp(r, mode, base.surface);
    const t = textRamp(r, mode, base.surface);
    for (const s of SHADES) {
      out[`c-${name}-${s}`] = b[s];
      out[`t-${name}-${s}`] = t[s];
    }
  };
  add("brand", brand);
  add("accent", LAVENDER);
  add("amber", AMBER);
  for (const s of SHADES) out[`c-slate-${s}`] = slate[s];

  // Gradient stops: identical in both modes so white-on-gradient text never changes.
  out["g1"] = brand[600];
  out["g2"] = brand[500];
  out["g3"] = mix(brand[400], brand[500], 0.45);

  const st = STATUS[mode];
  out["success"] = st.success;
  out["t-success"] = st.successText;
  out["danger"] = st.danger;
  out["t-danger"] = st.dangerText;
  out["success-soft"] = mode === "light" ? STATUS.light.successSoft : mix(st.success, base.surface, 0.2);
  out["danger-soft"] = mode === "light" ? STATUS.light.dangerSoft : mix(st.danger, base.surface, 0.2);
  return out;
}

export function cssVarsFor(themeId: ThemeId, mode: Mode): Record<string, string> {
  const colors = resolveColors(themeId, mode);
  return Object.fromEntries(Object.entries(colors).map(([k, hex]) => [`--${k}`, triplet(hex)]));
}

/* ───────── fonts ───────── */

export type FontId = "jakarta" | "inter" | "manrope" | "poppins" | "noto";
export const FONTS: Record<FontId, { label: string; family: string; google: string }> = {
  jakarta: { label: "Plus Jakarta Sans", family: '"Plus Jakarta Sans"', google: "Plus+Jakarta+Sans:wght@400;500;600;700;800" },
  inter: { label: "Inter", family: '"Inter"', google: "Inter:wght@400;500;600;700;800" },
  manrope: { label: "Manrope", family: '"Manrope"', google: "Manrope:wght@400;500;600;700;800" },
  poppins: { label: "Poppins", family: '"Poppins"', google: "Poppins:wght@400;500;600;700;800" },
  noto: { label: "Noto Sans", family: '"Noto Sans"', google: "Noto+Sans:wght@400;500;600;700;800" },
};
const DEVANAGARI = "Noto+Sans+Devanagari:wght@400;500;600;700;800";

export type TextSize = "sm" | "md" | "lg";
export const TEXT_SIZES: Record<TextSize, string> = { sm: "93.75%", md: "100%", lg: "112.5%" };

/* ───────── apply to the document ───────── */

export type Appearance = { theme: ThemeId; mode: Mode | "system"; font: FontId; size: TextSize; lang: "en" | "hi" };

export const resolveMode = (mode: Appearance["mode"]): Mode =>
  mode === "system" ? (typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : mode;

export function ensureFontLoaded(id: string, family: string) {
  const elId = `font-${id}`;
  if (document.getElementById(elId)) return;
  const link = document.createElement("link");
  link.id = elId;
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?family=${family}&display=swap`;
  document.head.appendChild(link);
}

export function applyAppearance(a: Appearance) {
  const root = document.documentElement;
  const mode = resolveMode(a.mode);
  for (const [k, v] of Object.entries(cssVarsFor(a.theme, mode))) root.style.setProperty(k, v);
  root.dataset.theme = a.theme;
  root.dataset.mode = mode;
  root.style.colorScheme = mode;

  const font = FONTS[a.font];
  ensureFontLoaded(a.font, font.google);
  if (a.lang === "hi") ensureFontLoaded("devanagari", DEVANAGARI);
  root.style.setProperty("--font-sans", `${font.family}, "Noto Sans Devanagari"`);
  root.style.fontSize = TEXT_SIZES[a.size];
  root.lang = a.lang === "hi" ? "hi" : "en";

  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", mode === "dark" ? resolveColors(a.theme, mode).canvas : THEMES[a.theme].ramp[600]);
}
