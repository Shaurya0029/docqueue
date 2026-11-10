import { useEffect, useState } from "react";
import { Icon } from "../../components/icons";
import { Alert, Button, Card, EmptyState, Field, Input, ClinicPicker, ListHeader, PageHeader, PhoneInput, Section, cx, isValidIndianMobile, stagger, toE164India } from "../../components/ui";
import { apiErrorMessage } from "../../lib/api";
import { useAssociatesForClinic, useClinics, useCreateAssociate, useDeactivateUser, useDoctorsForClinic } from "./hooks";
import { useT } from "../../lib/i18n";

export function AssociatesPage() {
  const t = useT();
  const { data: clinics } = useClinics();
  const [clinicId, setClinicId] = useState<string>("");
  const { data: doctors } = useDoctorsForClinic(clinicId || undefined);
  const { data: associates, refetch } = useAssociatesForClinic(clinicId || undefined);
  const createAssociate = useCreateAssociate();
  const deactivate = useDeactivateUser(clinicId || undefined);

  const [phoneNumber, setPhoneNumber] = useState("");
  const [fullName, setFullName] = useState("");
  const [selectedDoctorIds, setSelectedDoctorIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [credentials, setCredentials] = useState<{ phone: string; password: string } | null>(null);

  useEffect(() => {
    if (clinics && clinics.length > 0 && !clinicId) setClinicId(clinics[0].id);
  }, [clinics, clinicId]);

  function toggleDoctor(id: string) {
    setSelectedDoctorIds((prev) => (prev.includes(id) ? prev.filter((d) => d !== id) : [...prev, id]));
  }

  async function submit() {
    if (!clinicId) return;
    setError(null);
    try {
      const res = await createAssociate.mutateAsync({ clinicId, phoneNumber: toE164India(phoneNumber), fullName, doctorIds: selectedDoctorIds });
      setCredentials({ phone: res.loginPhone, password: res.tempPassword });
      setPhoneNumber("");
      setFullName("");
      setSelectedDoctorIds([]);
    } catch (err) {
      setError(apiErrorMessage(err));
    }
  }

  const phoneInvalid = submitted && !isValidIndianMobile(phoneNumber);
  const nameInvalid = submitted && fullName.trim().length < 2;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={t("Admin")}
        title={t("Associates")}
        subtitle={t("Front-desk staff who check patients in and run the queue.")}
      />

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,380px)_1fr]">
        <Section title={t("Add an associate")} icon="users" className="h-fit">
          <form
            noValidate
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              setSubmitted(true);
              if (isValidIndianMobile(phoneNumber) && fullName.trim().length >= 2) void submit().then(() => setSubmitted(false));
            }}
          >
            <Field label={t("Mobile number")} error={phoneInvalid ? t("Enter a valid 10-digit mobile number") : null}>
              <PhoneInput value={phoneNumber} onChange={setPhoneNumber} invalid={phoneInvalid} />
            </Field>
            <Field label={t("Full name")} error={nameInvalid ? t("At least 2 characters") : null}>
              <Input value={fullName} aria-invalid={nameInvalid || undefined} onChange={(e) => setFullName(e.target.value)} />
            </Field>
            <div>
              <span className="label">{t("Assign to doctors")}</span>
              {doctors?.length === 0 && <p className="text-sm text-muted">{t("Add doctors to this clinic first.")}</p>}
              <div className="flex flex-wrap gap-2">
                {doctors?.map((doctor) => {
                  const on = selectedDoctorIds.includes(doctor.id);
                  return (
                    <button
                      key={doctor.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggleDoctor(doctor.id)}
                      className={cx(
                        "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold transition-all",
                        on ? "bg-brand-600 text-white shadow-glow" : "bg-surface text-slate-600 ring-1 ring-slate-200 hover:ring-brand-300",
                      )}
                    >
                      {on && <Icon name="check" className="h-3.5 w-3.5" />}
                      {doctor.fullName}
                    </button>
                  );
                })}
              </div>
            </div>
            <Alert>{error}</Alert>
            <Alert tone="success">
              {credentials && (
                <>
                  {t("Created. Login")} <span className="font-mono">{credentials.phone}</span> · {t("temp password")}{" "}
                  <span className="font-mono font-bold">{credentials.password}</span>
                </>
              )}
            </Alert>
            <Button type="submit" icon="check" className="w-full" disabled={!clinicId} loading={createAssociate.isPending}>
              {t("Create associate")}
            </Button>
          </form>
        </Section>

        <div className="min-w-0 space-y-3">
          <ListHeader title={t("Associates")} count={associates?.length}>
            <ClinicPicker clinics={clinics ?? []} value={clinicId} onChange={setClinicId} />
          </ListHeader>
          {associates?.length === 0 && <EmptyState icon="users" title={t("No associates in this clinic yet")} />}
          {associates?.map((associate, i) => (
            <Card key={associate.id} className="flex animate-fade-up items-center gap-4" style={stagger(i)}>
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-lavender text-accent-700">
                <Icon name="user" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-bold text-ink">{t("Associate {id}", { id: associate.id.slice(0, 8) })}</p>
                <p className="truncate text-sm text-muted">
                  {t("Assigned: {names}", { names: associate.assignedDoctors.map((a) => a.doctor.fullName).join(", ") || t("none") })}
                </p>
              </div>
              <Button variant="ghost" size="sm" className="!text-danger hover:!bg-danger-soft" onClick={() => deactivate.mutate(associate.userId, { onSuccess: () => refetch() })}>
                {t("Deactivate")}
              </Button>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
