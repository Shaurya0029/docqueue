import { Card, EmptyState, ErrorState, PageHeader, Spinner, StatCard, stagger } from "../../components/ui";
import { Icon } from "../../components/icons";
import { formatRupees } from "../../lib/formatters";
import { useAdminOverview } from "./hooks";
import { useT } from "../../lib/i18n";

export function OverviewPage() {
  const t = useT();
  const { data: overview, isLoading, isError, refetch } = useAdminOverview();

  if (isLoading) return <Spinner />;
  if (isError) return <ErrorState message={t("Could not load overview")} onRetry={() => refetch()} />;
  if (!overview || overview.length === 0)
    return <EmptyState icon="building" title={t("No clinics yet")} hint={t("Add your first clinic to get started")} />;

  const totalBookings = overview.reduce((s, r) => s + r.bookings, 0);
  const totalRevenue = overview.reduce((s, r) => s + r.revenue, 0);
  const avgNoShow = overview.reduce((s, r) => s + r.noShowRate, 0) / overview.length;

  return (
    <div className="space-y-6">
      <PageHeader eyebrow={t("Admin")} title={t("Overview")} subtitle={t("Bookings, revenue, and no-show rate across your clinics")} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label={t("Clinics")} value={overview.length} icon="building" tone="accent" style={stagger(0, 80)} />
        <StatCard label={t("Bookings")} value={totalBookings} icon="calendar" style={stagger(1, 80)} />
        <StatCard label={t("Revenue")} value={formatRupees(totalRevenue)} icon="wallet" tone="success" style={stagger(2, 80)} />
        <StatCard label={t("Avg no-show")} value={`${Math.round(avgNoShow * 100)}%`} icon="alert" tone="danger" style={stagger(3, 80)} />
      </div>

      <div>
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-slate-500">{t("By clinic")}</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {overview.map((row, i) => {
            const noShow = Math.round(row.noShowRate * 100);
            return (
              <Card key={row.clinicId} interactive className="animate-fade-up p-5" style={stagger(i + 4, 80)}>
                <div className="flex items-center gap-3">
                  <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-50 text-brand-600">
                    <Icon name="building" />
                  </span>
                  <p className="truncate font-bold text-slate-900">{row.clinicName}</p>
                </div>
                <div className="mt-5 grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-xs font-medium text-slate-400">{t("Bookings")}</p>
                    <p className="text-xl font-extrabold">{row.bookings}</p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-slate-400">{t("Revenue")}</p>
                    <p className="text-xl font-extrabold">{formatRupees(row.revenue)}</p>
                  </div>
                </div>
                <div className="mt-4">
                  <div className="mb-1 flex justify-between text-xs font-medium">
                    <span className="text-slate-400">{t("No-show rate")}</span>
                    <span className={noShow > 20 ? "text-danger" : "text-ink"}>{noShow}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className={`h-full rounded-full transition-all duration-700 ${noShow > 20 ? "bg-danger" : "bg-brand-gradient"}`}
                      style={{ width: `${Math.min(noShow, 100)}%` }}
                    />
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
