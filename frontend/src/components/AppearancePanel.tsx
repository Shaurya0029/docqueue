import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { usePreferences } from "../lib/preferences";
import { useT } from "../lib/i18n";
import { FONTS, THEMES, ensureFontLoaded, type FontId, type ThemeId, type TextSize } from "../lib/theme";
import { Icon, type IconName } from "./icons";
import { Button, cx } from "./ui";

/** Opens the appearance panel. `tone="onGradient"` for use on the blue login hero. */
export function AppearanceButton({ tone = "default", withLabel }: { tone?: "default" | "onGradient" | "sidebar"; withLabel?: boolean }) {
  const [open, setOpen] = useState(false);
  const t = useT();
  const styles = {
    default: "h-10 w-10 justify-center rounded-xl text-muted hover:bg-brand-50 hover:text-brand-600",
    onGradient: "h-9 w-9 justify-center rounded-lg bg-white/15 text-white ring-1 ring-white/30 hover:bg-white/25",
    sidebar: "w-full gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-muted hover:bg-slate-100 hover:text-ink",
  };
  return (
    <>
      <button type="button" aria-label={t("Appearance & language")} onClick={() => setOpen(true)} className={cx("inline-flex items-center transition", styles[tone])}>
        <Icon name="palette" className={tone === "sidebar" ? "h-[18px] w-[18px]" : "h-5 w-5"} />
        {withLabel && <span>{t("Appearance")}</span>}
      </button>
      <AppearancePanel open={open} onClose={() => setOpen(false)} />
    </>
  );
}

const THEME_ORDER: ThemeId[] = ["blue", "teal", "violet", "rose"];
const THEME_LABEL_KEYS: Record<ThemeId, string> = { blue: "MEDORA Blue", teal: "Mint Teal", violet: "Royal Violet", rose: "Coral Rose" };

function Group({ title, icon, children }: { title: string; icon: IconName; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="flex items-center gap-2 text-sm font-bold text-ink">
        <Icon name={icon} className="h-4 w-4 text-brand-600" />
        {title}
      </h3>
      {children}
    </section>
  );
}

function OptionButton({ active, onClick, children, className }: { active: boolean; onClick: () => void; children: React.ReactNode; className?: string }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cx(
        "relative rounded-xl p-3 text-left ring-1 transition-all duration-200",
        active ? "bg-brand-50 ring-2 ring-brand-500" : "bg-surface ring-slate-200 hover:ring-brand-300",
        className,
      )}
    >
      {active && (
        <span className="absolute -right-1.5 -top-1.5 z-10 grid h-5 w-5 place-items-center rounded-full bg-brand-600 text-white shadow-soft ring-2 ring-surface">
          <Icon name="check" className="h-3 w-3" strokeWidth={3} />
        </span>
      )}
      {children}
    </button>
  );
}

export function AppearancePanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { appearance, update, reset } = usePreferences();
  const t = useT();
  const closeRef = useRef<HTMLButtonElement>(null);

  // Preview fonts in their own typeface; close on Escape; focus the panel.
  useEffect(() => {
    if (!open) return;
    (Object.keys(FONTS) as FontId[]).forEach((id) => ensureFontLoaded(id, FONTS[id].google));
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const modes: { value: typeof appearance.mode; label: string; icon: IconName }[] = [
    { value: "light", label: t("Light"), icon: "sun" },
    { value: "dark", label: t("Dark"), icon: "moon" },
    { value: "system", label: t("System"), icon: "monitor" },
  ];
  const sizes: { value: TextSize; label: string; cls: string }[] = [
    { value: "sm", label: t("Small"), cls: "text-sm" },
    { value: "md", label: t("Default"), cls: "text-base" },
    { value: "lg", label: t("Large"), cls: "text-xl" },
  ];

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50">
          <motion.div
            className="absolute inset-0 bg-slate-950/40 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.aside
            role="dialog"
            aria-modal="true"
            aria-label={t("Appearance & language")}
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 380, damping: 38 }}
            className="absolute inset-y-0 right-0 flex w-full max-w-[400px] flex-col bg-surface text-ink shadow-float"
          >
            <header className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <h2 className="text-lg font-extrabold">{t("Appearance & language")}</h2>
                <p className="text-xs text-muted">{t("Changes apply instantly and are saved on this device.")}</p>
              </div>
              <button
                ref={closeRef}
                type="button"
                aria-label={t("Close")}
                onClick={onClose}
                className="grid h-9 w-9 place-items-center rounded-lg text-muted transition hover:bg-slate-100 hover:text-ink"
              >
                <Icon name="x" />
              </button>
            </header>

            <div className="flex-1 space-y-7 overflow-y-auto px-6 py-6">
              <Group title={t("Mode")} icon="sun">
                <div className="grid grid-cols-3 gap-2.5">
                  {modes.map((m) => (
                    <OptionButton key={m.value} active={appearance.mode === m.value} onClick={() => update({ mode: m.value })} className="flex flex-col items-center gap-1.5 py-3.5 text-center">
                      <Icon name={m.icon} className="h-5 w-5 text-brand-600" />
                      <span className="text-sm font-semibold">{m.label}</span>
                    </OptionButton>
                  ))}
                </div>
              </Group>

              <Group title={t("Colour theme")} icon="palette">
                <div className="grid grid-cols-2 gap-2.5">
                  {THEME_ORDER.map((id) => {
                    const r = THEMES[id].ramp;
                    return (
                      <OptionButton key={id} active={appearance.theme === id} onClick={() => update({ theme: id })} className="flex items-center gap-3">
                        <span className="h-9 w-9 shrink-0 rounded-full shadow-soft" style={{ background: `linear-gradient(135deg, ${r[600]}, ${r[500]} 55%, ${r[400]})` }} />
                        <span className="min-w-0 text-sm font-semibold leading-tight">{t(THEME_LABEL_KEYS[id])}</span>
                      </OptionButton>
                    );
                  })}
                </div>
              </Group>

              <Group title={t("Font")} icon="type">
                <div className="space-y-2.5">
                  {(Object.keys(FONTS) as FontId[]).map((id) => (
                    <OptionButton key={id} active={appearance.font === id} onClick={() => update({ font: id })} className="flex w-full items-center justify-between gap-3">
                      <span style={{ fontFamily: `${FONTS[id].family}, "Noto Sans Devanagari", sans-serif` }} className="truncate text-[15px] font-semibold">
                        {FONTS[id].label}
                      </span>
                      <span
                        aria-hidden="true"
                        style={{ fontFamily: `${FONTS[id].family}, "Noto Sans Devanagari", sans-serif` }}
                        className="flex shrink-0 items-baseline gap-2 text-sm text-muted"
                      >
                        <span>Aa</span>
                        <span>अ</span>
                        <span>123</span>
                      </span>
                    </OptionButton>
                  ))}
                </div>
              </Group>

              <Group title={t("Text size")} icon="type">
                <div className="grid grid-cols-3 gap-2.5">
                  {sizes.map((s) => (
                    <OptionButton key={s.value} active={appearance.size === s.value} onClick={() => update({ size: s.value })} className="flex flex-col items-center gap-1 py-3 text-center">
                      <span className={cx("font-extrabold leading-none", s.cls)}>A</span>
                      <span className="text-xs font-semibold text-muted">{s.label}</span>
                    </OptionButton>
                  ))}
                </div>
              </Group>

              <Group title={t("Language")} icon="languages">
                <div className="grid grid-cols-2 gap-2.5">
                  <OptionButton active={appearance.lang === "en"} onClick={() => update({ lang: "en" })}>
                    <span className="block text-sm font-bold">English</span>
                    <span className="text-xs text-muted">English</span>
                  </OptionButton>
                  <OptionButton active={appearance.lang === "hi"} onClick={() => update({ lang: "hi" })}>
                    <span lang="hi" className="block text-sm font-bold" style={{ fontFamily: '"Noto Sans Devanagari", sans-serif' }}>
                      हिन्दी
                    </span>
                    <span className="text-xs text-muted">Hindi</span>
                  </OptionButton>
                </div>
              </Group>
            </div>

            <footer className="border-t border-slate-200 px-5 py-4">
              <Button variant="outline" icon="reset" className="w-full" onClick={reset}>
                {t("Reset to default")}
              </Button>
            </footer>
          </motion.aside>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
