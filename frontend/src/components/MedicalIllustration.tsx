import { motion } from "motion/react";
import { Icon, type IconName } from "./icons";
import { LogoMark, cx } from "./ui";
import { useT } from "../lib/i18n";

/** Gentle infinite float used by decorative elements. */
const float = (delay = 0, distance = 10) => ({
  animate: { y: [0, -distance, 0] },
  transition: { duration: 6, repeat: Infinity, ease: "easeInOut" as const, delay },
});

function Bubble({ icon, className, delay = 0 }: { icon: IconName; className: string; delay?: number }) {
  return (
    <motion.span
      {...float(delay, 12)}
      className={cx("absolute grid place-items-center rounded-2xl bg-surface text-brand-600 shadow-lift ring-1 ring-slate-100", className)}
    >
      <Icon name={icon} className="h-5 w-5" />
    </motion.span>
  );
}

/**
 * Product illustration for MEDORA: a phone showing a live queue token,
 * flanked by a doctor card, a confirmation toast and a heartbeat monitor.
 * Built from shapes and real UI pieces (no stock imagery).
 */
export function MedicalIllustration({ className = "" }: { className?: string }) {
  const t = useT();
  return (
    <div className={cx("relative mx-auto aspect-[5/4] w-full max-w-[560px] select-none", className)} aria-hidden="true">
      {/* soft backdrop */}
      <div className="absolute inset-[6%] rounded-[2.5rem] bg-gradient-to-br from-surface via-brand-50 to-lavender shadow-float" />
      <svg className="absolute inset-[6%] h-[88%] w-[88%]" viewBox="0 0 400 320" preserveAspectRatio="none">
        <path d="M0 230 C 90 180, 160 280, 260 220 S 380 170, 400 200 L400 320 L0 320Z" className="fill-brand-200/70" />
      </svg>

      {/* phone */}
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1], delay: 0.2 }}
        className="absolute left-[33%] top-[6%] w-[34%]"
      >
        <motion.div {...float(0, 8)} className="rounded-[2rem] bg-night p-2 shadow-float">
          <div className="overflow-hidden rounded-[1.6rem] bg-canvas">
            <div className="flex items-center justify-between px-3 pt-2.5 text-[8px] font-bold text-ink">
              <span>9:41</span>
              <span className="h-1.5 w-8 rounded-full bg-night/80" />
              <span>5G</span>
            </div>
            <div className="flex items-center gap-1.5 px-3 pt-2">
              <LogoMark className="h-4 w-4" />
              <span className="text-[9px] font-extrabold tracking-[0.14em] text-ink">MEDORA</span>
            </div>
            <div className="mx-2.5 mt-2 rounded-2xl bg-hero-gradient p-3 text-white">
              <p className="text-[8px] font-semibold uppercase tracking-wider text-white/75">{t("Your token")}</p>
              <p className="text-3xl font-extrabold leading-none">#12</p>
              <p className="mt-1 text-[8px] text-white/85">{t("Dr. A. Sharma · Cardiology")}</p>
            </div>
            <div className="mx-2.5 mt-2 grid grid-cols-2 gap-1.5">
              <div className="rounded-xl bg-surface p-2 shadow-sm">
                <p className="text-[7px] font-semibold text-muted">{t("Now serving")}</p>
                <p className="text-base font-extrabold text-brand-600">#9</p>
              </div>
              <div className="rounded-xl bg-surface p-2 shadow-sm">
                <p className="text-[7px] font-semibold text-muted">{t("Est. wait")}</p>
                <p className="text-base font-extrabold text-ink">
                  18<span className="text-[8px] text-muted"> {t("min")}</span>
                </p>
              </div>
            </div>
            <div className="mx-2.5 mt-2 h-1.5 overflow-hidden rounded-full bg-brand-100">
              <motion.div
                className="h-full rounded-full bg-brand-gradient"
                initial={{ width: "20%" }}
                animate={{ width: ["40%", "75%", "40%"] }}
                transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
              />
            </div>
            <div className="mx-2.5 mb-3 mt-2 flex items-center justify-center rounded-xl bg-surface p-2 shadow-sm">
              <Icon name="qr" className="h-12 w-12 text-ink" strokeWidth={1.5} />
            </div>
          </div>
        </motion.div>
      </motion.div>

      {/* doctor card */}
      <motion.div
        initial={{ opacity: 0, x: -30 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.7, delay: 0.45 }}
        className="absolute bottom-[12%] left-0 w-[33%]"
      >
        <motion.div {...float(1, 10)} className="rounded-2xl bg-surface p-3 shadow-lift ring-1 ring-slate-100">
          <div className="flex items-center gap-2">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-100 text-brand-700">
              <Icon name="stethoscope" className="h-[18px] w-[18px]" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-[11px] font-bold text-ink">{t("Dr. Ananya Sharma")}</p>
              <p className="text-[9px] font-medium text-muted">{t("Cardiologist")}</p>
            </div>
          </div>
          <div className="mt-2 flex items-center justify-between">
            <span className="flex items-center gap-0.5 text-[9px] font-bold text-amber-500">
              <Icon name="star" className="h-3 w-3 fill-current" /> 4.9
            </span>
            <span className="rounded-full bg-success-soft px-1.5 py-0.5 text-[8px] font-bold text-success">{t("Available today")}</span>
          </div>
        </motion.div>
      </motion.div>

      {/* confirmation toast */}
      <motion.div
        initial={{ opacity: 0, x: 30 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.7, delay: 0.6 }}
        className="absolute right-0 top-[12%] w-[32%]"
      >
        <motion.div {...float(2, 9)} className="flex items-center gap-2 rounded-2xl bg-surface p-2.5 shadow-lift ring-1 ring-slate-100">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-success text-white">
            <Icon name="check" className="h-4 w-4" strokeWidth={3} />
          </span>
          <div className="min-w-0">
            <p className="text-[10px] font-bold text-ink">{t("Appointment confirmed")}</p>
            <p className="text-[8px] text-muted">{t("Today · 10:30 AM")}</p>
          </div>
        </motion.div>
      </motion.div>

      {/* heartbeat monitor */}
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, delay: 0.75 }}
        className="absolute bottom-[8%] right-0 w-[32%]"
      >
        <motion.div {...float(0.5, 8)} className="rounded-2xl bg-surface p-3 shadow-lift ring-1 ring-slate-100">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1 text-[10px] font-bold text-ink">
              <Icon name="heart" className="h-3.5 w-3.5 text-danger" /> {t("Heart rate")}
            </span>
            <span className="text-[10px] font-extrabold text-brand-600">{t("72 bpm")}</span>
          </div>
          <svg viewBox="0 0 120 32" className="mt-1.5 h-8 w-full">
            <motion.path
              d="M0 18 H30 L36 8 L42 28 L48 4 L54 22 L60 18 H120"
              fill="none"
              style={{ stroke: "rgb(var(--g2))" }}
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: [0, 1, 1], opacity: [1, 1, 0] }}
              transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
            />
          </svg>
        </motion.div>
      </motion.div>

      {/* floating medical elements */}
      <Bubble icon="pill" className="left-[10%] top-[16%] h-11 w-11" delay={0.8} />
      <Bubble icon="calendarCheck" className="right-[12%] top-[44%] h-10 w-10" delay={1.6} />
      <motion.span {...float(2.4, 14)} className="absolute left-[22%] top-[44%] text-2xl font-black text-brand-300">
        +
      </motion.span>
      <motion.span {...float(3, 10)} className="absolute bottom-[3%] left-[48%] text-xl font-black text-accent-300">
        +
      </motion.span>
    </div>
  );
}
