import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Link, useParams } from "react-router-dom";
import { Alert, AnimatedNumber, Button, Card, EmptyState, ErrorState, LiveDot, PageHeader, Spinner, StatusChip, stagger } from "../../components/ui";
import { Icon } from "../../components/icons";
import { apiErrorMessage } from "../../lib/api";
import { formatDate, formatRupees, formatTime } from "../../lib/formatters";
import { useQueueSocket } from "../../lib/useQueueSocket";
import { useAppointment, useCancelAppointment, useQueueStatus } from "./hooks";
import { useT } from "../../lib/i18n";

export function TicketPage() {
  const t = useT();
  const { appointmentId } = useParams();
  const { data: appointment, isLoading, isError, refetch } = useAppointment(appointmentId);
  const { data: queueStatus } = useQueueStatus(appointmentId);
  const cancelAppointment = useCancelAppointment();
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [confirmingCancel, setConfirmingCancel] = useState(false);

  const { connected } = useQueueSocket(appointment?.doctorId ?? null);

  // Keep the screen awake and bright while the ticket is open, where supported.
  useEffect(() => {
    let wakeLock: WakeLockSentinel | null = null;
    navigator.wakeLock
      ?.request("screen")
      .then((lock) => (wakeLock = lock))
      .catch(() => {});
    return () => {
      void wakeLock?.release();
    };
  }, []);

  if (isLoading) return <Spinner />;
  if (isError || !appointment) return <ErrorState message={t("Could not load your ticket")} onRetry={() => refetch()} />;

  const isActive = appointment.status === "BOOKED";
  const fee = appointment.payment?.amount ?? appointment.doctor?.consultationFee ?? 0;
  // Same rule as the server (REFUND_CUTOFF_HOURS): 2+ hours before the slot.
  const refundable = !!appointment.slot && new Date(appointment.slot.startsAt).getTime() - Date.now() >= 2 * 3_600_000;
  const refund = appointment.payment?.refund;
  const cancelledHint =
    refund?.status === "PROCESSED"
      ? t("A full refund of {amount} was issued to your original payment method. It usually arrives in 5-7 working days.", { amount: formatRupees(refund.amount) })
      : refund?.status === "FAILED"
        ? t("Your refund could not be processed automatically. The clinic will contact you.")
        : appointment.payment?.status === "PAID"
          ? t("It was cancelled less than 2 hours before the slot, so no refund applies.")
          : t("No payment was taken for this booking.");

  async function handleCancel() {
    if (!appointmentId) return;
    setCancelError(null);
    try {
      await cancelAppointment.mutateAsync({ appointmentId });
    } catch (err) {
      setCancelError(apiErrorMessage(err));
    }
  }

  const myToken = appointment.queueToken ?? 0;
  const nowServing = queueStatus?.nowServing ?? 0;
  const ahead = queueStatus?.patientsAhead ?? 0;
  const progress = myToken ? Math.min(100, Math.round((nowServing / myToken) * 100)) : 0;
  const isYourTurn = appointment.status === "IN_CONSULTATION" || (myToken > 0 && nowServing === myToken);

  return (
    <div className="space-y-4">
      <PageHeader eyebrow={t("Live ticket")} title={t("Your ticket")} />

      {appointment.status === "CANCELLED" ? (
        <EmptyState icon="x" title={t("This appointment was cancelled")} hint={cancelledHint} />
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,400px)_1fr] lg:items-start lg:gap-6">
          {/* Ticket stub */}
          <div className="animate-fade-up overflow-hidden rounded-3xl bg-surface shadow-lift ring-1 ring-slate-900/5">
            <div className="relative overflow-hidden bg-hero-gradient px-5 pb-6 pt-5 text-white">
              <div className="pointer-events-none absolute -right-10 -top-10 h-36 w-36 rounded-full bg-white/15" />
              <div className="relative flex items-center justify-between">
                <span className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs font-bold uppercase tracking-wider">
                  <LiveDot className={connected ? "bg-success" : "bg-amber-300"} pulse={connected} />
                  {connected ? t("Live") : t("Syncing")}
                </span>
                <StatusChip status={appointment.status} />
              </div>
              <p className="relative mt-4 text-sm font-medium text-white/70">{t("Token")}</p>
              <p className="relative text-7xl font-extrabold leading-none tracking-tight">#{appointment.queueToken ?? "–"}</p>
              {appointment.doctor && (
                <p className="relative mt-2 text-sm font-semibold text-white/90">
                  {appointment.doctor.fullName} · {appointment.doctor.specialization}
                </p>
              )}
            </div>

            {/* perforation */}
            <div className="relative flex items-center">
              <span className="-ml-3 h-6 w-6 rounded-full bg-canvas" />
              <span className="mx-2 flex-1 border-t-2 border-dashed border-slate-200" />
              <span className="-mr-3 h-6 w-6 rounded-full bg-canvas" />
            </div>

            <div className="flex flex-col items-center gap-2 px-5 pb-6 pt-3">
              <div className="rounded-2xl bg-[#fff] p-3 shadow-soft ring-1 ring-slate-100">
                <QRCodeSVG value={appointment.qrToken?.token ?? ""} size={184} fgColor="#0f172a" role="img" aria-label={t("Check-in QR code")} />
              </div>
              {appointment.qrToken?.shortCode && (
                <p className="text-center text-xs font-medium text-slate-500">
                  {t("Check-in code")}{" "}
                  <span data-testid="checkin-code" className="font-mono text-base font-bold tracking-widest text-ink">
                    {appointment.qrToken.shortCode.slice(0, 4)}-{appointment.qrToken.shortCode.slice(4)}
                  </span>
                </p>
              )}
              <p className="flex items-center gap-1.5 text-xs font-medium text-slate-400">
                <Icon name="scan" className="h-4 w-4" /> {t("Show this at the front desk to check in")}
              </p>
            </div>
          </div>

          <div className="min-w-0 space-y-4">
          {/* Live queue status */}
          <Card className="animate-fade-up p-5" style={stagger(1, 80)}>
            {isYourTurn ? (
              <div className="flex items-center gap-3">
                <span className="grid h-12 w-12 place-items-center rounded-2xl bg-brand-gradient text-white shadow-glow">
                  <Icon name="bolt" />
                </span>
                <div>
                  <p className="text-lg font-extrabold text-slate-900">{t("It's your turn!")}</p>
                  <p className="text-sm text-slate-500">{t("Please head to the doctor's room.")}</p>
                </div>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div>
                    <p className="text-xs font-medium text-slate-400">{t("Now serving")}</p>
                    <p className="text-3xl font-extrabold text-brand-600">
                      <AnimatedNumber value={nowServing} />
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-slate-400">{t("Ahead of you")}</p>
                    <p className="text-3xl font-extrabold text-slate-900">
                      <AnimatedNumber value={ahead} />
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-slate-400">{t("Est. wait")}</p>
                    <p className="text-3xl font-extrabold text-slate-900">
                      <AnimatedNumber value={queueStatus?.estimatedWaitMinutes ?? "–"} />
                      <span className="text-sm font-semibold text-slate-400"> {t("min")}</span>
                    </p>
                  </div>
                </div>
                <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-brand-gradient transition-all duration-700" style={{ width: `${progress}%` }} />
                </div>
              </>
            )}
          </Card>

          {appointment.slot && (
            <Card className="animate-fade-up space-y-3 p-5" style={stagger(2, 80)}>
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-gradient-soft text-brand-700">
                  <Icon name="calendar" />
                </span>
                <div>
                  <p className="font-bold text-slate-900">{formatTime(appointment.slot.startsAt)}</p>
                  <p className="text-sm text-slate-500">{formatDate(appointment.slot.startsAt)}</p>
                </div>
              </div>
              {appointment.doctor && (
                <div className="flex items-center gap-3">
                  <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-gradient-soft text-brand-700">
                    <Icon name="building" />
                  </span>
                  <p className="text-sm text-slate-600">{appointment.doctor.clinic.address}</p>
                </div>
              )}
              {appointment.payment && (
                <div className="flex items-center gap-3">
                  <span className="grid h-10 w-10 place-items-center rounded-xl bg-success-soft text-success">
                    <Icon name="check" />
                  </span>
                  <p className="text-sm text-slate-600">{t("Paid {amount}", { amount: formatRupees(appointment.payment.amount) })}</p>
                </div>
              )}
            </Card>
          )}

          {isActive && (
            <div className="space-y-2">
              <Alert>{cancelError}</Alert>
              {!confirmingCancel ? (
                <div className="flex gap-2">
                  {refundable && (
                    <Link to={`/patient/reschedule/${appointment.id}`} className="flex-1">
                      <Button variant="secondary" icon="calendar" className="w-full">
                        {t("Reschedule")}
                      </Button>
                    </Link>
                  )}
                  <Button variant="ghost" className="flex-1 !text-danger hover:!bg-danger-soft" onClick={() => setConfirmingCancel(true)}>
                    {t("Cancel appointment")}
                  </Button>
                </div>
              ) : (
                <div className="animate-fade-in space-y-2">
                <p className={`rounded-2xl px-3 py-2.5 text-sm font-medium ${refundable ? "bg-success-soft text-success" : "bg-amber-50 text-amber-800"}`}>
                  {refundable
                    ? t("You will get a full refund of {amount}.", { amount: formatRupees(fee) })
                    : t("Your slot is less than 2 hours away, so cancelling now gives no refund.")}
                </p>
                <div className="flex gap-2">
                  <Button variant="secondary" className="flex-1" onClick={() => setConfirmingCancel(false)}>
                    {t("Keep it")}
                  </Button>
                  <Button variant="danger" className="flex-1" loading={cancelAppointment.isPending} onClick={handleCancel}>
                    {t("Confirm cancel")}
                  </Button>
                </div>
                </div>
              )}
            </div>
          )}
          </div>
          </div>
        </>
      )}
    </div>
  );
}
