import { useState, type ReactNode } from "react";
import { apiErrorMessage } from "../lib/api";
import type { DoctorQueue } from "../types/api";
import { Alert, AnimatedNumber, Avatar, Button, Card, EmptyState, HeroCard, LiveDot, StatusChip, stagger } from "./ui";
import { useT } from "../lib/i18n";

type Props = {
  queue: DoctorQueue;
  connected: boolean;
  onCallNext: () => Promise<unknown>;
  callNextPending?: boolean;
  callNextDisabled?: boolean;
  onComplete: (appointmentId: string) => Promise<unknown>;
  onNoShow: (appointmentId: string) => Promise<unknown>;
  /** Extra buttons in the hero, e.g. pause/resume. Receives `run` for error handling. */
  extraActions?: (run: (action: () => Promise<unknown>) => void) => ReactNode;
};

/** Live "now serving" hero + patient list. Shared by the doctor's Today page and the front-desk queue board. */
export function QueueBoard({ queue, connected, onCallNext, callNextPending, callNextDisabled, onComplete, onNoShow, extraActions }: Props) {
  const t = useT();
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(apiErrorMessage(err));
    }
  }

  const waiting = queue.queue.filter((e) => e.status === "CHECKED_IN").length;
  const booked = queue.queue.filter((e) => e.status === "BOOKED").length;
  const done = queue.queue.filter((e) => e.status === "COMPLETED").length;
  const inConsult = queue.queue.find((e) => e.status === "IN_CONSULTATION");
  const progress = queue.queue.length ? Math.round((done / queue.queue.length) * 100) : 0;

  return (
    <div className="space-y-5 xl:grid xl:grid-cols-[minmax(0,420px)_1fr] xl:items-start xl:gap-6 xl:space-y-0">
      <div className="xl:sticky xl:top-10">
      <HeroCard className="animate-fade-up">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs font-bold uppercase tracking-wider">
            <LiveDot className={connected ? "bg-success" : "bg-amber-300"} pulse={connected} />
            {connected ? t("Live") : t("Reconnecting")}
          </span>
          {queue.status !== "OPEN" && (
            <span className="rounded-full bg-surface px-3 py-1 text-xs font-bold uppercase tracking-wider text-brand-700">
              {queue.status === "PAUSED" ? t("Paused") : t("Closed")}
            </span>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-white/70">{t("Now serving")}</p>
            <p className="text-6xl font-extrabold leading-none tracking-tight sm:text-7xl">
              #<AnimatedNumber value={queue.nowServing} />
            </p>
            <p className="mt-2 h-5 text-sm font-medium text-white/80">{inConsult?.patientName ?? " "}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {extraActions?.(run)}
            <Button
              size="lg"
              variant="white"
              iconRight="arrowRight"
              loading={callNextPending}
              disabled={callNextDisabled}
              onClick={() => run(onCallNext)}
            >
              {t("Call next")}
            </Button>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-3 gap-2 text-center">
          {[
            { label: t("Waiting"), value: waiting },
            { label: t("Booked"), value: booked },
            { label: t("Done"), value: done },
          ].map((s) => (
            <div key={s.label} className="rounded-2xl bg-white/10 px-2 py-2.5 backdrop-blur">
              <p className="text-xl font-extrabold">
                <AnimatedNumber value={s.value} />
              </p>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-white/70">{s.label}</p>
            </div>
          ))}
        </div>
        <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/20">
          <div className="h-full rounded-full bg-surface transition-all duration-700" style={{ width: `${progress}%` }} />
        </div>
      </HeroCard>
      </div>

      <div className="min-w-0 space-y-5">
      <Alert>{error}</Alert>

      {queue.queue.length === 0 ? (
        <EmptyState icon="users" title={t("No patients yet today")} hint={t("Bookings will show up here in real time.")} />
      ) : (
        <div className="space-y-2.5">
          {queue.queue.map((entry, i) => {
            const active = entry.status === "IN_CONSULTATION";
            const faded = entry.status === "COMPLETED" || entry.status === "CANCELLED" || entry.status === "NO_SHOW";
            return (
              <Card
                key={entry.appointmentId}
                style={stagger(i)}
                className={`flex animate-fade-up flex-wrap items-center gap-3 !p-3 transition-all sm:flex-nowrap ${
                  active ? "!border-brand-300 ring-2 ring-brand-400/40" : ""
                } ${faded ? "opacity-60" : ""}`}
              >
                <span
                  className={`grid h-12 w-12 shrink-0 place-items-center rounded-xl text-lg font-extrabold tabular-nums ${
                    active ? "bg-brand-gradient text-white shadow-glow" : "bg-brand-50 text-brand-700"
                  }`}
                >
                  {entry.token ?? "–"}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Avatar name={entry.patientName} size="sm" />
                    <p className="truncate font-semibold text-slate-900">{entry.patientName ?? t("Patient")}</p>
                    {entry.isWalkIn && (
                      <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-700 ring-1 ring-amber-200">{t("Walk-in")}</span>
                    )}
                  </div>
                  <div className="mt-1.5">
                    <StatusChip status={entry.status} />
                  </div>
                </div>
                <div className="flex shrink-0 justify-end gap-2 empty:hidden max-sm:w-full">
                  {(entry.status === "BOOKED" || entry.status === "CHECKED_IN") && (
                    <Button variant="outline" size="sm" onClick={() => run(() => onNoShow(entry.appointmentId))}>
                      {t("No-show")}
                    </Button>
                  )}
                  {active && (
                    <Button size="sm" icon="check" onClick={() => run(() => onComplete(entry.appointmentId))}>
                      {t("Complete")}
                    </Button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
      </div>
    </div>
  );
}

