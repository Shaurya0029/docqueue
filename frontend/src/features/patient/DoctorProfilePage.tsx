import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { Icon } from "../../components/icons";
import { Alert, Avatar, Button, Card, ErrorState, Reveal, Section, Spinner, cx } from "../../components/ui";
import { apiErrorMessage } from "../../lib/api";
import { clinicHour, formatDate, formatDayKey, formatRupees, formatTime } from "../../lib/formatters";
import type { Slot } from "../../types/api";
import { useBookSlot, useDoctorProfile } from "./hooks";
import { useT } from "../../lib/i18n";
import { NoSlotsPanel } from "./NoSlotsPanel";

const PERIODS = [
  { label: "Morning", icon: "sparkles", test: (h: number) => h < 12 },
  { label: "Afternoon", icon: "clock", test: (h: number) => h >= 12 && h < 17 },
  { label: "Evening", icon: "clock", test: (h: number) => h >= 17 },
] as const;

export function DoctorProfilePage() {
  const t = useT();
  const { doctorId } = useParams();
  const navigate = useNavigate();
  const { data: doctor, isLoading, isError, refetch } = useDoctorProfile(doctorId);
  const bookSlot = useBookSlot();
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (isLoading) return <Spinner />;
  if (isError || !doctor) return <ErrorState message={t("Could not load this doctor")} onRetry={() => refetch()} />;

  const slotsByDay = doctor.slots.reduce<Record<string, Slot[]>>((acc, slot) => {
    (acc[slot.slotDate] ??= []).push(slot);
    return acc;
  }, {});
  const days = Object.keys(slotsByDay).sort();
  const activeDay = selectedDate && slotsByDay[selectedDate] ? selectedDate : days[0];
  const daySlots = activeDay ? [...slotsByDay[activeDay]].sort((a, b) => a.startsAt.localeCompare(b.startsAt)) : [];

  async function confirmBooking() {
    if (!selectedSlot) return;
    setError(null);
    try {
      const appointment = await bookSlot.mutateAsync(selectedSlot.id);
      navigate(`/patient/book/${appointment.id}`);
    } catch (err) {
      setError(apiErrorMessage(err));
    }
  }

  return (
    <div className="space-y-5">
      <Link to="/patient" className="inline-flex items-center gap-1 text-sm font-semibold text-muted transition hover:text-brand-600">
        <Icon name="chevronLeft" className="h-4 w-4" /> {t("All doctors")}
      </Link>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,380px)_1fr] lg:items-start">
      <div className="lg:sticky lg:top-10">
      {/* Profile */}
      <Reveal>
        <Card className="overflow-hidden !p-0">
          <div className="h-20 bg-hero-gradient" />
          <div className="-mt-10 px-5 pb-5">
            <div className="rounded-3xl ring-4 ring-surface [width:fit-content]">
              <Avatar name={doctor.fullName} size="lg" />
            </div>
            <h1 className="mt-3 flex items-center gap-1.5 text-2xl font-extrabold">
              {doctor.fullName}
              <Icon name="verified" className="h-5 w-5 text-brand-500" />
            </h1>
            <p className="font-semibold text-brand-600">{doctor.specialization}</p>
            <p className="mt-1 flex items-start gap-1 text-sm text-muted">
              <Icon name="pin" className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                {doctor.clinic.name}
                {doctor.clinic.address && ` · ${doctor.clinic.address}`}
              </span>
            </p>
            {doctor.bio && <p className="mt-3 text-sm leading-relaxed text-slate-600">{doctor.bio}</p>}

            <div className="mt-4 grid grid-cols-2 gap-2">
              <div className="rounded-2xl bg-brand-50 p-3">
                <p className="text-xs font-semibold text-muted">{t("Consultation fee")}</p>
                <p className="text-lg font-extrabold text-ink">{formatRupees(doctor.consultationFee)}</p>
              </div>
              <div className="rounded-2xl bg-lavender p-3">
                <p className="text-xs font-semibold text-muted">{t("Avg. consult time")}</p>
                <p className="text-lg font-extrabold text-ink">{t("~{n} min", { n: doctor.avgConsultMinutes })}</p>
              </div>
            </div>
          </div>
        </Card>
      </Reveal>

      </div>
      <div className="min-w-0 space-y-5">
      {days.length === 0 ? (
        <NoSlotsPanel doctorId={doctor.id} doctorName={doctor.fullName} />
      ) : (
        <Reveal delay={0.08}>
          <Section title={t("Choose a date")} icon="calendar">
            {/* Date strip */}
            <div className="no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5 pb-1">
              {days.map((day) => {
                const active = day === activeDay;
                return (
                  <button
                    key={day}
                    type="button"
                    aria-pressed={active}
                    onClick={() => {
                      setSelectedDate(day);
                      setSelectedSlot(null);
                    }}
                    className={cx(
                      "flex w-16 shrink-0 flex-col items-center rounded-2xl py-2.5 transition-all duration-200",
                      active ? "bg-brand-gradient text-white shadow-glow" : "bg-slate-50 text-ink ring-1 ring-slate-200 hover:ring-brand-300",
                    )}
                  >
                    <span className={cx("text-[11px] font-semibold uppercase", active ? "text-white/80" : "text-muted")}>
                      {formatDayKey(day, { weekday: "short" })}
                    </span>
                    <span className="text-xl font-extrabold">{Number(day.slice(8))}</span>
                    <span className={cx("text-[10px] font-semibold", active ? "text-white/80" : "text-muted")}>
                      {t("{n} slots", { n: slotsByDay[day].length })}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Time slots */}
            <div className="mt-5 space-y-4">
              {PERIODS.map((period) => {
                const slots = daySlots.filter((s) => period.test(clinicHour(s.startsAt)));
                if (slots.length === 0) return null;
                return (
                  <div key={period.label}>
                    <p className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted">
                      <Icon name={period.icon} className="h-3.5 w-3.5" /> {t(period.label)}
                    </p>
                    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                      {slots.map((slot) => {
                        const active = selectedSlot?.id === slot.id;
                        return (
                          <motion.button
                            key={slot.id}
                            type="button"
                            whileTap={{ scale: 0.95 }}
                            aria-pressed={active}
                            onClick={() => setSelectedSlot(slot)}
                            className={cx(
                              "rounded-xl px-2 py-2.5 text-sm font-bold transition-all duration-200",
                              active
                                ? "bg-brand-600 text-white shadow-glow"
                                : "bg-surface text-ink ring-1 ring-slate-200 hover:-translate-y-0.5 hover:text-brand-700 hover:ring-brand-300",
                            )}
                          >
                            {formatTime(slot.startsAt)}
                          </motion.button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </Section>
        </Reveal>
      )}

      {/* Confirmation sheet */}
      <AnimatePresence>
        {selectedSlot && (
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 40 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="sticky bottom-28 z-20 md:bottom-6"
          >
            <Card className="!border-brand-200 p-5 shadow-float">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-brand-600">{t("Your appointment")}</p>
                  <p className="font-bold text-ink">
                    {formatDate(selectedSlot.startsAt)} · {formatTime(selectedSlot.startsAt)}
                  </p>
                </div>
                <p className="text-xl font-extrabold text-ink">{formatRupees(doctor.consultationFee)}</p>
              </div>
              <p className="mt-2 flex items-start gap-1.5 text-xs text-muted">
                <Icon name="shield" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
                {t("Full refund if cancelled 2+ hours before your slot. No refund after that.")}
              </p>
              <div className="mt-3">
                <Alert>{error}</Alert>
              </div>
              <Button size="lg" iconRight="arrowRight" className="mt-3 w-full" loading={bookSlot.isPending} onClick={confirmBooking}>
                {t("Reserve & pay {amount}", { amount: formatRupees(doctor.consultationFee) })}
              </Button>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>
      </div>
      </div>
    </div>
  );
}
