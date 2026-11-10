import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { applyAppearance, resolveMode, type Appearance } from "./theme";
import { setLocale } from "./locale";

const STORAGE_KEY = "medora.appearance";
export const DEFAULT_APPEARANCE: Appearance = { theme: "blue", mode: "light", font: "jakarta", size: "md", lang: "en" };

/** Reads saved preferences; browser storage can be unavailable (private mode, blocked), so fall back to defaults. */
export function loadAppearance(): Appearance {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULT_APPEARANCE, ...(JSON.parse(raw) as Partial<Appearance>) };
  } catch {
    /* ignore */
  }
  return DEFAULT_APPEARANCE;
}

function saveAppearance(a: Appearance) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(a));
  } catch {
    /* ignore */
  }
}

/** Apply before React renders so the first paint already uses the saved theme. */
export function bootAppearance() {
  const a = loadAppearance();
  setLocale(a.lang);
  applyAppearance(a);
}

type Ctx = {
  appearance: Appearance;
  resolvedMode: "light" | "dark";
  update: (patch: Partial<Appearance>) => void;
  reset: () => void;
};
const PreferencesContext = createContext<Ctx | null>(null);

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [appearance, setAppearance] = useState<Appearance>(loadAppearance);
  const [systemTick, setSystemTick] = useState(0);

  // Follow OS dark-mode changes when "System" is selected.
  useEffect(() => {
    if (appearance.mode !== "system") return;
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setSystemTick((n) => n + 1);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [appearance.mode]);

  useEffect(() => {
    setLocale(appearance.lang);
    applyAppearance(appearance);
    saveAppearance(appearance);
  }, [appearance, systemTick]);

  const update = useCallback((patch: Partial<Appearance>) => setAppearance((a) => ({ ...a, ...patch })), []);
  const reset = useCallback(() => setAppearance(DEFAULT_APPEARANCE), []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const resolvedMode = useMemo(() => resolveMode(appearance.mode), [appearance.mode, systemTick]);

  return <PreferencesContext.Provider value={{ appearance, resolvedMode, update, reset }}>{children}</PreferencesContext.Provider>;
}

export function usePreferences() {
  const ctx = useContext(PreferencesContext);
  if (!ctx) throw new Error("usePreferences must be used inside PreferencesProvider");
  return ctx;
}
