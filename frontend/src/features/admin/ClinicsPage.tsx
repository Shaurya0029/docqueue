import { useState } from "react";
import { Icon } from "../../components/icons";
import { Alert, Button, Card, EmptyState, ErrorState, Field, Input, ListHeader, PageHeader, Section, Skeleton, stagger } from "../../components/ui";
import { apiErrorMessage } from "../../lib/api";
import { useClinics, useCreateClinic } from "./hooks";
import { useT } from "../../lib/i18n";

export function ClinicsPage() {
  const t = useT();
  const { data: clinics, isLoading, isError, refetch } = useClinics();
  const createClinic = useCreateClinic();
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    try {
      await createClinic.mutateAsync({ name, address: address || undefined });
      setName("");
      setAddress("");
    } catch (err) {
      setError(apiErrorMessage(err));
    }
  }

  const nameInvalid = name.length > 0 && name.trim().length < 2;

  return (
    <div className="space-y-6">
      <PageHeader eyebrow={t("Admin")} title={t("Clinics")} subtitle={t("The locations your doctors and associates work from.")} />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,380px)_1fr]">
        <Section title={t("Add a clinic")} icon="building" className="h-fit">
          <form
            noValidate
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim().length >= 2) void submit();
            }}
          >
            <Field label={t("Clinic name")} error={nameInvalid ? t("At least 2 characters") : null}>
              <Input placeholder={t("e.g. MEDORA Health Centre")} value={name} aria-invalid={nameInvalid || undefined} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label={t("Address")} hint={t("Optional")}>
              <Input icon="pin" placeholder={t("Street, city")} value={address} onChange={(e) => setAddress(e.target.value)} />
            </Field>
            <Alert>{error}</Alert>
            <Button type="submit" icon="check" className="w-full" disabled={name.trim().length < 2} loading={createClinic.isPending}>
              {t("Create clinic")}
            </Button>
          </form>
        </Section>

        <div className="min-w-0 space-y-3">
          <ListHeader title={t("Your clinics")} count={clinics?.length} />
          {isLoading && <Skeleton className="h-24" />}
          {isError && <ErrorState message={t("Could not load clinics")} onRetry={() => refetch()} />}
          {clinics?.length === 0 && <EmptyState icon="building" title={t("No clinics yet")} hint={t("Create your first clinic to add doctors.")} />}
          <div className="grid gap-3 sm:grid-cols-2">
            {clinics?.map((clinic, i) => (
              <Card key={clinic.id} interactive className="flex animate-fade-up items-start gap-3 p-5" style={stagger(i)}>
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600">
                  <Icon name="building" />
                </span>
                <div className="min-w-0">
                  <p className="font-bold text-ink">{clinic.name}</p>
                  {clinic.address && <p className="mt-0.5 text-sm text-muted">{clinic.address}</p>}
                </div>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
