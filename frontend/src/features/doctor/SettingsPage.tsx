import { useEffect, useState } from "react";
import { Alert, Button, ErrorState, Field, Input, PageHeader, Section, Spinner, Textarea } from "../../components/ui";
import { apiErrorMessage } from "../../lib/api";
import { useConsultAverage, useDoctorProfileFull, useMyDoctorProfile, useUpdateDoctorSettings } from "./hooks";
import { useT } from "../../lib/i18n";

export function SettingsPage() {
  const t = useT();
  const { data: myProfile } = useMyDoctorProfile();
  const doctorId = myProfile?.id ?? null;
  const { data: doctor, isLoading, isError, refetch } = useDoctorProfileFull(doctorId);
  const updateSettings = useUpdateDoctorSettings(doctorId);
  const { data: measured } = useConsultAverage(doctorId);

  const [regNumber, setRegNumber] = useState("");
  const [regCouncil, setRegCouncil] = useState("");
  const [regSaved, setRegSaved] = useState(false);
  const [regError, setRegError] = useState<string | null>(null);
  const [fee, setFee] = useState(0);
  const [avgMinutes, setAvgMinutes] = useState(15);
  const [bio, setBio] = useState("");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (myProfile) {
      setRegNumber(myProfile.registrationNumber ?? "");
      setRegCouncil(myProfile.registrationCouncil ?? "");
    }
  }, [myProfile]);

  useEffect(() => {
    if (doctor) {
      setFee(doctor.consultationFee);
      setAvgMinutes(doctor.avgConsultMinutes);
      setBio(doctor.bio ?? "");
    }
  }, [doctor]);

  if (isLoading) return <Spinner />;
  if (isError || !doctor) return <ErrorState message={t("Could not load settings")} onRetry={() => refetch()} />;

  const feeInvalid = !Number.isFinite(fee) || fee < 0;
  const minutesInvalid = !Number.isFinite(avgMinutes) || avgMinutes < 1 || avgMinutes > 240;

  const regChanged = regNumber.trim() !== (myProfile?.registrationNumber ?? "") || regCouncil.trim() !== (myProfile?.registrationCouncil ?? "");

  async function saveRegistration() {
    if (!regNumber.trim() || !regCouncil.trim()) {
      setRegError(t("Enter both the registration number and the council"));
      return;
    }
    setRegError(null);
    try {
      await updateSettings.mutateAsync({ registrationNumber: regNumber.trim(), registrationCouncil: regCouncil.trim() });
      setRegSaved(true);
      setTimeout(() => setRegSaved(false), 2500);
    } catch (err) {
      setRegError(apiErrorMessage(err));
    }
  }

  async function save() {
    if (feeInvalid || minutesInvalid) return;
    setError(null);
    try {
      await updateSettings.mutateAsync({ consultationFee: fee, avgConsultMinutes: avgMinutes, bio });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(apiErrorMessage(err));
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader eyebrow={t("Practice")} title={t("Settings")} subtitle={t("What patients see on your MEDORA profile.")} />
      <Section title={t("Medical registration")} icon="verified">
        <div className="space-y-4">
          {myProfile?.verificationStatus === "APPROVED" && (
            <Alert tone="success">{t("Verified by your clinic. Patients see the verified tick on your profile.")}</Alert>
          )}
          {myProfile?.verificationStatus === "PENDING" && (
            <Alert tone="warning">
              {myProfile.registrationNumber
                ? t("Waiting for your clinic admin to check your registration. Until then patients don't see the verified tick.")
                : t("Add your registration so your clinic admin can verify you. Patients only see the verified tick after that.")}
            </Alert>
          )}
          {myProfile?.verificationStatus === "REJECTED" && (
            <Alert>{t("Your clinic admin could not verify this registration: {reason}. Correct it and save to ask again.", { reason: myProfile.rejectionReason ?? "" })}</Alert>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("Registration number")} hint={t("As on your NMC or state council certificate")}>
              <Input icon="file" value={regNumber} onChange={(e) => setRegNumber(e.target.value)} autoComplete="off" />
            </Field>
            <Field label={t("Medical council")}>
              <Input icon="building" placeholder={t("e.g. Karnataka Medical Council")} value={regCouncil} onChange={(e) => setRegCouncil(e.target.value)} />
            </Field>
          </div>
          {myProfile?.verificationStatus === "APPROVED" && regChanged && (
            <p className="text-sm font-medium text-amber-700">{t("Changing these sends your profile back for verification.")}</p>
          )}
          <Alert>{regError}</Alert>
          <Alert tone="success">{regSaved ? t("Registration saved") : null}</Alert>
          <Button icon="check" variant="secondary" disabled={!regChanged} loading={updateSettings.isPending} onClick={() => void saveRegistration()}>
            {t("Save registration")}
          </Button>
        </div>
      </Section>

      <Section title={t("Consultation details")} icon="stethoscope">
        <form
          noValidate
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("Consultation fee (₹)")} error={feeInvalid ? t("Enter a valid amount") : null}>
              <Input type="number" min={0} icon="rupee" value={fee} aria-invalid={feeInvalid || undefined} onChange={(e) => setFee(Number(e.target.value))} />
            </Field>
            <Field label={t("Average consult time (min)")} error={minutesInvalid ? t("Between 1 and 240 minutes") : null} hint={
                measured?.basis === "history"
                  ? t("Wait estimates now use your last {n} consultations: about {min} min each.", { n: measured.sampleSize, min: Math.round(measured.minutes) })
                  : t("Used for wait estimates until you have 5 timed consultations ({n} so far).", { n: measured?.sampleSize ?? 0 })
              }>
              <Input type="number" min={1} max={240} icon="clock" value={avgMinutes} aria-invalid={minutesInvalid || undefined} onChange={(e) => setAvgMinutes(Number(e.target.value))} />
            </Field>
          </div>
          <Field label={t("Bio")} hint={t("A short introduction shown on your profile.")}>
            <Textarea rows={4} value={bio} onChange={(e) => setBio(e.target.value)} />
          </Field>
          <Alert>{error}</Alert>
          <Alert tone="success">{saved ? t("Settings saved") : null}</Alert>
          <Button type="submit" icon="check" disabled={feeInvalid || minutesInvalid} loading={updateSettings.isPending}>
            {t("Save changes")}
          </Button>
        </form>
      </Section>
    </div>
  );
}
