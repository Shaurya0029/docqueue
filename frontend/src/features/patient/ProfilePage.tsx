import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Icon } from "../../components/icons";
import { useFamily } from "./hooks";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Avatar, Button, Card, Field, Input, Section, Spinner } from "../../components/ui";
import { api, apiErrorMessage } from "../../lib/api";
import { useAuth } from "../auth/AuthContext";
import { useT } from "../../lib/i18n";

interface MeResponse {
  id: string;
  phoneNumber: string;
  role: string;
  profile: { fullName?: string | null; address?: string | null; idDocumentRef?: string | null };
}

/** DPDP rights: download everything we hold, or erase the account. */
function YourDataSection({ onDeleted }: { onDeleted: () => void }) {
  const t = useT();
  const { data: family } = useFamily();
  const familyNames = (family ?? []).map((m) => m.fullName);
  const [downloading, setDownloading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const deleteAccount = useMutation({
    mutationFn: async () => (await api.post<{ cancelledBookings: number }>("/me/patient/delete", { confirm: "DELETE" })).data,
  });

  async function download() {
    setError(null);
    setDownloading(true);
    try {
      const res = await api.get("/me/patient/export", { responseType: "blob" });
      const url = URL.createObjectURL(res.data as Blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `medora-my-data-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setDownloading(false);
    }
  }

  async function erase() {
    setError(null);
    try {
      await deleteAccount.mutateAsync();
      onDeleted();
    } catch (err) {
      setError(apiErrorMessage(err));
    }
  }

  return (
    <Section title={t("Your data")} icon="file">
      <p className="mb-3 text-sm text-muted">{t("Under the DPDP Act you can download your data or delete your account at any time.")}</p>
      {!confirming ? (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" icon="file" className="flex-1" loading={downloading} onClick={() => void download()}>
            {t("Download my data")}
          </Button>
          <Button variant="outline" className="flex-1 !text-danger !ring-danger/40" onClick={() => setConfirming(true)}>
            {t("Delete my account")}
          </Button>
        </div>
      ) : (
        <div className="space-y-3 rounded-2xl bg-danger-soft p-3 text-sm text-ink">
          <p className="font-semibold text-danger">{t("This cannot be undone.")}</p>
          {familyNames.length > 0 && (
            <p className="rounded-xl bg-surface p-2 font-semibold text-danger ring-1 ring-danger/30" data-testid="delete-family-warning">
              {t("Your family members will be deleted too: {names}. Their bookings are cancelled and their data erased.", { names: familyNames.join(", ") })}
            </p>
          )}
          <ul className="list-disc space-y-1 pl-5">
            <li>{t("Upcoming bookings are cancelled. Those 2+ hours away are refunded in full.")}</li>
            <li>{t("Your name, phone number, address and messages are erased and you are logged out.")}</li>
            <li>{t("Clinics keep visit and payment records without your name, as accounting law requires.")}</li>
          </ul>
          <Field label={t("Type DELETE to confirm")}>
            <Input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
          </Field>
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setConfirming(false)}>
              {t("Keep my account")}
            </Button>
            <Button variant="danger" className="flex-1" disabled={typed.trim() !== "DELETE"} loading={deleteAccount.isPending} onClick={() => void erase()}>
              {t("Delete forever")}
            </Button>
          </div>
        </div>
      )}
      <div className="mt-3">
        <Alert>{error}</Alert>
      </div>
    </Section>
  );
}

/** Profile → Family: who this account books for. */
function FamilySection() {
  const t = useT();
  const { data: family } = useFamily();
  return (
    <Section title={t("Family")} icon="users">
      <p className="mb-3 text-sm text-muted">
        {family && family.length > 0
          ? t("You book for: {names}.", { names: family.map((m) => m.fullName).join(", ") })
          : t("Book for your parents, children or spouse from this account.")}
      </p>
      <Link
        to="/patient/family"
        className="flex items-center justify-between rounded-2xl bg-brand-50 px-4 py-3 font-semibold text-brand-700 ring-1 ring-brand-100 transition hover:ring-brand-300"
      >
        {t("Manage family members")}
        <Icon name="chevronRight" className="h-4 w-4" />
      </Link>
    </Section>
  );
}

export function ProfilePage() {
  const t = useT();
  const { logout } = useAuth();
  const queryClient = useQueryClient();
  const { data: me, isLoading } = useQuery({
    queryKey: ["me"],
    queryFn: async () => (await api.get<MeResponse>("/me")).data,
  });

  const [fullName, setFullName] = useState("");
  const [address, setAddress] = useState("");
  const [idDocument, setIdDocument] = useState("");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (me?.profile) {
      setFullName(me.profile.fullName ?? "");
      setAddress(me.profile.address ?? "");
    }
  }, [me]);

  const updateProfile = useMutation({
    mutationFn: async () => api.patch("/me/patient", { fullName, address }),
    onSuccess: () => {
      setSaved(true);
      queryClient.invalidateQueries({ queryKey: ["me"] });
      setTimeout(() => setSaved(false), 2000);
    },
    onError: (err) => setError(apiErrorMessage(err)),
  });

  const uploadId = useMutation({
    mutationFn: async () => api.post("/me/patient/id-document", { idDocumentRef: idDocument }),
    onSuccess: () => {
      setIdDocument("");
      queryClient.invalidateQueries({ queryKey: ["me"] });
    },
    onError: (err) => setError(apiErrorMessage(err)),
  });

  if (isLoading) return <Spinner />;

  const nameInvalid = fullName.trim().length > 0 && fullName.trim().length < 2;

  return (
    <div className="space-y-5">
      <Card className="flex animate-fade-up items-center gap-4 overflow-hidden p-5">
        <Avatar name={me?.profile.fullName || "Patient"} size="lg" />
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-wider text-brand-600">{t("My profile")}</p>
          <h1 className="truncate text-2xl font-extrabold">{me?.profile.fullName || t("Add your name")}</h1>
          <p className="text-sm text-muted">{me?.phoneNumber}</p>
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2 lg:items-start">
      <Section title={t("Personal details")} icon="user">
        <form
          noValidate
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (nameInvalid) return;
            setError(null);
            updateProfile.mutate();
          }}
        >
          <Field label={t("Full name")} error={nameInvalid ? t("Name must be at least 2 characters") : null}>
            <Input autoComplete="name" value={fullName} aria-invalid={nameInvalid || undefined} onChange={(e) => setFullName(e.target.value)} />
          </Field>
          <Field label={t("Address")}>
            <Input icon="pin" autoComplete="street-address" value={address} onChange={(e) => setAddress(e.target.value)} />
          </Field>
          <Alert>{error}</Alert>
          <Alert tone="success">{saved ? t("Profile saved") : null}</Alert>
          <Button type="submit" className="w-full" icon="check" loading={updateProfile.isPending}>
            {t("Save changes")}
          </Button>
        </form>
      </Section>

      <div className="space-y-5">
      <Section title={t("ID document")} icon="shield">
        <p className="mb-3 text-sm text-muted">
          {t("Only the last 4 digits are stored. The full number is never saved.")}
          {me?.profile.idDocumentRef && (
            <span className="mt-1 block font-mono font-semibold text-ink">{t("Current: {id}", { id: me.profile.idDocumentRef })}</span>
          )}
        </p>
        <div className="flex gap-2">
          <Input placeholder={t("Aadhaar / ID number")} value={idDocument} onChange={(e) => setIdDocument(e.target.value)} />
          <Button variant="secondary" disabled={!idDocument} loading={uploadId.isPending} onClick={() => uploadId.mutate()}>
            {t("Upload")}
          </Button>
        </div>
      </Section>

      <FamilySection />

      <YourDataSection onDeleted={logout} />

      </div>
      </div>

      <Button variant="ghost" icon="logout" className="w-full !text-danger hover:!bg-danger-soft md:w-auto" onClick={logout}>
        {t("Log out")}
      </Button>
    </div>
  );
}
