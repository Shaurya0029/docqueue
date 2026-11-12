import { useState, type FormEvent } from "react";
import { Icon } from "../../components/icons";
import { Alert, Button, Card, Input } from "../../components/ui";
import { apiErrorMessage } from "../../lib/api";
import { useT } from "../../lib/i18n";
import type { LeaveAlertState } from "../../types/api";
import { useDisableLeaveAlert, useSetLeaveAlert } from "./hooks";

/** Reads the device location once. The coordinates go to the server only to compute travel time. */
function locateOnce(): Promise<{ latitude: number; longitude: number }> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject(new Error("unsupported"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
      (err) => reject(err),
      { enableHighAccuracy: false, timeout: 15_000, maximumAge: 5 * 60_000 },
    );
  });
}

/**
 * "Leave now" alerts on the ticket. Location permission is asked only when
 * the patient taps the button; if it is refused they can type their travel
 * time instead, and they can always correct the estimate.
 */
export function LeaveNowCard({ appointmentId, state }: { appointmentId: string; state: LeaveAlertState }) {
  const t = useT();
  const setAlert = useSetLeaveAlert(appointmentId);
  const disable = useDisableLeaveAlert(appointmentId);
  const [manualOpen, setManualOpen] = useState(false);
  const [minutes, setMinutes] = useState(String(state.travelMinutes ?? ""));
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!state.available) return null;

  async function turnOnFromLocation() {
    setError(null);
    setLocating(true);
    try {
      const position = await locateOnce();
      const result = await setAlert.mutateAsync(position);
      setMinutes(String(result.travelMinutes ?? ""));
    } catch (err) {
      const denied = typeof err === "object" && err !== null && "code" in err && (err as GeolocationPositionError).code === 1;
      setError(
        err instanceof Error && err.message === "unsupported"
          ? t("This device can't share its location. Enter your travel time instead.")
          : denied
            ? t("Location permission was not given. Enter your travel time instead.")
            : "code" in (err as object)
              ? t("We couldn't get your location. Enter your travel time instead.")
              : apiErrorMessage(err),
      );
      setManualOpen(true);
    } finally {
      setLocating(false);
    }
  }

  async function saveMinutes(event: FormEvent) {
    event.preventDefault();
    const value = Number(minutes);
    if (!Number.isInteger(value) || value < 1 || value > 300) {
      setError(t("Enter a travel time between 1 and 300 minutes"));
      return;
    }
    setError(null);
    try {
      await setAlert.mutateAsync({ travelMinutes: value });
      setManualOpen(false);
    } catch (err) {
      setError(apiErrorMessage(err));
    }
  }

  async function turnOff() {
    setError(null);
    try {
      await disable.mutateAsync();
      setManualOpen(false);
    } catch (err) {
      setError(apiErrorMessage(err));
    }
  }

  const minutesForm = (
    <form onSubmit={saveMinutes} className="flex items-end gap-2">
      <label className="min-w-0 flex-1">
        <span className="label">{t("Travel time to the clinic (minutes)")}</span>
        <Input type="number" inputMode="numeric" min={1} max={300} icon="navigation" value={minutes} onChange={(e) => setMinutes(e.target.value)} />
      </label>
      <Button type="submit" variant="secondary" className="shrink-0" loading={setAlert.isPending}>
        {t("Save")}
      </Button>
    </form>
  );

  return (
    <section data-testid="leave-now">
      <Card className="space-y-3 p-5">
        <div className="flex items-start gap-3">
          <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${state.enabled ? "bg-success-soft text-success" : "bg-brand-gradient-soft text-brand-700"}`}>
            <Icon name="navigation" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-bold text-ink">
              {t("Leave now alerts")}{" "}
              <span className={`ml-1 rounded-full px-2 py-0.5 text-xs font-bold ${state.enabled ? "bg-success-soft text-success" : "bg-slate-100 text-slate-500"}`}>
                {state.enabled ? t("On") : t("Off")}
              </span>
            </p>
            {state.enabled ? (
              <>
                <p className="text-sm text-muted">
                  {state.source === "manual"
                    ? t("Travel time: {n} min (you set this).", { n: state.travelMinutes ?? 0 })
                    : t("Travel time: about {n} min (estimated from your location).", { n: state.travelMinutes ?? 0 })}
                </p>
                <p className="mt-1 text-sm font-medium text-ink">
                  {state.sentAt ? t("We've texted you: it's time to leave.") : t("We'll text you when it's time to leave.")}
                </p>
              </>
            ) : (
              <p className="text-sm text-muted">
                {t("We'll text you when it's time to leave, based on the queue and your travel time. Your location is used once to estimate the trip and is not stored.")}
              </p>
            )}
          </div>
        </div>

        {!state.enabled && !manualOpen && (
          <div className="space-y-2">
            <Button icon="navigation" className="w-full" loading={locating || setAlert.isPending} onClick={() => void turnOnFromLocation()}>
              {t("Turn on leave-now alerts")}
            </Button>
            <button type="button" className="w-full text-center text-sm font-semibold text-brand-600 hover:underline" onClick={() => setManualOpen(true)}>
              {t("Enter my travel time instead")}
            </button>
          </div>
        )}
        {(manualOpen || state.enabled) && minutesForm}
        {state.enabled && (
          <Button variant="ghost" size="sm" className="w-full" loading={disable.isPending} onClick={() => void turnOff()}>
            {t("Turn off")}
          </Button>
        )}
        <Alert>{error}</Alert>
      </Card>
    </section>
  );
}
