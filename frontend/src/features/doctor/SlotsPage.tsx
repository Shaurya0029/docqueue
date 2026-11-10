import { useState } from "react";
import { Alert, Button, Card, EmptyState, ErrorState, Field, Input, PageHeader, Section, Skeleton, cx } from "../../components/ui";
import { Icon } from "../../components/icons";
import { apiErrorMessage } from "../../lib/api";
import { formatDate, formatTime, todayKey } from "../../lib/formatters";
import { useCreateBulkSlots, useDeleteSlot, useDoctorSlots, useMyDoctorProfile } from "./hooks";
import { useT } from "../../lib/i18n";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function SlotsPage() {
  const t = useT();
  const { data: profile } = useMyDoctorProfile();
  const doctorId = profile?.id ?? null;
  const { data: slots, isLoading, isError, refetch } = useDoctorSlots(doctorId);
  const createBulk = useCreateBulkSlots(doctorId);
  const deleteSlot = useDeleteSlot(doctorId);

  const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [startTime, setStartTime] = useState("10:00");
  const [endTime, setEndTime] = useState("17:00");
  const [slotMinutes, setSlotMinutes] = useState(15);
  const [fromDate, setFromDate] = useState(todayKey());
  const [toDate, setToDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 13);
    return d.toISOString().slice(0, 10);
  });
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<number | null>(null);

  function toggleWeekday(day: number) {
    setWeekdays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]));
  }

  async function generateSlots() {
    setError(null);
    setCreated(null);
    try {
      const res = await createBulk.mutateAsync({
        pattern: weekdays.map((weekday) => ({ weekday, startTime, endTime, slotMinutes })),
        fromDate,
        toDate,
      });
      setCreated((res as { created: number }).created);
    } catch (err) {
      setError(apiErrorMessage(err));
    }
  }

  const upcoming = [...(slots ?? [])].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const byDay = upcoming.reduce<Record<string, typeof upcoming>>((acc, slot) => {
    (acc[slot.slotDate] ??= []).push(slot);
    return acc;
  }, {});

  const timeInvalid = startTime >= endTime;
  const lengthInvalid = !Number.isFinite(slotMinutes) || slotMinutes < 5 || slotMinutes > 120;
  const rangeInvalid = fromDate > toDate;
  const formInvalid = weekdays.length === 0 || timeInvalid || lengthInvalid || rangeInvalid;

  return (
    <div className="space-y-6">
      <PageHeader eyebrow={t("Availability")} title={t("Time slots")} subtitle={t("Build a weekly pattern, then fine-tune individual slots below.")} />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,420px)_1fr]">
        <Section title={t("Weekly pattern")} icon="calendarCheck" className="h-fit">
          <form
            noValidate
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!formInvalid) void generateSlots();
            }}
          >
            <div>
              <span className="label">{t("Working days")}</span>
              <div className="grid grid-cols-7 gap-1.5">
                {WEEKDAYS.map((label, idx) => (
                  <button
                    key={label}
                    type="button"
                    aria-pressed={weekdays.includes(idx)}
                    onClick={() => toggleWeekday(idx)}
                    className={cx(
                      "rounded-xl py-2 text-xs font-bold transition-all",
                      weekdays.includes(idx) ? "bg-brand-600 text-white shadow-glow" : "bg-slate-100 text-muted hover:text-ink",
                    )}
                  >
                    {t(label)}
                  </button>
                ))}
              </div>
              {weekdays.length === 0 && <p className="mt-1.5 text-xs font-semibold text-danger">{t("Select at least one day")}</p>}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("Start time")}>
                <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
              </Field>
              <Field label={t("End time")} error={timeInvalid ? t("Must be after start") : null}>
                <Input type="time" value={endTime} aria-invalid={timeInvalid || undefined} onChange={(e) => setEndTime(e.target.value)} />
              </Field>
              <Field label={t("From date")}>
                <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
              </Field>
              <Field label={t("To date")} error={rangeInvalid ? t("Must be after from date") : null}>
                <Input type="date" value={toDate} aria-invalid={rangeInvalid || undefined} onChange={(e) => setToDate(e.target.value)} />
              </Field>
            </div>
            <Field label={t("Slot length (minutes)")} error={lengthInvalid ? t("Between 5 and 120 minutes") : null}>
              <Input
                type="number"
                min={5}
                max={120}
                icon="clock"
                value={slotMinutes}
                aria-invalid={lengthInvalid || undefined}
                onChange={(e) => setSlotMinutes(Number(e.target.value))}
              />
            </Field>
            <Alert>{error}</Alert>
            <Alert tone="success">{created !== null ? t("Created {n} slots", { n: created }) : null}</Alert>
            <Button type="submit" icon="sparkles" className="w-full" disabled={formInvalid} loading={createBulk.isPending}>
              {t("Generate slots")}
            </Button>
          </form>
        </Section>

        <div>
          <h2 className="mb-3 flex items-center justify-between text-base font-bold">
            {t("Upcoming slots")}
            <span className="text-xs font-semibold text-muted">
              {t("{booked} booked / {total}", { booked: upcoming.filter((s) => s.isBooked).length, total: upcoming.length })}
            </span>
          </h2>
          {isLoading && <Skeleton className="h-40" />}
          {isError && <ErrorState message={t("Could not load slots")} onRetry={() => refetch()} />}
          {upcoming.length === 0 && !isLoading && <EmptyState icon="clock" title={t("No upcoming slots")} hint={t("Generate a weekly pattern to open bookings.")} />}
          <div className="space-y-3">
            {Object.entries(byDay).map(([day, daySlots]) => (
              <Card key={day} className="animate-fade-up p-4">
                <p className="mb-3 text-sm font-bold text-ink">{formatDate(daySlots[0].startsAt)}</p>
                <div className="flex flex-wrap gap-2">
                  {daySlots.map((slot) =>
                    slot.isBooked ? (
                      <span
                        key={slot.id}
                        title={t("Booked")}
                        className="inline-flex items-center gap-1 rounded-xl bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white"
                      >
                        {formatTime(slot.startsAt)}
                        <Icon name="check" className="h-3.5 w-3.5" />
                      </span>
                    ) : (
                      <span key={slot.id} className="group inline-flex items-center gap-1 rounded-xl bg-surface py-1.5 pl-3 pr-1.5 text-sm font-semibold text-ink ring-1 ring-slate-200">
                        {formatTime(slot.startsAt)}
                        <button
                          type="button"
                          aria-label={t("Remove {time} slot", { time: formatTime(slot.startsAt) })}
                          onClick={() => deleteSlot.mutate(slot.id)}
                          className="grid h-6 w-6 place-items-center rounded-lg text-slate-400 transition hover:bg-danger-soft hover:text-danger"
                        >
                          <Icon name="x" className="h-3.5 w-3.5" />
                        </button>
                      </span>
                    ),
                  )}
                </div>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
