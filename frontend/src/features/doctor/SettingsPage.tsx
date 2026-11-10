import { useEffect, useState } from "react";
import { Alert, Button, ErrorState, Field, Input, PageHeader, Section, Spinner, Textarea } from "../../components/ui";
import { apiErrorMessage } from "../../lib/api";
import { useDoctorProfileFull, useMyDoctorProfile, useUpdateDoctorSettings } from "./hooks";
import { useT } from "../../lib/i18n";

export function SettingsPage() {
  const t = useT();
  const { data: myProfile } = useMyDoctorProfile();
  const doctorId = myProfile?.id ?? null;
  const { data: doctor, isLoading, isError, refetch } = useDoctorProfileFull(doctorId);
  const updateSettings = useUpdateDoctorSettings(doctorId);

  const [fee, setFee] = useState(0);
  const [avgMinutes, setAvgMinutes] = useState(15);
  const [bio, setBio] = useState("");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
            <Field label={t("Average consult time (min)")} error={minutesInvalid ? t("Between 1 and 240 minutes") : null} hint={t("Used for wait estimates until you have history.")}>
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
