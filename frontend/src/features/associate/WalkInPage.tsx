import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Icon } from "../../components/icons";
import { Alert, Button, EmptyState, Field, Input, PageHeader, PhoneInput, isValidIndianMobile, toE164India } from "../../components/ui";
import { apiErrorMessage } from "../../lib/api";
import { formatRupees, formatTime } from "../../lib/formatters";
import { useT } from "../../lib/i18n";
import { useActiveDoctor } from "./ActiveDoctorContext";
import { useAddWalkIn, useRequestFamilyCode, type WalkInResult } from "./hooks";

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
  const requestCode = useRequestFamilyCode(doctorId);
  // Linking to someone's account needs their confirmation: a code texted to them.
  const [codeSentFor, setCodeSentFor] = useState<string | null>(null);
  const [familyCode, setFamilyCode] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);

  if (!doctorId) return <EmptyState icon="stethoscope" title={t("No doctor selected")} hint={t("Select a doctor above to add a walk-in.")} />;

  const nameInvalid = touched && fullName.trim().length < 2;
  const phoneInvalid = touched && !isValidIndianMobile(phone);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (fullName.trim().length < 2 || !isValidIndianMobile(phone) || !consent) return;
    setError(null);
    try {
      const useCode = codeSentFor === `${phone}:${fullName.trim()}` && /^\d{6}$/.test(familyCode);
      const res = await addWalkIn.mutateAsync({
        fullName: fullName.trim(),
        phoneNumber: toE164India(phone),
        feeCollected,
        consent: true,
        ...(useCode ? { familyCode } : {}),
      });
      setResult(res);
      setFullName("");
      setPhone("");
      setCodeSentFor(null);
      setFamilyCode("");
      setConsent(false);
      setTouched(false);
    } catch (err) {
      setError(apiErrorMessage(err));
    }
  }

  async function sendCode() {
    setTouched(true);
    if (fullName.trim().length < 2 || !isValidIndianMobile(phone)) return;
    setCodeError(null);
    try {
      await requestCode.mutateAsync({ fullName: fullName.trim(), phoneNumber: toE164India(phone) });
      setCodeSentFor(`${phone}:${fullName.trim()}`);
    } catch (err) {
      setCodeError(apiErrorMessage(err));
    }
  }
  const codeSent = codeSentFor === `${phone}:${fullName.trim()}`;

  return (
    <div className="space-y-5">
      <PageHeader eyebrow={t("Front desk")} title={t("Add a walk-in")} subtitle={t("For patients without the app. They get the next free slot today and an SMS with their token.")} />

      {result && (
        <div className="rounded-3xl bg-success-soft p-5 ring-1 ring-success/25" role="status">
          <p className="text-lg font-extrabold text-success">{t("Checked in")}</p>
          <p className="font-semibold text-ink">{result.patientName}</p>
          {result.linkedTo === "family-member" && <p className="text-sm font-semibold text-ink">{t("Added to the account holder's family after they confirmed.")}</p>}
          {result.linkedTo === "standalone" && (
            <p className="text-sm font-semibold text-ink">{t("Added as a separate walk-in, not linked to the account on this number. No SMS is sent: tell them their token.")}</p>
          )}
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
        <div className="space-y-2 rounded-2xl bg-slate-50 p-3 text-sm ring-1 ring-slate-200" data-testid="family-confirm">
          <p className="font-semibold text-ink">{t("Family member of someone with a MEDORA account on this number?")}</p>
          <p className="text-muted">
            {t("They are added to that family only if the account holder confirms with a code sent to their phone. Otherwise the visit is kept as a separate walk-in.")}
          </p>
          {!codeSent ? (
            <Button size="sm" variant="secondary" icon="smartphone" loading={requestCode.isPending} onClick={() => void sendCode()}>
              {t("Text a code to the account holder")}
            </Button>
          ) : (
            <Field label={t("Code from the account holder's phone")}>
              <Input inputMode="numeric" maxLength={6} autoComplete="one-time-code" value={familyCode} onChange={(e) => setFamilyCode(e.target.value.replace(/\D/g, ""))} />
            </Field>
          )}
          <Alert>{codeError}</Alert>
        </div>
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
          <span>{t("The patient agreed that MEDORA may store their name and phone number to manage this visit, and that the clinic can see the number to contact them.")}</span>
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
