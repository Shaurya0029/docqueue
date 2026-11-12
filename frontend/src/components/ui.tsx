import {
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { AnimatePresence, motion } from "motion/react";
import type { AppointmentStatus } from "../types/api";
import { Icon, type IconName } from "./icons";
import { useT } from "../lib/i18n";
import { msg } from "../lib/i18n";

export const cx = (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(" ");

/** Inline style that staggers `animate-fade-up` entries in a list. */
export const stagger = (index: number, stepMs = 50): CSSProperties => ({ animationDelay: `${Math.min(index, 12) * stepMs}ms` });

const EASE = [0.22, 1, 0.36, 1] as const;

/** Motion wrapper: fades/slides children in, optionally delayed. */
export function Reveal({ children, delay = 0, className, y = 16 }: { children: ReactNode; delay?: number; className?: string; y?: number }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.55, ease: EASE, delay }}
    >
      {children}
    </motion.div>
  );
}

/* ───────────────────────── Brand ───────────────────────── */

/** MEDORA mark: rounded gradient tile, medical cross, pulse dot. */
export function LogoMark({ className = "h-9 w-9" }: { className?: string }) {
  const id = useId();
  return (
    <svg viewBox="0 0 40 40" className={className} aria-hidden="true">
      <defs>
        <linearGradient id={`${id}-g`} x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
          <stop style={{ stopColor: "rgb(var(--g1))" }} />
          <stop offset="0.6" style={{ stopColor: "rgb(var(--g2))" }} />
          <stop offset="1" style={{ stopColor: "rgb(var(--g3))" }} />
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx="12" fill={`url(#${id}-g)`} />
      <path
        d="M17 10.5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2V17h6.5a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2H23v6.5a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2V23h-6.5a2 2 0 0 1-2-2v-2a2 2 0 0 1 2-2H17v-6.5Z"
        fill="white"
      />
      <path d="M13.5 20h4l1.5-2.6 2 5.2 1.5-2.6h4" fill="none" style={{ stroke: "rgb(var(--g1))" }} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="31.5" cy="8.5" r="2.5" fill="#E9E7FF" />
    </svg>
  );
}

export function Logo({ light, size = "md" }: { light?: boolean; size?: "sm" | "md" | "lg" }) {
  const sizes = { sm: ["h-8 w-8", "text-base"], md: ["h-9 w-9", "text-lg"], lg: ["h-11 w-11", "text-2xl"] } as const;
  return (
    <span className="inline-flex items-center gap-2.5" aria-label="MEDORA">
      <LogoMark className={sizes[size][0]} />
      <span className={cx("font-extrabold tracking-[0.14em]", sizes[size][1], light ? "text-white" : "text-ink")}>
        MED<span className={light ? "text-sky-200" : "text-brand-600"}>ORA</span>
      </span>
    </span>
  );
}

/* ───────────────────────── Buttons ───────────────────────── */

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost" | "outline" | "white";
type ButtonSize = "sm" | "md" | "lg";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-brand-gradient bg-[length:180%_180%] bg-left text-white shadow-glow hover:bg-right hover:shadow-glow-accent",
  secondary: "bg-surface text-ink ring-1 ring-slate-200 shadow-sm hover:ring-brand-300 hover:text-brand-700",
  danger: "bg-danger text-white shadow-[0_12px_28px_-12px_rgba(224,82,82,0.7)] hover:brightness-105",
  ghost: "bg-transparent text-brand-600 hover:bg-brand-50",
  outline: "bg-transparent text-ink ring-1 ring-inset ring-slate-300 hover:ring-brand-400 hover:text-brand-700",
  // Used on gradients: stays white with the theme colour in every mode.
  white: "bg-[#fff] text-[rgb(var(--g1))] shadow-lift hover:bg-[#F1F4FB]",
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: "min-h-[36px] rounded-lg px-3 py-1.5 text-sm",
  md: "min-h-[44px] rounded-xl px-4 py-2 text-[15px]",
  lg: "min-h-[48px] rounded-xl px-5 py-2.5 text-base",
};

type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onAnimationStart" | "onDrag" | "onDragEnd" | "onDragStart"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  iconRight?: IconName;
  loading?: boolean;
};

export function Button({ variant = "primary", size = "md", icon, iconRight, loading, className = "", children, disabled, type = "button", ...props }: ButtonProps) {
  return (
    <motion.button
      type={type}
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.97 }}
      transition={{ type: "spring", stiffness: 420, damping: 26 }}
      className={cx(
        "inline-flex select-none items-center justify-center gap-2 font-semibold transition-[background-position,box-shadow,color,background-color] duration-500",
        "disabled:pointer-events-none disabled:opacity-50 disabled:shadow-none",
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        className,
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        {loading ? (
          <motion.span
            key="spin"
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.5 }}
            className="h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent"
          />
        ) : (
          icon && (
            <motion.span key="icon" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <Icon name={icon} className="h-[18px] w-[18px]" />
            </motion.span>
          )
        )}
      </AnimatePresence>
      {children}
      {iconRight && !loading && <Icon name={iconRight} className="h-[18px] w-[18px]" />}
    </motion.button>
  );
}

/* ───────────────────────── Form controls ───────────────────────── */

const FIELD_BASE =
  "block w-full min-h-[44px] rounded-xl border-0 bg-surface px-3.5 py-2.5 text-[15px] text-ink shadow-sm ring-1 ring-inset ring-slate-200 " +
  "placeholder:text-slate-400 transition duration-200 hover:ring-slate-300 focus:outline-none focus:ring-2 focus:ring-brand-500 " +
  "aria-[invalid=true]:ring-danger";

export function Input({ icon, className, ...props }: InputHTMLAttributes<HTMLInputElement> & { icon?: IconName }) {
  if (!icon) return <input {...props} className={cx(FIELD_BASE, className)} />;
  return (
    <div className="group relative">
      <Icon name={icon} className="pointer-events-none absolute left-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-slate-400 transition group-focus-within:text-brand-600" />
      <input {...props} className={cx(FIELD_BASE, "pl-10", className)} />
    </div>
  );
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cx(FIELD_BASE, "min-h-[96px] resize-y", className)} />;
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cx(FIELD_BASE, "cursor-pointer pr-9", className)} />;
}

/** Label + control + hint/error, so forms don't repeat label markup. */
export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string | null; children: ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      <AnimatePresence initial={false}>
        {error ? (
          <motion.span
            key="err"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-1.5 block text-xs font-semibold text-danger"
          >
            {error}
          </motion.span>
        ) : (
          hint && <span className="mt-1.5 block text-xs text-muted">{hint}</span>
        )}
      </AnimatePresence>
    </label>
  );
}

/* Indian mobile numbers: 10 digits starting 6-9. */
export const isValidIndianMobile = (digits: string) => /^[6-9]\d{9}$/.test(digits);
export const toE164India = (digits: string) => `+91${digits}`;

/** Mobile number input with a fixed +91 prefix. `value`/`onChange` are the 10 local digits. */
export function PhoneInput({
  value,
  onChange,
  invalid,
  autoFocus,
  id,
}: {
  value: string;
  onChange: (digits: string) => void;
  invalid?: boolean;
  autoFocus?: boolean;
  id?: string;
}) {
  return (
    <div
      className={cx(
        "flex items-stretch overflow-hidden rounded-xl bg-surface shadow-sm ring-1 ring-inset transition duration-200 focus-within:ring-2",
        invalid ? "ring-danger focus-within:ring-danger" : "ring-slate-200 hover:ring-slate-300 focus-within:ring-brand-500",
      )}
    >
      <span className="flex shrink-0 items-center border-r border-slate-200 bg-slate-50 px-3 text-[15px] font-semibold text-ink">+91</span>
      <input
        id={id}
        type="tel"
        inputMode="numeric"
        autoComplete="tel-national"
        autoFocus={autoFocus}
        maxLength={10}
        placeholder="98765 43210"
        aria-invalid={invalid || undefined}
        className="min-h-[44px] w-full min-w-0 bg-transparent px-3 py-2.5 text-[15px] font-medium tracking-wide text-ink placeholder:font-normal placeholder:text-slate-400 focus:outline-none"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 10))}
      />
    </div>
  );
}

/** Six-box OTP input with paste support and animated focus. */
export function OtpInput({ value, onChange, length = 6, invalid }: { value: string; onChange: (v: string) => void; length?: number; invalid?: boolean }) {
  const t = useT();
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  // Latest value, updated synchronously: fast typing/autofill fires several
  // events before React re-renders, so the `value` prop would be stale.
  const latest = useRef(value);
  latest.current = value;
  const digits = Array.from({ length }, (_, i) => value[i] ?? "");

  function commit(next: string) {
    latest.current = next;
    onChange(next);
  }

  function focus(i: number) {
    refs.current[Math.max(0, Math.min(length - 1, i))]?.focus();
  }

  function setAt(i: number, chars: string) {
    const cur = latest.current;
    commit((cur.slice(0, i) + chars + cur.slice(i + chars.length)).replace(/\D/g, "").slice(0, length));
    focus(i + chars.length);
  }

  function removeAt(i: number) {
    const cur = latest.current;
    commit(cur.slice(0, i) + cur.slice(i + 1));
  }

  function onKeyDown(i: number, e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !latest.current[i] && i > 0) {
      e.preventDefault();
      removeAt(i - 1);
      focus(i - 1);
    } else if (e.key === "ArrowLeft") focus(i - 1);
    else if (e.key === "ArrowRight") focus(i + 1);
  }

  return (
    <div className="flex justify-between gap-1.5 sm:gap-2" role="group" aria-label={t("One-time code")}>
      {digits.map((d, i) => (
        <motion.input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.04, ease: EASE }}
          whileFocus={{ scale: 1.06, y: -2 }}
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          aria-label={t("Digit {n}", { n: i + 1 })}
          maxLength={length}
          value={d}
          autoFocus={i === 0}
          onFocus={(e) => {
            // Keep digits contiguous: jump to the first empty box.
            if (i > latest.current.length) focus(latest.current.length);
            else e.currentTarget.select();
          }}
          onKeyDown={(e) => onKeyDown(i, e)}
          onChange={(e) => {
            const raw = e.target.value.replace(/\D/g, "");
            if (!raw) {
              removeAt(i);
              return;
            }
            // Typing into a filled box yields two chars; keep the new one. Longer input = autofill.
            const had = latest.current[i];
            setAt(i, had && raw.length === 2 ? (raw[0] === had ? raw[1] : raw[0]) : raw);
          }}
          onPaste={(e) => {
            e.preventDefault();
            const pasted = e.clipboardData.getData("text").replace(/\D/g, "");
            if (pasted) setAt(i, pasted.slice(0, length - i));
          }}
          className={cx(
            "h-12 w-full min-w-0 rounded-xl bg-surface text-center text-xl font-bold text-ink shadow-sm ring-1 ring-inset transition-colors sm:h-14 sm:text-2xl",
            "focus:outline-none focus:ring-2 focus:ring-brand-500",
            invalid ? "ring-danger" : d ? "bg-brand-50 ring-brand-300" : "ring-slate-200",
          )}
        />
      ))}
    </div>
  );
}

/** Segmented control with a sliding (shared-layout) indicator. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; icon?: IconName }[];
}) {
  const id = useId();
  return (
    <div role="tablist" className="grid gap-1 rounded-2xl bg-slate-100 p-1" style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.value)}
            className={cx(
              "relative flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold transition-colors",
              active ? "text-brand-700" : "text-muted hover:text-ink",
            )}
          >
            {active && (
              <motion.span
                layoutId={`${id}-seg`}
                className="absolute inset-0 rounded-xl bg-surface shadow-soft ring-1 ring-brand-300/60"
                transition={{ type: "spring", stiffness: 420, damping: 34 }}
              />
            )}
            <span className="relative z-10 flex items-center gap-2">
              {o.icon && <Icon name={o.icon} className="h-4 w-4" />}
              {o.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Filter / toggle chip. */
export function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cx(
        "whitespace-nowrap rounded-full px-4 py-2 text-sm font-semibold transition-all duration-200",
        active ? "bg-brand-600 text-white shadow-glow" : "bg-surface text-slate-600 ring-1 ring-slate-200 hover:-translate-y-0.5 hover:text-brand-700 hover:ring-brand-300",
      )}
    >
      {label}
    </button>
  );
}

/* ───────────────────────── Surfaces ───────────────────────── */

export function Card({
  children,
  className = "",
  interactive,
  style,
}: {
  children: ReactNode;
  className?: string;
  interactive?: boolean;
  style?: CSSProperties;
}) {
  return (
    <div
      style={style}
      className={cx(
        "rounded-2xl border border-slate-200/70 bg-surface p-4 shadow-soft",
        interactive && "transition-all duration-300 hover:-translate-y-1 hover:border-brand-200 hover:shadow-lift",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Card with a heading row. */
export function Section({ title, icon, action, children, className = "" }: { title: string; icon?: IconName; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <Card className={cx("p-4 sm:p-5", className)}>
      <div className="mb-4 flex items-center justify-between gap-3 border-b border-slate-100 pb-3.5">
        <h2 className="flex items-center gap-2.5 text-base font-bold">
          {icon && (
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-50 text-brand-600">
              <Icon name={icon} className="h-[18px] w-[18px]" />
            </span>
          )}
          {title}
        </h2>
        {action}
      </div>
      {children}
    </Card>
  );
}

/** Bold blue gradient panel for hero / highlight content. */
export function HeroCard({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx("relative overflow-hidden rounded-3xl bg-hero-gradient p-5 text-white shadow-glow-accent sm:p-6", className)}>
      <svg className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 text-white/10" viewBox="0 0 200 200" aria-hidden="true">
        <circle cx="100" cy="100" r="100" fill="currentColor" />
      </svg>
      <svg className="pointer-events-none absolute -bottom-24 -left-10 h-56 w-56 text-sky-200/20" viewBox="0 0 200 200" aria-hidden="true">
        <circle cx="100" cy="100" r="100" fill="currentColor" />
      </svg>
      <div className="relative">{children}</div>
    </div>
  );
}

export function PageHeader({ title, subtitle, eyebrow, action }: { title: string; subtitle?: string; eyebrow?: string; action?: ReactNode }) {
  return (
    <Reveal className="mb-5 flex flex-wrap items-end justify-between gap-3 sm:mb-6" y={10}>
      <div>
        {eyebrow && <p className="mb-1.5 text-xs font-bold uppercase tracking-[0.16em] text-brand-600">{eyebrow}</p>}
        <h1 className="text-[1.6rem] font-extrabold leading-tight sm:text-[2rem]">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted sm:text-[15px]">{subtitle}</p>}
      </div>
      {action}
    </Reveal>
  );
}

export function StatCard({
  label,
  value,
  icon,
  tone = "brand",
  hint,
  style,
}: {
  label: string;
  value: ReactNode;
  icon: IconName;
  tone?: "brand" | "accent" | "success" | "danger";
  hint?: string;
  style?: CSSProperties;
}) {
  const tones = {
    brand: "bg-brand-50 text-brand-600",
    accent: "bg-lavender text-accent-600",
    success: "bg-success-soft text-success",
    danger: "bg-danger-soft text-danger",
  };
  return (
    <Card interactive className="animate-fade-up p-5" style={style}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-muted">{label}</p>
          <p className="mt-1.5 truncate text-[1.65rem] font-extrabold leading-tight tracking-tight text-ink">{value}</p>
          {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
        </div>
        <span className={cx("grid h-11 w-11 shrink-0 place-items-center rounded-xl", tones[tone])}>
          <Icon name={icon} />
        </span>
      </div>
    </Card>
  );
}

/** Heading row above a list: title, count and an optional control (e.g. a clinic picker). */
export function ListHeader({ title, count, children }: { title: string; count?: number; children?: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
      <h2 className="flex items-center gap-2 text-base font-bold">
        {title}
        {count !== undefined && <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-bold text-brand-700">{count}</span>}
      </h2>
      {children}
    </div>
  );
}

/** Compact clinic switcher used on admin pages. */
export function ClinicPicker({ clinics, value, onChange }: { clinics: { id: string; name: string }[]; value: string; onChange: (id: string) => void }) {
  const t = useT();
  if (clinics.length === 0) return null;
  return (
    <label className="relative flex w-full items-center sm:w-64">
      <span className="sr-only">{t("Clinic")}</span>
      <Icon name="building" className="pointer-events-none absolute left-3 h-4 w-4 text-brand-600" />
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-[40px] w-full cursor-pointer truncate rounded-xl border-0 bg-surface py-2 pl-9 pr-8 text-sm font-semibold text-ink shadow-sm ring-1 ring-inset ring-slate-200 transition hover:ring-brand-300 focus:outline-none focus:ring-2 focus:ring-brand-500"
      >
        {clinics.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Small label/value pair with an icon tile, for detail lists. */
export function InfoRow({ icon, label, value, tone = "brand" }: { icon: IconName; label?: string; value: ReactNode; tone?: "brand" | "success" }) {
  return (
    <div className="flex items-center gap-3">
      <span className={cx("grid h-10 w-10 shrink-0 place-items-center rounded-xl", tone === "success" ? "bg-success-soft text-success" : "bg-brand-50 text-brand-600")}>
        <Icon name={icon} className="h-[18px] w-[18px]" />
      </span>
      <div className="min-w-0">
        {label && <p className="text-xs font-medium text-muted">{label}</p>}
        <div className="text-sm font-semibold text-ink">{value}</div>
      </div>
    </div>
  );
}

/* ───────────────────────── Feedback states ───────────────────────── */

export function Spinner() {
  const t = useT();
  return (
    <div className="flex items-center justify-center py-16" role="status" aria-label={t("Loading")}>
      <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1.4, ease: "linear" }}>
        <LogoMark className="h-10 w-10 opacity-90" />
      </motion.div>
    </div>
  );
}

export function Skeleton({ className = "h-20" }: { className?: string }) {
  return (
    <div className={cx("relative overflow-hidden rounded-2xl bg-slate-200/60", className)}>
      <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-surface/80 to-transparent" />
    </div>
  );
}

export function EmptyState({ title, hint, icon = "sparkles", action }: { title: string; hint?: string; icon?: IconName; action?: ReactNode }) {
  return (
    <Reveal className="flex flex-col items-center justify-center rounded-3xl border-2 border-dashed border-slate-200 bg-surface/60 px-6 py-14 text-center">
      <span className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-brand-gradient-soft text-brand-600">
        <Icon name={icon} className="h-7 w-7" />
      </span>
      <p className="font-bold text-ink">{title}</p>
      {hint && <p className="mt-1 max-w-xs text-sm text-muted">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </Reveal>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const t = useT();
  return (
    <Reveal className="flex flex-col items-center justify-center gap-3 rounded-3xl border border-danger/20 bg-danger-soft px-6 py-12 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-2xl bg-surface text-danger shadow-sm">
        <Icon name="alert" className="h-6 w-6" />
      </span>
      <p className="font-semibold text-danger">{message}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          {t("Try again")}
        </Button>
      )}
    </Reveal>
  );
}

/** Inline message. Renders nothing when `children` is empty. */
export function Alert({ tone = "error", children }: { tone?: "error" | "info" | "warning" | "success"; children?: ReactNode }) {
  const tones = {
    error: ["bg-danger-soft text-danger ring-danger/20", "alert"],
    info: ["bg-brand-50 text-brand-800 ring-brand-200", "sparkles"],
    warning: ["bg-amber-50 text-amber-800 ring-amber-200", "key"],
    success: ["bg-success-soft text-success ring-success/20", "check"],
  } as const;
  return (
    <AnimatePresence initial={false}>
      {children ? (
        <motion.div
          key="alert"
          role={tone === "error" ? "alert" : "status"}
          initial={{ opacity: 0, y: -6, height: 0 }}
          animate={{ opacity: 1, y: 0, height: "auto" }}
          exit={{ opacity: 0, y: -6, height: 0 }}
          className="overflow-hidden"
        >
          <p className={cx("flex items-start gap-2 rounded-xl px-3.5 py-2.5 text-sm font-medium ring-1", tones[tone][0])}>
            <Icon name={tones[tone][1]} className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{children}</span>
          </p>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

/* ───────────────────────── Small display bits ───────────────────────── */

const STATUS_STYLES: Record<AppointmentStatus, { chip: string; dot: string; live?: boolean }> = {
  PENDING_PAYMENT: { chip: "bg-amber-50 text-amber-700 ring-amber-200", dot: "bg-amber-500" },
  BOOKED: { chip: "bg-brand-50 text-brand-700 ring-brand-200", dot: "bg-brand-500" },
  CHECKED_IN: { chip: "bg-lavender text-accent-700 ring-accent-200", dot: "bg-accent-500", live: true },
  IN_CONSULTATION: { chip: "bg-brand-600 text-white ring-brand-600", dot: "bg-surface", live: true },
  COMPLETED: { chip: "bg-success-soft text-success ring-success/25", dot: "bg-success" },
  CANCELLED: { chip: "bg-slate-100 text-slate-500 ring-slate-200", dot: "bg-slate-400" },
  NO_SHOW: { chip: "bg-danger-soft text-danger ring-danger/25", dot: "bg-danger" },
};

const STATUS_LABELS: Record<AppointmentStatus, string> = {
  PENDING_PAYMENT: msg("Awaiting payment"),
  BOOKED: msg("Booked"),
  CHECKED_IN: msg("Checked in"),
  IN_CONSULTATION: msg("In consultation"),
  COMPLETED: msg("Completed"),
  CANCELLED: msg("Cancelled"),
  NO_SHOW: msg("No-show"),
};

export function StatusChip({ status }: { status: AppointmentStatus }) {
  const t = useT();
  const s = STATUS_STYLES[status];
  return (
    <span className={cx("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset", s.chip)}>
      <LiveDot className={s.dot} pulse={s.live} />
      {t(STATUS_LABELS[status])}
    </span>
  );
}

export function LiveDot({ className = "bg-success", pulse = true }: { className?: string; pulse?: boolean }) {
  return (
    <span className="relative inline-flex h-2 w-2">
      {pulse && <span className={cx("absolute inline-flex h-full w-full animate-ping rounded-full opacity-60", className)} />}
      <span className={cx("relative inline-flex h-2 w-2 rounded-full", className)} />
    </span>
  );
}

/** Animates in whenever the value changes (live queue numbers). */
export function AnimatedNumber({ value, className = "" }: { value: ReactNode; className?: string }) {
  return (
    <span className={cx("relative inline-flex overflow-hidden tabular-nums", className)}>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={String(value)}
          initial={{ y: "70%", opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: "-70%", opacity: 0 }}
          transition={{ type: "spring", stiffness: 380, damping: 28 }}
          className="inline-block"
        >
          {value}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

const AVATAR_STYLES = [
  "bg-brand-100 text-brand-700",
  "bg-lavender text-accent-700",
  "bg-sky-100 text-brand-800",
  "bg-success-soft text-success",
  "bg-brand-600 text-white",
];

export function Avatar({ name, size = "md" }: { name?: string | null; size?: "sm" | "md" | "lg" }) {
  const label = (name ?? "?").replace(/^dr\.?\s+/i, "");
  const initials = label
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
  const hash = [...label].reduce((h, c) => h + c.charCodeAt(0), 0);
  const sizes = { sm: "h-9 w-9 text-xs rounded-xl", md: "h-12 w-12 text-sm rounded-2xl", lg: "h-20 w-20 text-2xl rounded-3xl" };
  return (
    <span className={cx("grid shrink-0 place-items-center font-bold", AVATAR_STYLES[hash % AVATAR_STYLES.length], sizes[size])}>
      {initials || "?"}
    </span>
  );
}
