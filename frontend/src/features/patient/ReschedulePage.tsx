import { useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { Icon } from "../../components/icons";
import { Alert, Button, Card, EmptyState, ErrorState, PageHeader, Spinner, cx } from "../../components/ui";
import { apiErrorMessage } from "../../lib/api";
import { formatDate, formatDayKey, formatTime } from "../../lib/formatters";
import { useT } from "../../lib/i18n";
import type { Slot } from "../../types/api";
import { useAppointment, useDoctorProfile, useRescheduleAppointment } from "./hooks";

/** Pick another free slot with the same doctor; the payment carries over. */
export function ReschedulePage() {
  const t = useT();
  const { appointmentId } = useParams();
  const navigate = useNavigate();
  const appointment = useAppointment(appointmentId);
  const doctor = useDoctorProfile(appointment.data?.doctorId);
  const reschedule = useRescheduleAppointment();
  const [day, setDay] = useState<string | null>(null);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (appointment.isLoading || doctor.isLoading) return <Spinner />;
  if (appointment.isError || !appointment.data) {
    return <ErrorState message={t("Could not load this booking")} onRetry={() => appointment.refetch()} />;
  }
  if (appointment.data.status !== "BOOKED") return <Navigate to={`/patient/ticket/${appointment.data.id}`} replace />;
  if (doctor.isError || !doctor.data) return <ErrorState message={t("Could not load this doctor")} onRetry={() => doctor.refetch()} />;

  const current = appointment.data.slot;
  const slots = doctor.data.slots.filter((s) => s.id !== appointment.data!.slotId);
  const byDay = slots.reduce<Record<string, Slot[]>>((acc, s) => {
    (acc[s.slotDate] ??= []).push(s);
    return acc;
  }, {});
  const days = Object.keys(byDay).sort();
  const activeDay = day && byDay[day] ? day : days[0];

  async function confirm() {
    if (!slot || !appointmentId) return;
    setError(null);
    try {
      await reschedule.mutateAsync({ appointmentId, slotId: slot.id });
      navigate(`/patient/ticket/${appointmentId}`, { replace: true });
    } catch (err) {
      setError(apiErrorMessage(err));
    }
  }

  return (
    <div className="space-y-5">
      <Link to={`/patient/ticket/${appointmentId}`} className="inline-flex items-center gap-1 text-sm font-semibold text-muted hover:text-brand-600">
        <Icon name="chevronLeft" className="h-4 w-4" /> {t("Back to ticket")}
      </Link>
      <PageHeader
        eyebrow={doctor.data.fullName}
        title={t("Reschedule")}
        subtitle={current ? t("Currently {date} at {time}. Your payment carries over.", { date: formatDate(current.startsAt), time: formatTime(current.startsAt) }) : undefined}
      />

      {days.length === 0 ? (
        <EmptyState icon="calendar" title={t("No other open slots")} hint={t("This doctor has no other free slots right now. Your current booking is unchanged.")} />
      ) : (
        <Card className="space-y-4 p-4">
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" role="tablist" aria-label={t("Day")}>
            {days.map((d) => (
              <button
                key={d}
                type="button"
                role="tab"
                aria-selected={d === activeDay}
                onClick={() => {
                  setDay(d);
                  setSlot(null);
                }}
                className={cx(
                  "flex w-16 shrink-0 flex-col items-center rounded-2xl py-2 text-sm font-bold ring-1",
                  d === activeDay ? "bg-brand-600 text-white ring-brand-600" : "bg-surface text-ink ring-slate-200",
                )}
              >
                <span className="text-[11px] uppercase">{formatDayKey(d, { weekday: "short" })}</span>
                <span className="text-lg">{Number(d.slice(8))}</span>
              </button>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {[...(byDay[activeDay] ?? [])]
              .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
              .map((s) => (
                <button
                  key={s.id}
                  type="button"
                  aria-pressed={slot?.id === s.id}
                  onClick={() => setSlot(s)}
                  className={cx(
                    "rounded-xl px-2 py-2.5 text-sm font-bold ring-1",
                    slot?.id === s.id ? "bg-brand-600 text-white ring-brand-600" : "bg-surface text-ink ring-slate-200",
                  )}
                >
                  {formatTime(s.startsAt)}
                </button>
              ))}
          </div>
        </Card>
      )}

      <Alert>{error}</Alert>
      <Button size="lg" icon="calendar" className="w-full" disabled={!slot} loading={reschedule.isPending} onClick={confirm}>
        {slot ? t("Move to {date}, {time}", { date: formatDate(slot.startsAt), time: formatTime(slot.startsAt) }) : t("Pick a new time")}
      </Button>
    </div>
  );
}
