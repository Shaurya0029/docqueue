import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Alert, Button, EmptyState, ErrorState, Field, Input, PageHeader, Select, Skeleton, StatCard, stagger } from "../../../components/ui";
import { api, apiErrorMessage } from "../../../lib/api";
import { formatRupees } from "../../../lib/formatters";
import { useT } from "../../../lib/i18n";
import { BarList, ChartCard, ColumnChart, DataTable, Legend, type Bar } from "./Charts";

/** Mirrors GET /admin/analytics: aggregates only. */
interface Analytics {
  range: { from: string; to: string; timeZone: string };
  filters: { clinicId: string | null; doctorId: string | null };
  options: { clinics: { id: string; name: string }[]; doctors: { id: string; name: string; clinicId: string }[] };
  summary: {
    bookings: number;
    completed: number;
    noShows: number;
    noShowRate: number | null;
    consultVisits: number;
    avgConsultMinutes: number | null;
    gross: number;
    refunded: number;
    net: number;
  };
  peakHours: { byHour: { hour: number; bookings: number }[]; byWeekday: { weekday: number; bookings: number }[] };
  perDoctor: {
    doctorId: string;
    doctorName: string;
    bookings: number;
    completed: number;
    noShows: number;
    noShowRate: number | null;
    consultVisits: number;
    avgConsultMinutes: number | null;
  }[];
  revenueByDay: { date: string; gross: number; refunded: number; net: number }[];
  rules: { minNoShowDenominator: number; minConsultVisits: number; consultMinutes: { min: number; max: number } };
}

interface Filters {
  from: string;
  to: string;
  clinicId: string;
  doctorId: string;
}

const istToday = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
const daysBefore = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);
const params = (f: Filters) => Object.fromEntries(Object.entries(f).filter(([, v]) => v));
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const hourLabel = (h: number) => `${String(h).padStart(2, "0")}:00`;

/**
 * Admin → Analytics: peak hours, consult time and no-show rate per doctor,
 * revenue by day, for the admin's own clinics. Aggregates only; every view
 * and export is audit-logged by the API.
 */
export function AnalyticsPage() {
  const t = useT();
  const [filters, setFilters] = useState<Filters>(() => {
    const to = istToday();
    return { from: daysBefore(to, 29), to, clinicId: "", doctorId: "" };
  });
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const invalidRange = !filters.from || !filters.to || filters.from > filters.to;

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["admin-analytics", filters],
    queryFn: async () => (await api.get<Analytics>("/admin/analytics", { params: params(filters) })).data,
    enabled: !invalidRange,
    placeholderData: keepPreviousData,
  });

  const set = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }));
  const pct = (r: number | null) => (r === null ? t("Not enough data") : `${(r * 100).toFixed(1)}%`);
  const mins = (m: number | null) => (m === null ? t("Not enough data") : t("{n} min", { n: m.toFixed(1) }));

  async function exportCsv() {
    setExportError(null);
    setExporting(true);
    try {
      const res = await api.get("/admin/analytics/export.csv", { params: params(filters), responseType: "blob" });
      const url = URL.createObjectURL(res.data as Blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `medora-analytics-${filters.from}-to-${filters.to}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportError(apiErrorMessage(err));
    } finally {
      setExporting(false);
    }
  }

  const doctorsForClinic = (data?.options.doctors ?? []).filter((d) => !filters.clinicId || d.clinicId === filters.clinicId);
  const empty = data && data.summary.bookings === 0 && data.summary.gross === 0;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={t("Admin")}
        title={t("Analytics")}
        subtitle={t("Your clinics only. Aggregates, no patient details. Days and hours are IST.")}
        action={
          <Button variant="secondary" icon="download" loading={exporting} disabled={invalidRange || !data} onClick={() => void exportCsv()}>
            {t("Export CSV")}
          </Button>
        }
      />

      {/* Filters: one row above the charts */}
      <div className="grid gap-3 rounded-3xl bg-surface p-4 ring-1 ring-slate-200 sm:grid-cols-2 lg:grid-cols-4" role="group" aria-label={t("Filters")}>
        <Field label={t("From (IST)")}>
          <Input type="date" value={filters.from} max={filters.to} onChange={(e) => set({ from: e.target.value })} />
        </Field>
        <Field label={t("To (IST)")}>
          <Input type="date" value={filters.to} min={filters.from} onChange={(e) => set({ to: e.target.value })} />
        </Field>
        <Field label={t("Clinic")}>
          <Select value={filters.clinicId} onChange={(e) => set({ clinicId: e.target.value, doctorId: "" })}>
            <option value="">{t("All my clinics")}</option>
            {data?.options.clinics.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("Doctor")}>
          <Select value={filters.doctorId} onChange={(e) => set({ doctorId: e.target.value })}>
            <option value="">{t("All doctors")}</option>
            {doctorsForClinic.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {invalidRange && <Alert>{t("The start date must not be after the end date")}</Alert>}
      <Alert>{exportError}</Alert>

      {isLoading ? (
        <div className="space-y-4" aria-busy="true" aria-label={t("Loading analytics")}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28" />)}
          </div>
          <Skeleton className="h-72" />
        </div>
      ) : isError || !data ? (
        <ErrorState message={apiErrorMessage(error) || t("Could not load analytics")} onRetry={() => refetch()} />
      ) : (
        <div className={isFetching ? "space-y-6 opacity-70 transition-opacity" : "space-y-6"} aria-busy={isFetching}>
          <p className="text-sm text-muted">{t("{from} to {to}, inclusive (IST)", { from: data.range.from, to: data.range.to })}</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="analytics-summary">
            <StatCard label={t("Bookings")} value={data.summary.bookings.toLocaleString("en-IN")} icon="calendar" hint={t("Not cancelled")} style={stagger(0)} />
            <StatCard label={t("No-show rate")} value={pct(data.summary.noShowRate)} icon="alert" tone="danger" hint={t("{n} no-shows, {c} completed", { n: data.summary.noShows, c: data.summary.completed })} style={stagger(1)} />
            <StatCard label={t("Average consult")} value={mins(data.summary.avgConsultMinutes)} icon="clock" tone="accent" hint={t("From {n} timed visits", { n: data.summary.consultVisits })} style={stagger(2)} />
            <StatCard label={t("Net revenue")} value={formatRupees(data.summary.net)} icon="rupee" tone="success" hint={t("{gross} gross − {refunded} refunded", { gross: formatRupees(data.summary.gross), refunded: formatRupees(data.summary.refunded) })} style={stagger(3)} />
          </div>

          {empty ? (
            <EmptyState icon="chart" title={t("No activity in this range")} hint={t("Try a longer date range or another clinic.")} />
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              <ChartCard
                title={t("Bookings by hour of the day")}
                how={t("Non-cancelled bookings, counted by the IST hour their slot starts. Date range inclusive in IST.")}
                table={<DataTable head={[t("Hour (IST)"), t("Bookings")]} rows={data.peakHours.byHour.filter((h) => h.bookings > 0).map((h) => [hourLabel(h.hour), h.bookings])} />}
              >
                <ColumnChart
                  ariaLabel={t("Bookings by hour of the day")}
                  formatAxis={(v) => Math.round(v).toLocaleString("en-IN")}
                  labelEvery={3}
                  bars={data.peakHours.byHour.map<Bar>((h) => ({
                    key: String(h.hour),
                    label: String(h.hour),
                    values: [h.bookings],
                    tooltip: t("{hour}: {n} bookings", { hour: hourLabel(h.hour), n: h.bookings }),
                  }))}
                />
              </ChartCard>

              <ChartCard
                title={t("Bookings by weekday")}
                how={t("Non-cancelled bookings, counted by the IST weekday of the slot. Date range inclusive in IST.")}
                table={<DataTable head={[t("Weekday"), t("Bookings")]} rows={data.peakHours.byWeekday.map((d) => [t(WEEKDAYS[d.weekday - 1]), d.bookings])} />}
              >
                <ColumnChart
                  ariaLabel={t("Bookings by weekday")}
                  formatAxis={(v) => Math.round(v).toLocaleString("en-IN")}
                  bars={data.peakHours.byWeekday.map<Bar>((d) => ({
                    key: String(d.weekday),
                    label: t(WEEKDAYS[d.weekday - 1]),
                    values: [d.bookings],
                    tooltip: t("{day}: {n} bookings", { day: t(WEEKDAYS[d.weekday - 1]), n: d.bookings }),
                  }))}
                />
              </ChartCard>

              <ChartCard
                title={t("No-show rate by doctor")}
                how={t("No-shows ÷ (completed + no-shows), by the IST day of the slot. Cancelled and still-open bookings are left out. Shown only with at least {n} completed or missed visits.", { n: data.rules.minNoShowDenominator })}
                table={
                  <DataTable
                    head={[t("Doctor"), t("No-shows"), t("Completed"), t("No-show rate")]}
                    rows={data.perDoctor.map((d) => [d.doctorName, d.noShows, d.completed, pct(d.noShowRate)])}
                  />
                }
              >
                <BarList
                  ariaLabel={t("No-show rate by doctor")}
                  rows={data.perDoctor.map((d) => ({
                    key: d.doctorId,
                    label: d.doctorName,
                    value: d.noShowRate,
                    max: Math.max(...data.perDoctor.map((x) => x.noShowRate ?? 0)),
                    text: pct(d.noShowRate),
                    note: t("{n} no-shows of {total}", { n: d.noShows, total: d.noShows + d.completed }),
                  }))}
                />
              </ChartCard>

              <ChartCard
                title={t("Average consult time by doctor")}
                how={t("Mean of (completed − called) for completed visits, skipping anything under {min} or over {max} minutes (the wait-time rule). Shown only with at least {n} timed visits.", { min: data.rules.consultMinutes.min, max: data.rules.consultMinutes.max, n: data.rules.minConsultVisits })}
                table={
                  <DataTable
                    head={[t("Doctor"), t("Average consult"), t("Timed visits")]}
                    rows={data.perDoctor.map((d) => [d.doctorName, mins(d.avgConsultMinutes), d.consultVisits])}
                  />
                }
              >
                <BarList
                  ariaLabel={t("Average consult time by doctor")}
                  rows={data.perDoctor.map((d) => ({
                    key: d.doctorId,
                    label: d.doctorName,
                    value: d.avgConsultMinutes,
                    max: Math.max(...data.perDoctor.map((x) => x.avgConsultMinutes ?? 0)),
                    text: mins(d.avgConsultMinutes),
                    note: t("From {n} timed visits", { n: d.consultVisits }),
                  }))}
                />
              </ChartCard>

              <div className="min-w-0 lg:col-span-2">
                <ChartCard
                  title={t("Revenue by day")}
                  how={t("Paid payments minus refunds, by the IST date the payment was received, in rupees. Each bar is gross: net at the bottom, refunded on top.")}
                  table={
                    <DataTable
                      head={[t("Date (IST)"), t("Gross"), t("Refunded"), t("Net")]}
                      rows={data.revenueByDay.map((d) => [d.date, formatRupees(d.gross), formatRupees(d.refunded), formatRupees(d.net)])}
                    />
                  }
                >
                  <Legend
                    items={[
                      { label: t("Net"), value: formatRupees(data.summary.net) },
                      { label: t("Refunded"), value: formatRupees(data.summary.refunded) },
                    ]}
                  />
                  <ColumnChart
                    ariaLabel={t("Revenue by day")}
                    formatAxis={(v) => formatRupees(Math.round(v))}
                    labelEvery={Math.max(1, Math.ceil(data.revenueByDay.length / 8))}
                    bars={data.revenueByDay.map<Bar>((d) => ({
                      key: d.date,
                      label: d.date.slice(5),
                      values: [d.net, d.refunded],
                      tooltip: t("{date}: gross {gross}, refunded {refunded}, net {net}", {
                        date: d.date,
                        gross: formatRupees(d.gross),
                        refunded: formatRupees(d.refunded),
                        net: formatRupees(d.net),
                      }),
                    }))}
                  />
                </ChartCard>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
