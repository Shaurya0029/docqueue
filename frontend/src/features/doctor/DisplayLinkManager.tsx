import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Input, Segmented } from "../../components/ui";
import { api, apiErrorMessage } from "../../lib/api";
import { useT } from "../../lib/i18n";

interface DisplayLink {
  token: string;
  prefix: string;
  createdAt: string;
}

/**
 * The waiting-room TV link for one doctor: create it, copy or open it,
 * regenerate it (the old link stops at once) or revoke it. Used by the
 * doctor in Settings and by the clinic admin on the Doctors page.
 */
export function DisplayLinkManager({ doctorId }: { doctorId: string }) {
  const t = useT();
  const queryClient = useQueryClient();
  const key = ["display-link", doctorId];
  const { data: link, isLoading } = useQuery({
    queryKey: key,
    queryFn: async () => (await api.get<{ link: DisplayLink | null }>(`/doctors/${doctorId}/display-link`)).data.link,
  });
  const act = useMutation({
    mutationFn: async (action: "create" | "regenerate" | "revoke") => {
      if (action === "create") await api.post(`/doctors/${doctorId}/display-link`);
      if (action === "regenerate") await api.post(`/doctors/${doctorId}/display-link/regenerate`);
      if (action === "revoke") await api.delete(`/doctors/${doctorId}/display-link`);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
  });
  const [lang, setLang] = useState<"en" | "hi">("en");
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [confirm, setConfirm] = useState<"regenerate" | "revoke" | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: "create" | "regenerate" | "revoke") {
    setError(null);
    try {
      await act.mutateAsync(action);
      setConfirm(null);
    } catch (err) {
      setError(apiErrorMessage(err));
    }
  }

  if (isLoading) return null;
  const url = link ? `${window.location.origin}/display/${link.token}?lang=${lang}&theme=${theme}` : "";

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError(t("Could not copy. Select the link and copy it by hand."));
    }
  }

  return (
    <div className="space-y-3" data-testid="display-link-manager">
      <p className="text-sm text-muted">
        {t("A full-screen “now serving” board for the waiting-room TV. It shows only token numbers, never names. Anyone with the link can see it, so share it only with the clinic's TV.")}
      </p>
      {!link ? (
        <Button icon="monitor" loading={act.isPending} onClick={() => void run("create")}>
          {t("Create TV link")}
        </Button>
      ) : (
        <>
          <div className="grid gap-2 sm:grid-cols-2">
            <Segmented value={lang} onChange={setLang} options={[{ value: "en", label: "English" }, { value: "hi", label: "हिंदी" }]} />
            <Segmented value={theme} onChange={setTheme} options={[{ value: "dark", label: t("Dark") }, { value: "light", label: t("Light") }]} />
          </div>
          <Input readOnly value={url} onFocus={(e) => e.currentTarget.select()} aria-label={t("TV link")} data-testid="display-link-url" />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" icon="file" onClick={() => void copy()}>
              {copied ? t("Copied") : t("Copy link")}
            </Button>
            <a href={url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center rounded-xl px-3 py-2 text-sm font-semibold text-brand-600 ring-1 ring-brand-200 hover:bg-brand-50">
              {t("Open board")}
            </a>
            <Button size="sm" variant="outline" onClick={() => setConfirm("regenerate")}>
              {t("Regenerate")}
            </Button>
            <Button size="sm" variant="outline" className="!text-danger !ring-danger/40" onClick={() => setConfirm("revoke")}>
              {t("Revoke")}
            </Button>
          </div>
          {confirm && (
            <div className="space-y-2 rounded-2xl bg-danger-soft p-3 text-sm text-ink">
              <p className="font-semibold text-danger">
                {confirm === "regenerate"
                  ? t("The current link stops working at once, including on any TV showing it. You will get a new link.")
                  : t("The link stops working at once, including on any TV showing it.")}
              </p>
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" className="flex-1" onClick={() => setConfirm(null)}>
                  {t("Cancel")}
                </Button>
                <Button size="sm" variant="danger" className="flex-1" loading={act.isPending} onClick={() => void run(confirm)}>
                  {confirm === "regenerate" ? t("Regenerate link") : t("Revoke link")}
                </Button>
              </div>
            </div>
          )}
          <p className="text-xs text-muted">{t("Link {prefix}… created {date}", { prefix: link.prefix, date: new Date(link.createdAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) })}</p>
        </>
      )}
      <Alert>{error}</Alert>
    </div>
  );
}
