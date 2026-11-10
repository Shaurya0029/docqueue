import { ErrorState, PageHeader, Section, Spinner, StatCard, stagger } from "../../components/ui";
import { formatRupees } from "../../lib/formatters";
import { intlLocale } from "../../lib/locale";
import { useDoctorEarnings, useMyDoctorProfile } from "./hooks";
import { useT } from "../../lib/i18n";

function monthLabel(key: string) {
  const [y, m] = key.split("-").map(Number);
  return y && m ? new Date(y, m - 1, 1).toLocaleDateString(intlLocale(), { month: "long", year: "numeric" }) : key;
}

export function EarningsPage() {
  const t = useT();
  const { data: profile } = useMyDoctorProfile();
  const doctorId = profile?.id ?? null;
  const { data: earnings, isLoading, isError, refetch } = useDoctorEarnings(doctorId);

  if (isLoading) return <Spinner />;
  if (isError || !earnings) return <ErrorState message={t("Could not load earnings")} onRetry={() => refetch()} />;

  const days = Object.entries(earnings.byDay).sort((a, b) => b[0].localeCompare(a[0]));
  const months = Object.entries(earnings.byMonth).sort((a, b) => b[0].localeCompare(a[0]));

  return (
    <div className="space-y-6">
      <PageHeader eyebrow={t("Payments & billing")} title={t("Earnings")} subtitle={t("Paid consultations by month and by day.")} />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label={t("Total paid")} value={formatRupees(earnings.totalPaid)} icon="wallet" style={stagger(0, 80)} />
        <StatCard label={t("This month")} value={formatRupees(months[0]?.[1] ?? 0)} hint={months[0] ? monthLabel(months[0][0]) : undefined} icon="calendar" tone="accent" style={stagger(1, 80)} />
        <StatCard label={t("Most recent day")} value={formatRupees(days[0]?.[1] ?? 0)} hint={days[0]?.[0]} icon="rupee" tone="success" style={stagger(2, 80)} />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Section title={t("By month")} icon="calendar">
          {months.length === 0 && <p className="text-sm text-muted">{t("No earnings yet.")}</p>}
          <div className="divide-y divide-slate-100">
            {months.map(([month, amount]) => (
              <div key={month} className="flex justify-between py-2.5 text-sm">
                <span className="text-muted">{monthLabel(month)}</span>
                <span className="font-bold text-ink">{formatRupees(amount)}</span>
              </div>
            ))}
          </div>
        </Section>
        <Section title={t("By day")} icon="clock">
          {days.length === 0 && <p className="text-sm text-muted">{t("No earnings yet.")}</p>}
          <div className="max-h-72 divide-y divide-slate-100 overflow-y-auto pr-1">
            {days.map(([day, amount]) => (
              <div key={day} className="flex justify-between py-2.5 text-sm">
                <span className="text-muted">{day}</span>
                <span className="font-bold text-ink">{formatRupees(amount)}</span>
              </div>
            ))}
          </div>
        </Section>
      </div>
    </div>
  );
}
