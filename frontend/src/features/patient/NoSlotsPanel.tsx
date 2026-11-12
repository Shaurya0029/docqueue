import { useState } from "react";
import { Link } from "react-router-dom";
import { Icon } from "../../components/icons";
import { Alert, Avatar, Button, Card, EmptyState, ErrorState, Skeleton } from "../../components/ui";
import { apiErrorMessage } from "../../lib/api";
import { formatDate, formatRupees, formatTime } from "../../lib/formatters";
import { useT } from "../../lib/i18n";
import { useAlternativeDoctors, useSetSlotAlert, useSlotAlert } from "./hooks";

/** Shown when a doctor has no open slots: get an SMS when they open, or see who is free. */
export function NoSlotsPanel({ doctorId, doctorName }: { doctorId: string; doctorName: string }) {
  const t = useT();
  const alert = useSlotAlert(doctorId);
  const setAlert = useSetSlotAlert(doctorId);
  const [showAlternatives, setShowAlternatives] = useState(false);
  const alternatives = useAlternativeDoctors(doctorId, showAlternatives);
  const [error, setError] = useState<string | null>(null);

  async function toggleAlert(subscribe: boolean) {
    setError(null);
    try {
      await setAlert.mutateAsync(subscribe);
    } catch (err) {
      setError(apiErrorMessage(err));
    }
  }

  return (
    <div className="space-y-4">
      <EmptyState icon="calendar" title={t("No upcoming slots")} hint={t("{name} hasn't opened new slots yet.", { name: doctorName })} />

      <Card className="space-y-3 p-4">
        {alert.data ? (
          <div className="flex items-start gap-3" role="status">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-success-soft text-success">
              <Icon name="bell" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-ink">{t("We'll text you when slots open")}</p>
              <button type="button" className="text-sm font-semibold text-brand-600 hover:underline" onClick={() => toggleAlert(false)}>
                {t("Stop this alert")}
              </button>
            </div>
          </div>
        ) : (
          <Button icon="bell" className="w-full" loading={setAlert.isPending || alert.isLoading} onClick={() => toggleAlert(true)}>
            {t("Notify me when slots open")}
          </Button>
        )}
        {!showAlternatives && (
          <Button variant="secondary" icon="users" className="w-full" onClick={() => setShowAlternatives(true)}>
            {t("Show next available doctor")}
          </Button>
        )}
        <Alert>{error}</Alert>
      </Card>

      {showAlternatives && (
        <section className="space-y-2.5" aria-label={t("Next available doctors")}>
          <h2 className="text-sm font-bold uppercase tracking-wider text-muted">{t("Next available doctors")}</h2>
          {alternatives.isLoading && [0, 1].map((i) => <Skeleton key={i} className="h-20" />)}
          {alternatives.isError && <ErrorState message={t("Could not load other doctors")} onRetry={() => alternatives.refetch()} />}
          {alternatives.data?.length === 0 && (
            <EmptyState icon="users" title={t("No other doctor has open slots right now")} hint={t("Turn on the alert above and we'll text you.")} />
          )}
          {alternatives.data?.map((d) => (
            <Link key={d.id} to={`/patient/doctor/${d.id}`} className="block">
              <Card className="flex items-center gap-3 !p-3.5 transition hover:ring-brand-300">
                <Avatar name={d.fullName} />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1 truncate font-bold text-ink">
                    {d.fullName}
                    {d.isVerified && <Icon name="verified" className="h-4 w-4 shrink-0 text-brand-600" aria-label={t("Verified")} />}
                  </p>
                  <p className="truncate text-sm text-brand-600">{t(d.specialization)}</p>
                  <p className="text-xs font-semibold text-success">
                    {t("Next: {date}, {time}", { date: formatDate(d.nextSlot.startsAt), time: formatTime(d.nextSlot.startsAt) })}
                  </p>
                </div>
                <span className="shrink-0 font-extrabold text-ink">{formatRupees(d.consultationFee)}</span>
              </Card>
            </Link>
          ))}
        </section>
      )}
    </div>
  );
}
