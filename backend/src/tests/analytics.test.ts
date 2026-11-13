import { describe, it, expect } from "vitest";
import request from "supertest";
import type { AppointmentStatus, PaymentStatus, RefundStatus } from "@prisma/client";
import { createApp } from "../app";
import { prisma } from "../lib/prisma";
import { istDateTime, todayKey } from "../lib/dates";
import { createAssociate, createClinicWithAdmin, createDoctor, createPatient, createSlotAt } from "./factories";

const app = createApp();
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const MON = "2026-10-05"; // ISO weekday 1
const TUE = "2026-10-06"; // ISO weekday 2

let slotCounter = 0;
/** A slot at a distinct time on `date` (09:00, 09:05, ... IST) unless a time is given. */
async function slot(doctorId: string, date: string, time?: string) {
  const n = slotCounter++;
  const at = time ?? `${String(9 + Math.floor((n % 100) / 12)).padStart(2, "0")}:${String((n % 12) * 5).padStart(2, "0")}`;
  return createSlotAt(doctorId, date, at, 5);
}

/** One visit with an optional consult length (minutes, or null for never called) and payment. */
async function visit(
  doctorId: string,
  patientId: string,
  opts: {
    date?: string;
    time?: string;
    status: AppointmentStatus;
    consult?: number | null;
    payment?: { amount: number; paidAt: Date | null; status?: PaymentStatus; refund?: { amount: number; status: RefundStatus } };
  }
) {
  const s = await slot(doctorId, opts.date ?? MON, opts.time);
  const calledAt = opts.consult != null ? new Date(s.startsAt.getTime()) : null;
  const completedAt = opts.consult != null ? new Date(s.startsAt.getTime() + opts.consult * 60_000) : null;
  const a = await prisma.appointment.create({
    data: { patientId, doctorId, slotId: s.id, status: opts.status, calledAt, completedAt },
  });
  if (opts.payment) {
    const p = await prisma.payment.create({
      data: { appointmentId: a.id, amount: opts.payment.amount, status: opts.payment.status ?? "PAID", paidAt: opts.payment.paidAt },
    });
    if (opts.payment.refund) await prisma.refund.create({ data: { paymentId: p.id, ...opts.payment.refund } });
  }
  return a;
}

async function world() {
  const admin = await createClinicWithAdmin();
  const { doctor: a, token: doctorToken } = await createDoctor(admin.clinic.id);
  const { doctor: b } = await createDoctor(admin.clinic.id);
  await prisma.doctor.update({ where: { id: a.id }, data: { fullName: "Dr. Alpha" } });
  await prisma.doctor.update({ where: { id: b.id }, data: { fullName: "Dr. Beta" } });
  const { token: associateToken } = await createAssociate(admin.clinic.id, [a.id]);
  const patient = await createPatient();
  await prisma.patient.update({ where: { id: patient.patient.id }, data: { fullName: "Secret Patient" } });
  const other = await createClinicWithAdmin(); // another admin's clinic
  const { doctor: c } = await createDoctor(other.clinic.id);
  return { admin, a, b, c, doctorToken, associateToken, patient, other };
}

const get = (token: string, query: Record<string, string> = {}) =>
  request(app).get("/admin/analytics").query({ from: MON, to: TUE, ...query }).set(auth(token));

describe("no-show rate and average consult time", () => {
  it("match hand calculations, with the small-sample rules", async () => {
    const w = await world();
    const pid = w.patient.patient.id;
    // Dr. Alpha: 9 completed (5 timed 10-18 min, one 0.5 min, one 125 min, two never called), 3 no-shows,
    // 2 cancelled and 1 still booked (both excluded from the no-show rate).
    for (const m of [10, 12, 14, 16, 18, 0.5, 125, null, null]) await visit(w.a.id, pid, { status: "COMPLETED", consult: m });
    for (let i = 0; i < 3; i++) await visit(w.a.id, pid, { status: "NO_SHOW" });
    for (let i = 0; i < 2; i++) await visit(w.a.id, pid, { status: "CANCELLED" });
    await visit(w.a.id, pid, { status: "BOOKED" });
    // Dr. Beta: 5 completed (4 timed: 10, 20, 30, 40), 4 no-shows: denominator 9 < 10, 4 timed < 5.
    for (const m of [10, 20, 30, 40, null]) await visit(w.b.id, pid, { status: "COMPLETED", consult: m });
    for (let i = 0; i < 4; i++) await visit(w.b.id, pid, { status: "NO_SHOW" });
    // Another admin's doctor: never counted here.
    for (let i = 0; i < 20; i++) await visit(w.c.id, pid, { status: "NO_SHOW" });

    const res = await get(w.admin.token);
    expect(res.status).toBe(200);
    const alpha = res.body.perDoctor.find((d: { doctorName: string }) => d.doctorName === "Dr. Alpha");
    const beta = res.body.perDoctor.find((d: { doctorName: string }) => d.doctorName === "Dr. Beta");
    expect(alpha).toMatchObject({ bookings: 13, completed: 9, noShows: 3, noShowRate: 0.25, consultVisits: 5, avgConsultMinutes: 14 });
    expect(beta).toMatchObject({ bookings: 9, completed: 5, noShows: 4, noShowRate: null, consultVisits: 4, avgConsultMinutes: null });
    // Overall: 7 / 21 = 0.333; consult (70 + 100) / 9 = 18.9.
    expect(res.body.summary).toMatchObject({ bookings: 22, completed: 14, noShows: 7, noShowRate: 0.333, consultVisits: 9, avgConsultMinutes: 18.9 });
    expect(res.body.perDoctor).toHaveLength(2);
  });

  it("exactly 10 in the denominator and exactly 5 timed visits are enough", async () => {
    const w = await world();
    for (const m of [5, 5, 5, 5, 10]) await visit(w.a.id, w.patient.patient.id, { status: "COMPLETED", consult: m });
    for (let i = 0; i < 5; i++) await visit(w.a.id, w.patient.patient.id, { status: "NO_SHOW" });
    const alpha = (await get(w.admin.token, { doctorId: w.a.id })).body.perDoctor[0];
    expect(alpha).toMatchObject({ noShowRate: 0.5, avgConsultMinutes: 6, consultVisits: 5 });
  });
});

describe("peak hours and IST day boundaries", () => {
  it("counts non-cancelled bookings by IST hour and weekday, splitting 23:30 and 00:30 IST into their own days", async () => {
    const w = await world();
    const pid = w.patient.patient.id;
    await visit(w.a.id, pid, { date: MON, time: "23:30", status: "COMPLETED" }); // Monday 23:00 hour
    await visit(w.a.id, pid, { date: TUE, time: "00:30", status: "BOOKED" }); // Tuesday 00:00 hour
    await visit(w.a.id, pid, { date: MON, time: "10:00", status: "NO_SHOW" });
    await visit(w.a.id, pid, { date: MON, time: "10:40", status: "PENDING_PAYMENT" }); // not cancelled: counted
    await visit(w.a.id, pid, { date: MON, time: "10:20", status: "CANCELLED" }); // excluded

    const both = (await get(w.admin.token)).body.peakHours;
    expect(both.byHour[23].bookings).toBe(1);
    expect(both.byHour[0].bookings).toBe(1);
    expect(both.byHour[10].bookings).toBe(2);
    expect(both.byHour.reduce((s: number, h: { bookings: number }) => s + h.bookings, 0)).toBe(4);
    expect(both.byWeekday[0]).toEqual({ weekday: 1, bookings: 3 });
    expect(both.byWeekday[1]).toEqual({ weekday: 2, bookings: 1 });

    // Inclusive IST ranges: Monday alone has 23:30 but not Tuesday 00:30, and vice versa.
    const monday = (await get(w.admin.token, { from: MON, to: MON })).body.peakHours.byHour;
    expect([monday[23].bookings, monday[0].bookings]).toEqual([1, 0]);
    const tuesday = (await get(w.admin.token, { from: TUE, to: TUE })).body.peakHours.byHour;
    expect([tuesday[23].bookings, tuesday[0].bookings]).toEqual([0, 1]);
  });
});

describe("revenue", () => {
  it("is paid minus refunds, by the IST date of payment, with gross, refunded and net", async () => {
    const w = await world();
    const pid = w.patient.patient.id;
    const at = (date: string, time: string) => istDateTime(date, time);
    await visit(w.a.id, pid, { status: "COMPLETED", payment: { amount: 500, paidAt: at(MON, "23:50"), refund: { amount: 200, status: "PROCESSED" } } });
    await visit(w.a.id, pid, { status: "CANCELLED", payment: { amount: 600, paidAt: at(MON, "10:00"), status: "REFUNDED", refund: { amount: 600, status: "PROCESSED" } } });
    await visit(w.a.id, pid, { status: "COMPLETED", payment: { amount: 300, paidAt: at(MON, "11:00"), refund: { amount: 300, status: "FAILED" } } }); // failed refund: still revenue
    await visit(w.b.id, pid, { status: "COMPLETED", payment: { amount: 400, paidAt: at(TUE, "00:10") } }); // just after IST midnight
    await visit(w.a.id, pid, { status: "PENDING_PAYMENT", payment: { amount: 700, paidAt: null, status: "CREATED" } }); // never paid
    await visit(w.c.id, pid, { status: "COMPLETED", payment: { amount: 9999, paidAt: at(MON, "12:00") } }); // another admin's

    const res = await get(w.admin.token);
    expect(res.body.revenueByDay).toEqual([
      { date: MON, gross: 1400, refunded: 800, net: 600 },
      { date: TUE, gross: 400, refunded: 0, net: 400 },
    ]);
    expect(res.body.summary).toMatchObject({ gross: 1800, refunded: 800, net: 1000 });
    // By doctor filter: Dr. Beta only has Tuesday's 400.
    const beta = await get(w.admin.token, { doctorId: w.b.id });
    expect(beta.body.summary).toMatchObject({ gross: 400, refunded: 0, net: 400 });
  });

  it("fills every day in the range, defaulting to the last 30 IST days", async () => {
    const w = await world();
    const res = await request(app).get("/admin/analytics").set(auth(w.admin.token));
    expect(res.body.range).toMatchObject({ to: todayKey(), timeZone: "Asia/Kolkata" });
    expect(res.body.revenueByDay).toHaveLength(30);
    expect(res.body.revenueByDay.at(-1).date).toBe(todayKey());
    expect((await get(w.admin.token, { from: TUE, to: MON })).status).toBe(400);
    expect((await get(w.admin.token, { from: "2024-01-01", to: "2026-01-01" })).status).toBe(400);
    expect((await get(w.admin.token, { patientId: "x" })).status).toBe(400); // unknown filters refused
  });
});

describe("role isolation: analytics", () => {
  it("only admins, only their own clinics and doctors", async () => {
    const w = await world();
    for (let i = 0; i < 3; i++) await visit(w.a.id, w.patient.patient.id, { status: "COMPLETED" });

    // Another admin: refused for this admin's clinic or doctor, and sees none of it unfiltered.
    expect((await get(w.other.token, { clinicId: w.admin.clinic.id })).status).toBe(403);
    expect((await get(w.other.token, { doctorId: w.a.id })).status).toBe(403);
    const theirs = await get(w.other.token);
    expect(theirs.body.summary.bookings).toBe(0);
    expect(JSON.stringify(theirs.body)).not.toContain("Dr. Alpha");
    expect(theirs.body.options.clinics.map((c: { id: string }) => c.id)).toEqual([w.other.clinic.id]);
    // This admin cannot reach the other clinic's doctor either.
    expect((await get(w.admin.token, { doctorId: w.c.id })).status).toBe(403);
    expect((await get(w.admin.token, { clinicId: w.other.clinic.id, doctorId: w.a.id })).status).toBe(403);

    // Doctors, associates and patients: no analytics at all (doctors keep their own earnings page).
    for (const token of [w.doctorToken, w.associateToken, w.patient.token]) {
      expect((await get(token)).status).toBe(403);
      expect((await request(app).get("/admin/analytics/export.csv").set(auth(token))).status).toBe(403);
    }
    expect((await request(app).get(`/doctors/${w.a.id}/earnings`).set(auth(w.doctorToken))).status).toBe(200);
  });
});

/** Every key in the payload, at any depth. */
function keysOf(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => keysOf(v, out));
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      out.add(k);
      keysOf(v, out);
    }
  }
  return out;
}

describe("privacy: aggregates only", () => {
  it("no patient name, phone, family member or appointment id can appear in the payload or the CSV", async () => {
    const w = await world();
    const child = await prisma.patient.create({
      data: { accountHolderId: w.patient.patient.id, fullName: "Secret Child", relationship: "CHILD", consentAt: new Date(), consentSource: "guardian" },
    });
    const visits = [
      await visit(w.a.id, w.patient.patient.id, { status: "COMPLETED", consult: 12, payment: { amount: 500, paidAt: istDateTime(MON, "10:00") } }),
      await visit(w.a.id, child.id, { status: "NO_SHOW" }),
      await visit(w.b.id, w.patient.patient.id, { status: "CANCELLED", payment: { amount: 300, paidAt: istDateTime(MON, "11:00"), status: "REFUNDED", refund: { amount: 300, status: "PROCESSED" } } }),
    ];
    const json = await get(w.admin.token);
    const csv = await request(app).get("/admin/analytics/export.csv").query({ from: MON, to: TUE }).set(auth(w.admin.token));
    expect(csv.status).toBe(200);
    expect(csv.headers["content-type"]).toContain("text/csv");

    // The only keys that may ever appear.
    const allowed = new Set([
      "range", "from", "to", "timeZone", "filters", "clinicId", "doctorId", "options", "clinics", "doctors", "id", "name",
      "summary", "bookings", "completed", "noShows", "noShowRate", "consultVisits", "avgConsultMinutes", "gross", "refunded", "net",
      "peakHours", "byHour", "hour", "byWeekday", "weekday", "perDoctor", "doctorName", "revenueByDay", "date",
      "rules", "minNoShowDenominator", "minConsultVisits", "consultMinutes", "min", "max",
    ]);
    const unexpected = [...keysOf(json.body)].filter((k) => !allowed.has(k));
    expect(unexpected).toEqual([]);
    for (const k of keysOf(json.body)) expect(k).not.toMatch(/patient|phone|appointment|member|family|address/i);

    const secrets = ["Secret Patient", "Secret Child", w.patient.user.phoneNumber, w.patient.patient.id, child.id, ...visits.map((v) => v.id)];
    for (const text of [JSON.stringify(json.body), csv.text]) for (const s of secrets) expect(text).not.toContain(s);
  });

  it("logs every view and every export", async () => {
    const w = await world();
    await get(w.admin.token);
    await get(w.admin.token, { doctorId: w.a.id });
    await request(app).get("/admin/analytics/export.csv").query({ from: MON, to: TUE, clinicId: w.admin.clinic.id }).set(auth(w.admin.token));
    const logs = await prisma.auditLog.findMany({ where: { action: { startsWith: "ANALYTICS_" } }, orderBy: { createdAt: "asc" } });
    expect(logs.map((l) => l.action)).toEqual(["ANALYTICS_VIEWED", "ANALYTICS_VIEWED", "ANALYTICS_EXPORTED"]);
    expect(JSON.parse(logs[2].metadata!)).toMatchObject({ from: MON, to: TUE, clinicId: w.admin.clinic.id });
    expect(logs.every((l) => l.actorUserId === w.admin.user.id)).toBe(true);
  });

  it("CSV cells are quoted and never read as formulas", async () => {
    const w = await world();
    await prisma.doctor.update({ where: { id: w.a.id }, data: { fullName: '=HYPERLINK("x"), "Dr"' } });
    await visit(w.a.id, w.patient.patient.id, { status: "COMPLETED" });
    const csv = await request(app).get("/admin/analytics/export.csv").query({ from: MON, to: TUE }).set(auth(w.admin.token));
    expect(csv.text).toContain(`"'=HYPERLINK(""x""), ""Dr"""`);
  });
});
