/** @type {import('tailwindcss').Config} */

/*
 * MEDORA design tokens. Colours are CSS variables ("r g b" triplets) computed
 * in src/lib/theme.ts for the selected colour theme and light/dark mode.
 * Text utilities read a separate `--t-*` ramp so text stays readable in dark mode.
 */
const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;
const ramp = (prefix, name) => Object.fromEntries(SHADES.map((s) => [s, v(`${prefix}-${name}-${s}`)]));

export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      colors: {
        brand: ramp("c", "brand"),
        sky: ramp("c", "brand"),
        accent: ramp("c", "accent"),
        amber: ramp("c", "amber"),
        slate: ramp("c", "slate"),
        canvas: v("canvas"),
        surface: v("surface"),
        ink: v("ink"),
        muted: v("muted"),
        lavender: v("c-accent-100"),
        night: "#17213B", // fixed dark (device frames), same in every theme
        success: { DEFAULT: v("success"), soft: v("success-soft") },
        danger: { DEFAULT: v("danger"), soft: v("danger-soft") },
      },
      textColor: {
        brand: ramp("t", "brand"),
        sky: ramp("t", "brand"),
        accent: ramp("t", "accent"),
        amber: ramp("t", "amber"),
        success: { DEFAULT: v("t-success"), soft: v("success-soft") },
        danger: { DEFAULT: v("t-danger"), soft: v("danger-soft") },
      },
      boxShadow: {
        soft: "0 1px 2px rgb(15 23 42 / 0.04), 0 8px 24px -10px rgb(15 23 42 / 0.12)",
        lift: "0 2px 6px rgb(15 23 42 / 0.05), 0 24px 48px -16px rgb(15 23 42 / 0.22)",
        float: "0 30px 80px -20px rgb(var(--g1) / 0.35), 0 8px 24px -12px rgb(15 23 42 / 0.14)",
        glow: "0 12px 28px -10px rgb(var(--g1) / 0.55)",
        "glow-accent": "0 16px 40px -14px rgb(var(--g2) / 0.6)",
      },
      backgroundImage: {
        "brand-gradient": "linear-gradient(135deg, rgb(var(--g1)) 0%, rgb(var(--g2)) 55%, rgb(var(--g3)) 100%)",
        "hero-gradient": "linear-gradient(120deg, rgb(var(--g1)) 0%, rgb(var(--g2)) 48%, rgb(var(--g3)) 100%)",
        "brand-gradient-soft": "linear-gradient(135deg, rgb(var(--c-brand-50)) 0%, rgb(var(--c-accent-100)) 100%)",
      },
      keyframes: {
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(12px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        shimmer: {
          "100%": { transform: "translateX(100%)" },
        },
        "gradient-x": {
          "0%, 100%": { backgroundPosition: "0% 50%" },
          "50%": { backgroundPosition: "100% 50%" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.5s cubic-bezier(0.22, 1, 0.36, 1) both",
        "fade-in": "fade-in 0.4s ease-out both",
        shimmer: "shimmer 1.6s infinite",
        "gradient-x": "gradient-x 10s ease infinite",
      },
    },
  },
  plugins: [],
};
