import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { HttpError } from "../middleware/errorHandler";
import { addDays, istDateTime, todayKey } from "./dates";
import { MAX_REAL_MINUTES, MIN_REAL_MINUTES } from "./waitTime";

/**
 * Admin analytics: aggregates only, computed in the database. No response
 * ever carries a patient name, phone number, family member or appointment id.
 *
 * Definitions (also shown in the UI's "How is this calculated?" notes):
 * - All days and hours are IST (Asia/Kolkata); date ranges are inclusive in IST.
 * - Visits are counted on the IST day of their appointment slot.
 * - No-show rate = NO_SHOW / (COMPLETED + NO_SHOW); cancelled and still-open
 *   appointments are excluded; "not enough data" under 10.
 * - Average consult time = mean of (completedAt - calledAt) for completed
 *   visits, skipping anything under 1 or over 120 minutes (the wait-time
 *   rule); "not enough data" under 5 visits.
 * - Revenue = paid payments minus refunds, by the IST date the payment was
 *   received, in rupees: gross, refunded and net.
 * - Peak hours = non-cancelled bookings by slot start hour (and weekday).
 */
export const TIME_ZONE = "Asia/Kolkata";
export const MIN_NO_SHOW_DENOMINATOR = 10;
export const MIN_CONSULT_VISITS = 5;
export const DEFAULT_RANGE_DAYS = 30;
export const MAX_RANGE_DAYS = 366;

export interface AnalyticsFilters {
  from?: string;
  to?: string;
  clinicId?: string;
  doctorId?: string;
}

/** The admin's own clinics and doctors, narrowed by the filters. Anything outside them is refused. */
async function scope(adminProfileId: string, filters: AnalyticsFilters) {
  const clinics = await prisma.clinic.findMany({ where: { adminId: adminProfileId }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  const clinicIds = clinics.map((c) => c.id);
  if (filters.clinicId && !clinicIds.includes(filters.clinicId)) throw new HttpError(403, "Not your clinic");
  const doctors = await prisma.doctor.findMany({
    where: { clinicId: { in: filters.clinicId ? [filters.clinicId] : clinicIds } },
    select: { id: true, fullName: true, clinicId: true },
    orderBy: { fullName: "asc" },
  });
  if (filters.doctorId && !doctors.some((d) => d.id === filters.doctorId)) throw new HttpError(403, "Doctor not in your clinics");
  const selected = filters.doctorId ? doctors.filter((d) => d.id === filters.doctorId) : doctors;
  return { clinics, doctors, selected };
}

/** Inclusive IST date range, defaulting to the last 30 days. */
export function resolveRange(filters: AnalyticsFilters) {
  const to = filters.to ?? todayKey();
  const from = filters.from ?? addDays(to, -(DEFAULT_RANGE_DAYS - 1));
  if (from > to) throw new HttpError(400, "The start date must not be after the end date");
  const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
  if (days > MAX_RANGE_DAYS) throw new HttpError(400, `Choose a range of at most ${MAX_RANGE_DAYS} days`);
  // [IST midnight of from, IST midnight after to): index-friendly bounds on UTC timestamps.
  return { from, to, days, start: istDateTime(from, "00:00"), end: istDateTime(addDays(to, 1), "00:00") };
}

// UTC timestamp column -> IST wall-clock timestamp.
const ist = (column: Prisma.Sql) => Prisma.sql`((${column} AT TIME ZONE 'UTC') AT TIME ZONE ${TIME_ZONE})`;

const ratio = (num: number, den: number, min: number) => (den >= min ? Math.round((num / den) * 1000) / 1000 : null);
const mean = (sum: number, n: number, min: number) => (n >= min ? Math.round((sum / n) * 10) / 10 : null);

export async function computeAnalytics(adminProfileId: string, filters: AnalyticsFilters) {
  const range = resolveRange(filters);
  const { clinics, doctors, selected } = await scope(adminProfileId, filters);
  const ids = selected.map((d) => d.id);
  const slotStart = Prisma.sql`s."startsAt"`;

  const [peak, perDoctorRows, revenueRows] =
    ids.length === 0
      ? [[], [], []]
      : await Promise.all([
          prisma.$queryRaw<{ hour: number; weekday: number; bookings: number }[]>`
            SELECT EXTRACT(HOUR FROM ${ist(slotStart)})::int AS hour,
                   EXTRACT(ISODOW FROM ${ist(slotStart)})::int AS weekday,
                   COUNT(*)::int AS bookings
            FROM "Appointment" a
            JOIN "Slot" s ON s."id" = a."slotId"
            WHERE a."doctorId" = ANY(${ids}) AND s."startsAt" >= ${range.start} AND s."startsAt" < ${range.end}
              AND a."status" <> 'CANCELLED'
            GROUP BY 1, 2`,
          prisma.$queryRaw<{ doctorId: string; bookings: number; completed: number; noShows: number; timedVisits: number; timedMinutes: number }[]>`
            SELECT x."doctorId",
                   COUNT(*) FILTER (WHERE x."status" <> 'CANCELLED')::int AS bookings,
                   COUNT(*) FILTER (WHERE x."status" = 'COMPLETED')::int AS completed,
                   COUNT(*) FILTER (WHERE x."status" = 'NO_SHOW')::int AS "noShows",
                   COUNT(*) FILTER (WHERE x."status" = 'COMPLETED' AND x.minutes BETWEEN ${MIN_REAL_MINUTES} AND ${MAX_REAL_MINUTES})::int AS "timedVisits",
                   COALESCE(SUM(x.minutes) FILTER (WHERE x."status" = 'COMPLETED' AND x.minutes BETWEEN ${MIN_REAL_MINUTES} AND ${MAX_REAL_MINUTES}), 0)::float8 AS "timedMinutes"
            FROM (
              SELECT a."doctorId", a."status", EXTRACT(EPOCH FROM (a."completedAt" - a."calledAt")) / 60.0 AS minutes
              FROM "Appointment" a
              JOIN "Slot" s ON s."id" = a."slotId"
              WHERE a."doctorId" = ANY(${ids}) AND s."startsAt" >= ${range.start} AND s."startsAt" < ${range.end}
            ) x
            GROUP BY x."doctorId"`,
          prisma.$queryRaw<{ day: string; gross: number; refunded: number }[]>`
            SELECT to_char(${ist(Prisma.sql`p."paidAt"`)}, 'YYYY-MM-DD') AS day,
                   SUM(p."amount")::int AS gross,
                   COALESCE(SUM(r."amount") FILTER (WHERE r."status" = 'PROCESSED'), 0)::int AS refunded
            FROM "Payment" p
            JOIN "Appointment" a ON a."id" = p."appointmentId"
            LEFT JOIN "Refund" r ON r."paymentId" = p."id"
            WHERE a."doctorId" = ANY(${ids}) AND p."paidAt" >= ${range.start} AND p."paidAt" < ${range.end}
              AND p."status" IN ('PAID', 'REFUNDED')
            GROUP BY 1`,
        ]);

  const byHour = Array.from({ length: 24 }, (_, hour) => ({ hour, bookings: 0 }));
  const byWeekday = Array.from({ length: 7 }, (_, i) => ({ weekday: i + 1, bookings: 0 })); // 1 = Monday
  for (const p of peak) {
    byHour[p.hour].bookings += p.bookings;
    byWeekday[p.weekday - 1].bookings += p.bookings;
  }

  const names = new Map(doctors.map((d) => [d.id, d.fullName]));
  const rowsByDoctor = new Map(perDoctorRows.map((r) => [r.doctorId, r]));
  const perDoctor = selected.map((d) => {
    const r = rowsByDoctor.get(d.id) ?? { bookings: 0, completed: 0, noShows: 0, timedVisits: 0, timedMinutes: 0 };
    return {
      doctorId: d.id,
      doctorName: names.get(d.id) ?? "",
      bookings: r.bookings,
      completed: r.completed,
      noShows: r.noShows,
      noShowRate: ratio(r.noShows, r.completed + r.noShows, MIN_NO_SHOW_DENOMINATOR),
      consultVisits: r.timedVisits,
      avgConsultMinutes: mean(r.timedMinutes, r.timedVisits, MIN_CONSULT_VISITS),
    };
  });

  const revenueByDayMap = new Map(revenueRows.map((r) => [r.day, r]));
  const revenueByDay = Array.from({ length: range.days }, (_, i) => {
    const date = addDays(range.from, i);
    const r = revenueByDayMap.get(date);
    const gross = r?.gross ?? 0;
    const refunded = r?.refunded ?? 0;
    return { date, gross, refunded, net: gross - refunded };
  });

  const total = (k: "bookings" | "completed" | "noShows") => perDoctorRows.reduce((s, r) => s + r[k], 0);
  const timedVisits = perDoctorRows.reduce((s, r) => s + r.timedVisits, 0);
  const timedMinutes = perDoctorRows.reduce((s, r) => s + r.timedMinutes, 0);
  const gross = revenueByDay.reduce((s, d) => s + d.gross, 0);
  const refunded = revenueByDay.reduce((s, d) => s + d.refunded, 0);

  return {
    range: { from: range.from, to: range.to, timeZone: TIME_ZONE },
    filters: { clinicId: filters.clinicId ?? null, doctorId: filters.doctorId ?? null },
    options: {
      clinics: clinics.map((c) => ({ id: c.id, name: c.name })),
      doctors: doctors.map((d) => ({ id: d.id, name: d.fullName, clinicId: d.clinicId })),
    },
    summary: {
      bookings: total("bookings"),
      completed: total("completed"),
      noShows: total("noShows"),
      noShowRate: ratio(total("noShows"), total("completed") + total("noShows"), MIN_NO_SHOW_DENOMINATOR),
      consultVisits: timedVisits,
      avgConsultMinutes: mean(timedMinutes, timedVisits, MIN_CONSULT_VISITS),
      gross,
      refunded,
      net: gross - refunded,
    },
    peakHours: { byHour, byWeekday },
    perDoctor,
    revenueByDay,
    rules: {
      minNoShowDenominator: MIN_NO_SHOW_DENOMINATOR,
      minConsultVisits: MIN_CONSULT_VISITS,
      consultMinutes: { min: MIN_REAL_MINUTES, max: MAX_REAL_MINUTES },
    },
  };
}

export type Analytics = Awaited<ReturnType<typeof computeAnalytics>>;

/** One CSV cell: quoted, and never read as a formula by a spreadsheet. */
function cell(v: string | number | null): string {
  if (v === null) return "";
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s) && typeof v === "string") s = `'${s}`;
  return /[",\n\r]/.test(s) || s.startsWith("'") ? `"${s.replace(/"/g, '""')}"` : s;
}
const line = (...cells: (string | number | null)[]) => cells.map(cell).join(",");

/** The filtered aggregates as CSV: the same numbers as the screen, no row-level patient data. */
export function analyticsCsv(a: Analytics): string {
  const clinic = a.filters.clinicId ? a.options.clinics.find((c) => c.id === a.filters.clinicId)?.name ?? "" : "All my clinics";
  const doctor = a.filters.doctorId ? a.options.doctors.find((d) => d.id === a.filters.doctorId)?.name ?? "" : "All doctors";
  const pct = (r: number | null) => (r === null ? "Not enough data" : `${(r * 100).toFixed(1)}%`);
  const mins = (m: number | null) => (m === null ? "Not enough data" : m);
  const weekdays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  return [
    line("MEDORA analytics (aggregates only)"),
    line("From (IST)", a.range.from),
    line("To (IST)", a.range.to),
    line("Clinic", clinic),
    line("Doctor", doctor),
    "",
    line("Summary", "Value"),
    line("Bookings (not cancelled)", a.summary.bookings),
    line("Completed visits", a.summary.completed),
    line("No-shows", a.summary.noShows),
    line("No-show rate", pct(a.summary.noShowRate)),
    line("Average consult time (min)", mins(a.summary.avgConsultMinutes)),
    line("Timed visits used for the average", a.summary.consultVisits),
    line("Gross revenue (Rs)", a.summary.gross),
    line("Refunded (Rs)", a.summary.refunded),
    line("Net revenue (Rs)", a.summary.net),
    "",
    line("Hour (IST)", "Bookings"),
    ...a.peakHours.byHour.map((h) => line(`${String(h.hour).padStart(2, "0")}:00`, h.bookings)),
    "",
    line("Weekday", "Bookings"),
    ...a.peakHours.byWeekday.map((d) => line(weekdays[d.weekday - 1], d.bookings)),
    "",
    line("Doctor", "Bookings", "Completed", "No-shows", "No-show rate", "Average consult (min)", "Timed visits"),
    ...a.perDoctor.map((d) => line(d.doctorName, d.bookings, d.completed, d.noShows, pct(d.noShowRate), mins(d.avgConsultMinutes), d.consultVisits)),
    "",
    line("Date (IST)", "Gross (Rs)", "Refunded (Rs)", "Net (Rs)"),
    ...a.revenueByDay.map((d) => line(d.date, d.gross, d.refunded, d.net)),
    "",
  ].join("\r\n");
}
