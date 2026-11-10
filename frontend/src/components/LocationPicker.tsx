import { useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { useT } from "../lib/i18n";
import {
  DetectError,
  POPULAR_CITIES,
  detectLocation,
  isValidPlace,
  normaliseCity,
  type DetectErrorCode,
  type PatientLocation,
} from "../lib/location";
import { Icon } from "./icons";
import { Alert, Button, Field, Input, cx } from "./ui";

const ERROR_KEYS: Record<DetectErrorCode, string> = {
  unsupported: "Your browser doesn't support location detection. Please enter your location below.",
  denied: "Location permission is blocked. Allow it in your browser settings, or enter your location below.",
  unavailable: "We couldn't find your position. Please try again or enter your location below.",
  timeout: "Finding your location took too long. Please try again or enter your location below.",
  lookup: "We found your position but couldn't look up the city. Please enter your location below.",
};

/** Pill shown in the hero: current location + opens the picker. */
export function LocationChip({
  location,
  detecting,
  onClick,
}: {
  location: PatientLocation | null;
  detecting: boolean;
  onClick: () => void;
}) {
  const t = useT();
  const label = detecting
    ? t("Detecting location…")
    : !location
      ? t("Choose location")
      : location.source === "all"
        ? t("All locations")
        : location.area
          ? `${location.area}, ${location.city}`
          : location.city;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={t("Change location")}
      className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-white/15 py-1.5 pl-2.5 pr-3 text-sm font-semibold text-white ring-1 ring-white/30 backdrop-blur transition hover:bg-white/25"
    >
      {detecting ? (
        <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-white border-r-transparent" />
      ) : (
        <Icon name={location?.source === "auto" ? "navigation" : "pin"} className="h-4 w-4 shrink-0" />
      )}
      <span className="truncate">{label}</span>
      <Icon name="chevronDown" className="h-4 w-4 shrink-0 opacity-80" />
    </button>
  );
}

export function LocationPicker({
  open,
  onClose,
  current,
  onChange,
}: {
  open: boolean;
  onClose: () => void;
  current: PatientLocation | null;
  onChange: (loc: PatientLocation) => void;
}) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [touched, setTouched] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [error, setError] = useState<DetectErrorCode | null>(null);

  // Keep the latest callbacks/values in refs so parent re-renders don't reset the form while typing.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Reset the form each time the picker opens; close on Escape.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setTouched(false);
    setError(null);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCloseRef.current();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  async function useCurrent() {
    setError(null);
    setDetecting(true);
    try {
      const found = await detectLocation();
      onChange({ source: "auto", ...found });
      onClose();
    } catch (err) {
      setError(err instanceof DetectError ? err.code : "unavailable");
    } finally {
      setDetecting(false);
    }
  }

  function choose(city: string) {
    onChange({ source: "manual", city: normaliseCity(city) });
    onClose();
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (isValidPlace(query)) choose(query);
  }

  const invalid = touched && !isValidPlace(query);
  const q = query.trim().toLowerCase();
  const suggestions = POPULAR_CITIES.filter((c) => !q || c.toLowerCase().includes(q));
  const activeCity = current && current.source !== "all" ? current.city : null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
          <motion.div className="absolute inset-0 bg-slate-950/40 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="location-title"
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 40 }}
            transition={{ type: "spring", stiffness: 380, damping: 34 }}
            className="relative flex max-h-[90vh] w-full flex-col rounded-t-3xl bg-surface text-ink shadow-float sm:max-w-md sm:rounded-3xl"
          >
            <header className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
              <div>
                <h2 id="location-title" className="text-lg font-extrabold">
                  {t("Choose your location")}
                </h2>
                <p className="text-sm text-muted">{t("We'll show doctors and clinics near you.")}</p>
              </div>
              <button
                type="button"
                aria-label={t("Close")}
                onClick={onClose}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted transition hover:bg-slate-100 hover:text-ink"
              >
                <Icon name="x" />
              </button>
            </header>

            <div className="space-y-5 overflow-y-auto px-5 py-5">
              {current && (
                <p className="flex items-center gap-2 rounded-xl bg-brand-50 px-3.5 py-2.5 text-sm">
                  <Icon name={current.source === "auto" ? "navigation" : current.source === "all" ? "grid" : "pin"} className="h-4 w-4 shrink-0 text-brand-600" />
                  <span className="text-muted">{t("Current:")}</span>
                  <span className="truncate font-semibold text-ink">
                    {current.source === "all" ? t("All locations") : current.area ? `${current.area}, ${current.city}` : current.city}
                  </span>
                </p>
              )}
              <Button variant="secondary" size="lg" icon="locate" className="w-full justify-start" loading={detecting} onClick={useCurrent}>
                {detecting ? t("Detecting location…") : t("Use my current location")}
              </Button>
              <Alert tone="warning">{error ? t(ERROR_KEYS[error]) : null}</Alert>

              <div className="flex items-center gap-3 text-xs font-semibold uppercase tracking-wider text-muted">
                <span className="h-px flex-1 bg-slate-200" />
                {t("or enter a location")}
                <span className="h-px flex-1 bg-slate-200" />
              </div>

              <form noValidate onSubmit={submit} className="space-y-3">
                <Field label={t("City or area")} error={invalid ? t("Enter a valid place name (2–60 letters)") : null}>
                  <div className="flex gap-2">
                    <Input
                      icon="pin"
                      autoComplete="address-level2"
                      placeholder={t("e.g. Bengaluru, Indiranagar")}
                      className="text-sm sm:text-[15px]"
                      aria-invalid={invalid || undefined}
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                    <Button type="submit" className="shrink-0">
                      {t("Set")}
                    </Button>
                  </div>
                </Field>
              </form>

              <div>
                <p className="label">{t("Popular cities")}</p>
                {suggestions.length === 0 ? (
                  <p className="text-sm text-muted">{t("No matching city — press Set to use “{place}”.", { place: query.trim() })}</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {suggestions.map((city) => (
                      <button
                        key={city}
                        type="button"
                        aria-pressed={activeCity === city}
                        onClick={() => choose(city)}
                        className={cx(
                          "rounded-full px-3.5 py-1.5 text-sm font-semibold transition",
                          activeCity === city ? "bg-brand-600 text-white shadow-glow" : "bg-surface text-slate-600 ring-1 ring-slate-200 hover:text-brand-700 hover:ring-brand-300",
                        )}
                      >
                        {city}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <footer className="border-t border-slate-200 px-5 py-4">
              <Button
                variant="ghost"
                icon="grid"
                className="w-full"
                onClick={() => {
                  onChange({ source: "all" });
                  onClose();
                }}
              >
                {t("Show doctors in all locations")}
              </Button>
            </footer>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
