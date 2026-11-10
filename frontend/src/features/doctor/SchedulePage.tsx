import { useState } from "react";
import { Icon } from "../../components/icons";
import { Card, EmptyState, ErrorState, Input, PageHeader, Skeleton, StatusChip, cx, stagger } from "../../components/ui";
import { formatTime, todayKey } from "../../lib/formatters";
import { intlLocale } from "../../lib/locale";
import { useDoctorAppointments, useMyDoctorProfile } from "./hooks";
import { useT } from "../../lib/i18n";

/** yyyy-mm-dd in local time, offset from today by `delta` days. */
function dayKey(delta: number) {
  const d = new Date();
  d.setDate(d.getDate() + delta);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
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
          const d = new Date(`${key}T00:00:00`);
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
                {d.toLocaleDateString(intlLocale(), { weekday: "short" })}
              </span>
              <span className="text-2xl font-extrabold">{d.getDate()}</span>
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
          <Card key={appointment.id} className="flex animate-fade-up items-center gap-4 !p-3.5" style={stagger(i)}>
            <div className="w-20 shrink-0 border-r border-slate-100 pr-3 text-center">
              <p className="text-lg font-extrabold text-ink">{appointment.slot ? formatTime(appointment.slot.startsAt) : "–"}</p>
            </div>
            <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-2">
              <p className="flex items-center gap-1.5 font-semibold text-ink">
                <Icon name="ticket" className="h-4 w-4 text-brand-500" />
                {t("Token #{n}", { n: appointment.queueToken ?? "–" })}
              </p>
              <StatusChip status={appointment.status} />
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
