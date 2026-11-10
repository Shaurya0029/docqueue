import { useState } from "react";
import { Card, EmptyState, ErrorState, Input, PageHeader, Skeleton, stagger } from "../../components/ui";
import { Icon } from "../../components/icons";
import { useAuditLog } from "./hooks";
import { intlLocale } from "../../lib/locale";
import { CLINIC_TZ } from "../../lib/formatters";
import { useT } from "../../lib/i18n";

export function AuditLogPage() {
  const t = useT();
  const [action, setAction] = useState("");
  const { data: logs, isLoading, isError, refetch } = useAuditLog({ action: action || undefined });

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader eyebrow={t("Compliance")} title={t("Audit log")} subtitle={t("Every staff action on patient data, scoped to your clinics.")} />
      <Input icon="search" placeholder={t("Filter by action (e.g. CALL_NEXT)")} value={action} onChange={(e) => setAction(e.target.value)} />

      {isLoading && <Skeleton className="h-48" />}
      {isError && <ErrorState message={t("Could not load audit log")} onRetry={() => refetch()} />}
      {logs?.length === 0 && <EmptyState icon="shield" title={t("No matching audit entries")} />}

      {logs && logs.length > 0 && (
        <Card className="divide-y divide-slate-100 !p-0">
          {logs.map((log, i) => (
            <div key={log.id} className="flex animate-fade-up items-center gap-4 px-5 py-3.5" style={stagger(i, 25)}>
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600">
                <Icon name="activity" className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-mono text-sm font-bold text-ink">{log.action}</p>
                <p className="truncate text-xs text-muted">
                  {log.targetType} {log.targetId.slice(0, 8)} · {t("by {id}", { id: log.actorUserId.slice(0, 8) })}
                </p>
              </div>
              <span className="shrink-0 text-xs font-medium text-muted">{new Date(log.createdAt).toLocaleString(intlLocale(), { timeZone: CLINIC_TZ })}</span>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
