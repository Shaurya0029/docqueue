import { useState } from "react";
import { Icon } from "../../components/icons";
import { Alert, Button, Card, EmptyState, ErrorState, Field, Input, ListHeader, PageHeader, Section, Skeleton, stagger } from "../../components/ui";
import { apiErrorMessage } from "../../lib/api";
import { useClinics, useCreateClinic, useUpdateClinic } from "./hooks";
import type { Clinic } from "../../types/api";
import { useT } from "../../lib/i18n";

/** Parses the two coordinate boxes: both empty = no location; otherwise both must be valid. */
function parseLocation(lat: string, lng: string): { latitude: number | null; longitude: number | null } | "invalid" {
  if (!lat.trim() && !lng.trim()) return { latitude: null, longitude: null };
  const latitude = Number(lat);
  const longitude = Number(lng);
  if (!lat.trim() || !lng.trim() || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return "invalid";
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return "invalid";
  return { latitude, longitude };
}

function LocationFields({ lat, lng, onLat, onLng, invalid }: { lat: string; lng: string; onLat: (v: string) => void; onLng: (v: string) => void; invalid: boolean }) {
  const t = useT();
  return (
    <Field
      label={t("Location for leave-now alerts")}
      hint={t("Optional. Copy latitude and longitude from a map. Without them, patients of this clinic don't get leave-now alerts.")}
      error={invalid ? t("Enter both latitude (-90 to 90) and longitude (-180 to 180), or leave both empty") : null}
    >
      <div className="grid grid-cols-2 gap-2">
        <Input inputMode="decimal" placeholder={t("Latitude, e.g. 12.9756")} aria-label={t("Latitude")} value={lat} onChange={(e) => onLat(e.target.value)} />
        <Input inputMode="decimal" placeholder={t("Longitude, e.g. 77.6050")} aria-label={t("Longitude")} value={lng} onChange={(e) => onLng(e.target.value)} />
      </div>
    </Field>
  );
}

/** Set or change an existing clinic's coordinates. */
function ClinicLocationEditor({ clinic }: { clinic: Clinic }) {
  const t = useT();
  const updateClinic = useUpdateClinic();
  const [open, setOpen] = useState(false);
  const [lat, setLat] = useState(clinic.latitude != null ? String(clinic.latitude) : "");
  const [lng, setLng] = useState(clinic.longitude != null ? String(clinic.longitude) : "");
  const [error, setError] = useState<string | null>(null);
  const parsed = parseLocation(lat, lng);

  async function save() {
    if (parsed === "invalid") return;
    setError(null);
    try {
      await updateClinic.mutateAsync({ id: clinic.id, ...parsed });
      setOpen(false);
    } catch (err) {
      setError(apiErrorMessage(err));
    }
  }

  if (!open) {
    return (
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        <span className={clinic.latitude != null ? "font-semibold text-success" : "text-muted"}>
          {clinic.latitude != null ? t("Leave-now alerts on ({lat}, {lng})", { lat: clinic.latitude, lng: clinic.longitude ?? "" }) : t("No location: leave-now alerts off")}
        </span>
        <button type="button" className="font-semibold text-brand-600 hover:underline" onClick={() => setOpen(true)}>
          {clinic.latitude != null ? t("Change") : t("Add location")}
        </button>
      </div>
    );
  }
  return (
    <div className="mt-3 space-y-2">
      <LocationFields lat={lat} lng={lng} onLat={setLat} onLng={setLng} invalid={parsed === "invalid" && (lat !== "" || lng !== "")} />
      <Alert>{error}</Alert>
      <div className="flex gap-2">
        <Button size="sm" variant="secondary" className="flex-1" onClick={() => setOpen(false)}>
          {t("Cancel")}
        </Button>
        <Button size="sm" className="flex-1" disabled={parsed === "invalid"} loading={updateClinic.isPending} onClick={() => void save()}>
          {t("Save location")}
        </Button>
      </div>
    </div>
  );
}

export function ClinicsPage() {
  const t = useT();
  const { data: clinics, isLoading, isError, refetch } = useClinics();
  const createClinic = useCreateClinic();
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [error, setError] = useState<string | null>(null);
  const location = parseLocation(lat, lng);

  async function submit() {
    setError(null);
    try {
      if (location === "invalid") return;
      await createClinic.mutateAsync({ name, address: address || undefined, ...location });
      setName("");
      setAddress("");
      setLat("");
      setLng("");
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
            <LocationFields lat={lat} lng={lng} onLat={setLat} onLng={setLng} invalid={location === "invalid" && (lat !== "" || lng !== "")} />
            <Alert>{error}</Alert>
            <Button type="submit" icon="check" className="w-full" disabled={name.trim().length < 2 || location === "invalid"} loading={createClinic.isPending}>
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
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-ink">{clinic.name}</p>
                  {clinic.address && <p className="mt-0.5 text-sm text-muted">{clinic.address}</p>}
                  <ClinicLocationEditor clinic={clinic} />
                </div>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
