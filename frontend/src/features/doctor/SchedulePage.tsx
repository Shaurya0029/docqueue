import { useState } from "react";
import { Icon } from "../../components/icons";
import { Alert, Button, Card, EmptyState, ErrorState, Input, PageHeader, Skeleton, StatusChip, cx, stagger } from "../../components/ui";
import { addDaysKey, formatDayKey, formatRupees, formatTime, todayKey } from "../../lib/formatters";
import { apiErrorMessage } from "../../lib/api";
import type { Appointment } from "../../types/api";
import { useCancelByClinic, useDoctorAppointments, useMyDoctorProfile, useRefundOverride } from "./hooks";
import { useT } from "../../lib/i18n";

/** yyyy-mm-dd in local time, offset from today by `delta` days. */
function dayKey(delta: number) {
  return addDaysKey(todayKey(), delta);
}

function ScheduleRow({ appointment, doctorId, index }: { appointment: Appointment; doctorId: string | null; index: number }) {
  const t = useT();
  const cancel = useCancelByClinic(doctorId);
  const refundOverride = useRefundOverride(doctorId);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const payment = appointment.payment;
  const refunded = payment?.refund?.status === "PROCESSED";
  const canRefund = appointment.status === "CANCELLED" && payment?.status === "PAID";

  async function run(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
      setConfirming(false);
    } catch (err) {
      setError(apiErrorMessage(err));
    }
  }

  return (
    <Card className="animate-fade-up space-y-3 !p-3.5" style={stagger(index)}>
      <div className="flex items-center gap-4">
        <div className="shrink-0 border-r border-slate-100 pr-3 text-center">
          <p className="whitespace-nowrap text-base font-extrabold text-ink">{appointment.slot ? formatTime(appointment.slot.startsAt) : "–"}</p>
        </div>
        <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate font-semibold text-ink">{appointment.patient?.fullName ?? t("Patient")}</p>
            <p className="flex items-center gap-1.5 text-sm text-muted">
              <Icon name="ticket" className="h-4 w-4 text-brand-500" />
              {t("Token #{n}", { n: appointment.queueToken ?? "–" })}
            </p>
            {refunded && (
              <p className="text-sm font-semibold text-success">{t("Refunded {amount}", { amount: formatRupees(payment!.refund!.amount) })}</p>
            )}
          </div>
          <StatusChip status={appointment.status} />
        </div>
      </div>
      {appointment.status === "BOOKED" &&
        (confirming ? (
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" className="flex-1" onClick={() => setConfirming(false)}>
              {t("Keep")}
            </Button>
            <Button
              variant="danger"
              size="sm"
              className="flex-1"
              loading={cancel.isPending}
              onClick={() => run(() => cancel.mutateAsync({ appointmentId: appointment.id }))}
            >
              {t("Cancel & refund in full")}
            </Button>
          </div>
        ) : (
          <Button variant="ghost" size="sm" className="w-full !text-danger" onClick={() => setConfirming(true)}>
            {t("Cancel this booking")}
          </Button>
        ))}
      {canRefund && (
        <div className="flex items-center justify-between gap-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <span>{payment?.refund?.status === "FAILED" ? t("Refund failed") : t("Cancelled late, not refunded")}</span>
          <Button size="sm" variant="secondary" loading={refundOverride.isPending} onClick={() => run(() => refundOverride.mutateAsync(appointment.id))}>
            {t("Refund anyway")}
          </Button>
        </div>
      )}
      <Alert>{error}</Alert>
    </Card>
  );
}

export function SchedulePage() {
  const t = useT();
  const { data: profile } = useMyDoctorProfile();
  const doctorId = profile?.id ?? null;
  const [date, setDate] = useState(todayKey());
  const { data: appointments, isLoading, isError, refetch } = useDoctorAppointments(doctorId, date);
  const week = Array.from({ length: 7 }, (_, i) => dayKey(i - 1));

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={t("Appointment calendar")}
        title={t("Schedule")}
        subtitle={t("Browse booked appointments by day.")}
        action={
          <label className="w-44">
            <span className="sr-only">{t("Pick a date")}</span>
            <Input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
          </label>
        }
      />

      <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 lg:mx-0 lg:grid lg:grid-cols-7 lg:px-0">
        {week.map((key) => {
          const active = key === date;
          return (
            <button
              key={key}
              type="button"
              aria-pressed={active}
              onClick={() => setDate(key)}
              className={cx(
                "flex w-16 shrink-0 flex-col items-center rounded-2xl py-3 transition-all lg:w-auto",
                active ? "bg-brand-gradient text-white shadow-glow" : "bg-surface text-ink ring-1 ring-slate-200 hover:ring-brand-300",
              )}
            >
              <span className={cx("text-xs font-semibold uppercase", active ? "text-white/80" : "text-muted")}>
                {formatDayKey(key, { weekday: "short" })}
              </span>
              <span className="text-2xl font-extrabold">{Number(key.slice(8))}</span>
              {key === todayKey() && <span className={cx("mt-0.5 h-1.5 w-1.5 rounded-full", active ? "bg-surface" : "bg-brand-500")} />}
            </button>
          );
        })}
      </div>

      {isLoading && (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      )}
      {isError && <ErrorState message={t("Could not load schedule")} onRetry={() => refetch()} />}
      {appointments?.length === 0 && <EmptyState icon="calendar" title={t("No appointments on this date")} />}

      <div className="relative space-y-2.5">
        {appointments?.map((appointment, i) => (
          <ScheduleRow key={appointment.id} appointment={appointment} doctorId={doctorId} index={i} />
        ))}
      </div>
    </div>
  );
}
