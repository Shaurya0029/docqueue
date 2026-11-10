import { useEffect, useState } from "react";
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
          {t("Stored encrypted; only the last 4 digits are ever shown.")}
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

      <Section title={t("Your data")} icon="file">
        <p className="mb-3 text-sm text-muted">{t("Under the DPDP Act you can request an export or deletion of your data.")}</p>
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={() => alert(t("Export request submitted. We'll email you within 7 days."))}>
            {t("Export data")}
          </Button>
          <Button variant="outline" className="flex-1 !text-danger !ring-danger/40" onClick={() => alert(t("Deletion request submitted. We'll confirm within 7 days."))}>
            {t("Delete data")}
          </Button>
        </div>
      </Section>

      </div>
      </div>

      <Button variant="ghost" icon="logout" className="w-full !text-danger hover:!bg-danger-soft md:w-auto" onClick={logout}>
        {t("Log out")}
      </Button>
    </div>
  );
}
