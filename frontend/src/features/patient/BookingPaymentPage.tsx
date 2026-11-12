import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { Icon } from "../../components/icons";
import { Alert, Avatar, Button, Card, ErrorState, InfoRow, PageHeader, Reveal, Section, Spinner, StatusChip } from "../../components/ui";
import { api, apiErrorMessage } from "../../lib/api";
import { CheckoutDismissedError, openRazorpayCheckout } from "../../lib/razorpay";
import type { Appointment } from "../../types/api";
import { formatDate, formatRupees, formatTime } from "../../lib/formatters";
import { useAppointment, useCreateOrder, useSimulatePayment } from "./hooks";
import { useT } from "../../lib/i18n";

const HOLD_MS = 10 * 60 * 1000; // matches the backend's releaseExpiredHolds job

/**
 * The booking is confirmed by the gateway's webhook, not by the browser, so
 * after paying we wait for the server to report the appointment as BOOKED.
 */
async function waitForBooking(appointmentId: string, timeoutMs = 60_000): Promise<Appointment["status"]> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const res = await api.get<{ appointment: Appointment }>(`/appointments/${appointmentId}`);
    const status = res.data.appointment.status;
    if (status !== "PENDING_PAYMENT" || Date.now() > deadline) return status;
    await new Promise((r) => setTimeout(r, 1500));
  }
}

function useCountdown(deadline: number | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!deadline) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [deadline]);
  return deadline ? Math.max(0, deadline - now) : null;
}

export function BookingPaymentPage() {
  const t = useT();
  const { appointmentId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: appointment, isLoading, isError, refetch } = useAppointment(appointmentId);
  const createOrder = useCreateOrder();
  const simulatePayment = useSimulatePayment();
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const remaining = useCountdown(appointment ? new Date(appointment.createdAt).getTime() + HOLD_MS : null);

  if (isLoading) return <Spinner />;
  if (isError || !appointment) return <ErrorState message={t("Could not load this booking")} onRetry={() => refetch()} />;
  if (appointment.status !== "PENDING_PAYMENT") return <Navigate to={`/patient/ticket/${appointment.id}`} replace />;

  async function payNow() {
    if (!appointmentId) return;
    setError(null);
    setPaying(true);
    try {
      const order = await createOrder.mutateAsync(appointmentId);
      if (order.mode === "stub") {
        await simulatePayment.mutateAsync(appointmentId);
      } else {
        await openRazorpayCheckout({
          keyId: order.keyId,
          orderId: order.orderId,
          amount: order.amount,
          description: appointment?.doctor?.fullName ?? "Consultation",
        });
      }
      setConfirming(true);
      const status = await waitForBooking(appointmentId);
      await queryClient.invalidateQueries({ queryKey: ["my-appointments"] });
      await queryClient.invalidateQueries({ queryKey: ["appointment", appointmentId] });
      if (status === "BOOKED") {
        navigate(`/patient/ticket/${appointmentId}`, { replace: true });
      } else if (status === "PENDING_PAYMENT") {
        setError(t("Payment received, but confirmation is taking longer than usual. Check My appointments in a minute."));
      } else {
        setError(t("This slot is no longer available. If you were charged, the full amount is refunded automatically."));
      }
    } catch (err) {
      if (!(err instanceof CheckoutDismissedError)) {
        setError(err instanceof Error && !("isAxiosError" in err) ? err.message : apiErrorMessage(err));
      }
    } finally {
      setPaying(false);
      setConfirming(false);
    }
  }

  const fee = appointment.doctor?.consultationFee;
  const expired = remaining === 0;
  const mm = remaining !== null ? Math.floor(remaining / 60000) : 0;
  const ss = remaining !== null ? Math.floor((remaining % 60000) / 1000) : 0;

  return (
    <div className="space-y-5">
      <PageHeader eyebrow={t("Step 2 of 2")} title={t("Confirm & pay")} subtitle={t("Your slot is held while you complete payment.")} />

      <div className="grid gap-5 lg:grid-cols-2 lg:items-start">
      <div className="space-y-5">
      <Reveal>
        <div
          className={`flex items-center justify-between rounded-2xl px-4 py-3 ring-1 ${
            expired ? "bg-danger-soft text-danger ring-danger/20" : "bg-lavender text-accent-800 ring-accent-200"
          }`}
        >
          <span className="flex items-center gap-2 text-sm font-semibold">
            <Icon name="clock" className="h-4 w-4" />
            {expired ? t("Hold expired — this slot may have been released") : t("Slot held for")}
          </span>
          {!expired && (
            <span className="font-mono text-lg font-extrabold tabular-nums">
              {String(mm).padStart(2, "0")}:{String(ss).padStart(2, "0")}
            </span>
          )}
        </div>
      </Reveal>

      <Reveal delay={0.05}>
        <Card className="p-5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <Avatar name={appointment.doctor?.fullName} />
              <div className="min-w-0">
                <p className="truncate font-bold text-ink">{appointment.doctor?.fullName ?? t("Your doctor")}</p>
                <p className="text-sm font-semibold text-brand-600">{appointment.doctor?.specialization ? t(appointment.doctor.specialization) : null}</p>
              </div>
            </div>
            <StatusChip status={appointment.status} />
          </div>
          {appointment.slot && (
            <div className="mt-4 grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-2">
              <InfoRow icon="calendar" label={t("Date")} value={formatDate(appointment.slot.startsAt)} />
              <InfoRow icon="clock" label={t("Time")} value={formatTime(appointment.slot.startsAt)} />
              {appointment.doctor?.clinic && <InfoRow icon="pin" label={t("Clinic")} value={appointment.doctor.clinic.name} />}
            </div>
          )}
        </Card>
      </Reveal>

      </div>
      <div className="space-y-5">
      <Reveal delay={0.1}>
        <Section title={t("Bill summary")} icon="file">
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted">{t("Consultation fee")}</span>
              <span className="font-semibold">{fee !== undefined ? formatRupees(fee) : "—"}</span>
            </div>
            <div className="flex justify-between border-t border-dashed border-slate-200 pt-3 text-base">
              <span className="font-bold">{t("Total payable")}</span>
              <span className="font-extrabold text-brand-700">{fee !== undefined ? formatRupees(fee) : "—"}</span>
            </div>
          </div>
          <p className="mt-4 flex items-start gap-2 rounded-xl bg-success-soft px-3 py-2.5 text-xs font-medium text-success">
            <Icon name="shield" className="mt-0.5 h-4 w-4 shrink-0" />
            {t("Full refund if cancelled 2+ hours before your slot. No refund after that.")}
          </p>
        </Section>
      </Reveal>

      <Alert>{error}</Alert>
      <Button size="lg" icon="card" className="w-full" loading={paying} disabled={expired} onClick={payNow}>
        {confirming
          ? t("Confirming your payment…")
          : fee !== undefined
            ? t("Pay {amount} securely", { amount: formatRupees(fee) })
            : t("Pay now")}
      </Button>
      <p className="flex items-center justify-center gap-1.5 text-xs text-muted">
        <Icon name="lock" className="h-3.5 w-3.5" /> {t("Payments are encrypted and processed by our payment partner")}
      </p>
      </div>
      </div>
    </div>
  );
}
