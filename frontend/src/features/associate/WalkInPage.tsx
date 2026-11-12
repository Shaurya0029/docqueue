import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Icon } from "../../components/icons";
import { Alert, Button, EmptyState, Field, Input, PageHeader, PhoneInput, isValidIndianMobile, toE164India } from "../../components/ui";
import { apiErrorMessage } from "../../lib/api";
import { formatRupees, formatTime } from "../../lib/formatters";
import { useT } from "../../lib/i18n";
import { useActiveDoctor } from "./ActiveDoctorContext";
import { useAddWalkIn, type WalkInResult } from "./hooks";

/** Add a patient who has no app: they get the doctor's next free slot today and a token. */
export function WalkInPage() {
  const t = useT();
  const { doctorId, doctors } = useActiveDoctor();
  const doctor = doctors.find((d) => d.id === doctorId);
  const addWalkIn = useAddWalkIn(doctorId);
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [feeCollected, setFeeCollected] = useState(true);
  const [consent, setConsent] = useState(false);
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<WalkInResult | null>(null);

  if (!doctorId) return <EmptyState icon="stethoscope" title={t("No doctor selected")} hint={t("Select a doctor above to add a walk-in.")} />;

  const nameInvalid = touched && fullName.trim().length < 2;
  const phoneInvalid = touched && !isValidIndianMobile(phone);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (fullName.trim().length < 2 || !isValidIndianMobile(phone) || !consent) return;
    setError(null);
    try {
      const res = await addWalkIn.mutateAsync({ fullName: fullName.trim(), phoneNumber: toE164India(phone), feeCollected, consent: true });
      setResult(res);
      setFullName("");
      setPhone("");
      setConsent(false);
      setTouched(false);
    } catch (err) {
      setError(apiErrorMessage(err));
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader eyebrow={t("Front desk")} title={t("Add a walk-in")} subtitle={t("For patients without the app. They get the next free slot today and an SMS with their token.")} />

      {result && (
        <div className="rounded-3xl bg-success-soft p-5 ring-1 ring-success/25" role="status">
          <p className="text-lg font-extrabold text-success">{t("Checked in")}</p>
          <p className="font-semibold text-ink">{result.patientName}</p>
          <p className="mt-1 text-sm text-muted">
            {t("Token")} <span className="text-2xl font-extrabold text-ink">#{result.token}</span> · {t("around {time}", { time: formatTime(result.slotStartsAt) })}
          </p>
          <Link to="/associate/queue" className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-brand-600">
            {t("Open the queue board")} <Icon name="arrowRight" className="h-4 w-4" />
          </Link>
        </div>
      )}

      <form noValidate onSubmit={submit} className="space-y-4 rounded-3xl bg-surface p-4 ring-1 ring-slate-200">
        <Field label={t("Patient's name")} error={nameInvalid ? t("Name must be at least 2 characters") : null}>
          <Input icon="user" autoComplete="off" value={fullName} onChange={(e) => setFullName(e.target.value)} aria-invalid={nameInvalid || undefined} />
        </Field>
        <Field label={t("Mobile number")} error={phoneInvalid ? t("Enter a valid 10-digit Indian mobile number") : null} hint={t("Their token is sent here by SMS.")}>
          <PhoneInput value={phone} onChange={setPhone} invalid={phoneInvalid} />
        </Field>
        <label className="flex items-start gap-3 text-sm text-ink">
          <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-brand-600" checked={feeCollected} onChange={(e) => setFeeCollected(e.target.checked)} />
          <span>
            {doctor?.consultationFee !== undefined
              ? t("Consultation fee of {amount} collected at the desk", { amount: formatRupees(doctor.consultationFee) })
              : t("Consultation fee collected at the desk")}
          </span>
        </label>
        <label className="flex items-start gap-3 rounded-2xl bg-brand-50 p-3 text-sm text-ink ring-1 ring-brand-100">
          <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-brand-600" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span>{t("The patient agreed that MEDORA may store their name and phone number to manage this visit.")}</span>
        </label>
        {touched && !consent && <p className="text-sm font-medium text-danger">{t("The patient's consent is required")}</p>}
        <Alert>{error}</Alert>
        <Button type="submit" size="lg" icon="ticket" className="w-full" loading={addWalkIn.isPending}>
          {t("Check in and issue token")}
        </Button>
      </form>
    </div>
  );
}
