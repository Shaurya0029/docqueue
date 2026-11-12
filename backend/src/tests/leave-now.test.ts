import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../app";
import { prisma } from "../lib/prisma";
import { distanceKm, osrmProvider, straightLineProvider, travelMinutes, type TravelTimeProvider } from "../lib/travel";
import { evaluateLeaveAlerts, minutesUntilTurn, shouldLeaveNow, LEAVE_BUFFER_MINUTES } from "../lib/leaveNow";
import { createClinicWithAdmin, createDoctor, createPatient, createSlotSoon } from "./factories";
import { bookAndPay } from "./paymentHelpers";

const app = createApp();
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const CLINIC = { latitude: 12.9756, longitude: 77.605 };
const HOME = { latitude: 13.0206, longitude: 77.605 }; // 0.045 degrees north, just over 5 km

async function setup(opts: { coordinates?: boolean } = {}) {
  const { clinic } = await createClinicWithAdmin();
  if (opts.coordinates !== false) await prisma.clinic.update({ where: { id: clinic.id }, data: CLINIC });
  const { doctor, token: doctorToken } = await createDoctor(clinic.id); // configured average: 10 min
  return { clinic, doctor, doctorToken };
}

async function bookToday(doctorId: string, minutesFromNow: number) {
  const patient = await createPatient();
  const { appointmentId } = await bookAndPay(app, patient.token, (await createSlotSoon(doctorId, minutesFromNow)).id);
  return { ...patient, appointmentId };
}

const leaveNowCount = () => prisma.notification.count({ where: { type: "LEAVE_NOW" } });

describe("threshold maths", () => {
  it("time until turn is the later of the queue estimate and the slot start", () => {
    const now = new Date("2026-11-12T04:00:00Z");
    expect(minutesUntilTurn(10, new Date("2026-11-12T05:00:00Z"), now)).toBe(60); // slot is later
    expect(minutesUntilTurn(90, new Date("2026-11-12T05:00:00Z"), now)).toBe(90); // queue is later
    expect(minutesUntilTurn(0, new Date("2026-11-12T03:00:00Z"), now)).toBe(0); // slot already passed
  });

  it("sends when time until turn <= travel + 10 minutes", () => {
    expect(LEAVE_BUFFER_MINUTES).toBe(10);
    expect(shouldLeaveNow(31, 21)).toBe(true);
    expect(shouldLeaveNow(32, 21)).toBe(false);
  });

  it("straight-line travel = distance x 1.4 at 20 km/h, rounded up", async () => {
    const km = distanceKm(HOME, CLINIC);
    expect(km).toBeGreaterThan(4.9);
    expect(km).toBeLessThan(5.1);
    expect(await straightLineProvider.minutes(HOME, CLINIC)).toBe(Math.ceil(((km * 1.4) / 20) * 60));
  });
});

describe("travel provider fallback", () => {
  it("falls back to straight-line when the provider is unreachable, throws, times out or answers nonsense", async () => {
    const expected = await straightLineProvider.minutes(HOME, CLINIC);
    const unreachable = osrmProvider("http://127.0.0.1:9");
    const throwing: TravelTimeProvider = { name: "broken", minutes: async () => { throw new Error("boom"); } };
    const slow: TravelTimeProvider = { name: "slow", minutes: () => new Promise((r) => setTimeout(() => r(5), 5000)) };
    const nonsense: TravelTimeProvider = { name: "nonsense", minutes: async () => Number.NaN };
    for (const p of [unreachable, throwing, nonsense]) {
      expect(await travelMinutes(HOME, CLINIC, p)).toEqual({ minutes: expected, provider: "straight-line" });
    }
    expect(await travelMinutes(HOME, CLINIC, slow, 200)).toEqual({ minutes: expected, provider: "straight-line" });
    const good: TravelTimeProvider = { name: "good", minutes: async () => 17 };
    expect(await travelMinutes(HOME, CLINIC, good)).toEqual({ minutes: 17, provider: "good" });
  });
});

describe("leave-now alert", () => {
  it("opts in from a one-time location, keeps only the minutes, and texts once when it is time", async () => {
    const { doctor } = await setup();
    const p = await bookToday(doctor.id, 120); // slot in 2 hours: not time yet

    const on = await request(app).put(`/appointments/${p.appointmentId}/leave-alert`).set(auth(p.token)).send(HOME);
    expect(on.status).toBe(200);
    const travel = await straightLineProvider.minutes(HOME, CLINIC); // 22 for these points
    expect(on.body.leaveAlert).toMatchObject({ available: true, enabled: true, travelMinutes: travel, source: "estimate", sentAt: null });
    expect(await leaveNowCount()).toBe(0);

    // No coordinates anywhere in the database.
    const row = await prisma.appointment.findUniqueOrThrow({ where: { id: p.appointmentId } });
    const everything = JSON.stringify([row, await prisma.auditLog.findMany(), await prisma.notification.findMany()]);
    expect(everything).not.toContain("13.0206");

    // 40 minutes before the slot is too early (40 > 22 + 10); 25 minutes before is time to leave.
    const slot = await prisma.slot.findUniqueOrThrow({ where: { id: row.slotId } });
    expect(await evaluateLeaveAlerts({}, new Date(slot.startsAt.getTime() - 40 * 60_000))).toBe(0);
    expect(await evaluateLeaveAlerts({}, new Date(slot.startsAt.getTime() - 25 * 60_000))).toBe(1);
    expect(await evaluateLeaveAlerts({}, new Date(slot.startsAt.getTime() - 20 * 60_000))).toBe(0); // only once
    const sms = await prisma.notification.findFirstOrThrow({ where: { type: "LEAVE_NOW" } });
    expect(sms).toMatchObject({ userId: p.user.id, status: "SENT" });
    expect(sms.payload).toContain("Time to leave");

    const ticket = await request(app).get(`/appointments/${p.appointmentId}`).set(auth(p.token));
    expect(ticket.body.leaveAlert.sentAt).toBeTruthy();
  });

  it("texts sooner when the queue moves faster than expected", async () => {
    const { doctor, doctorToken } = await setup();
    const ahead = [];
    for (let i = 0; i < 6; i++) ahead.push(await bookToday(doctor.id, 2 + i));
    const me = await bookToday(doctor.id, 10);
    // 6 ahead x 10 min = 60 min > 21 + 10: not yet.
    await request(app).put(`/appointments/${me.appointmentId}/leave-alert`).set(auth(me.token)).send({ travelMinutes: 21 });
    expect(await leaveNowCount()).toBe(0);

    // Five of them don't turn up: one ahead, 10 min, so leave now. Sent on the queue change.
    for (const p of ahead.slice(0, 5)) {
      await request(app).post(`/appointments/${p.appointmentId}/no-show`).set(auth(doctorToken));
    }
    expect(await leaveNowCount()).toBe(1);
  });

  it("waits longer when the queue runs slower, and the patient can correct their travel time", async () => {
    const { doctor } = await setup();
    for (let i = 0; i < 6; i++) await bookToday(doctor.id, 2 + i);
    const me = await bookToday(doctor.id, 15);
    await request(app).put(`/appointments/${me.appointmentId}/leave-alert`).set(auth(me.token)).send({ travelMinutes: 20 });
    // Even at the slot's start time, 6 ahead x 10 min = 60 min > 30: still not time.
    const slot = await prisma.slot.findFirstOrThrow({ where: { appointments: { some: { id: me.appointmentId } } } });
    expect(await evaluateLeaveAlerts({}, slot.startsAt)).toBe(0);

    // The patient says the trip really takes 55 minutes: 60 <= 65, so leave now.
    const adjusted = await request(app).put(`/appointments/${me.appointmentId}/leave-alert`).set(auth(me.token)).send({ travelMinutes: 55 });
    expect(adjusted.body.leaveAlert).toMatchObject({ travelMinutes: 55, source: "manual" });
    expect(adjusted.body.leaveAlert.sentAt).toBeTruthy();
    expect(await leaveNowCount()).toBe(1);
  });

  it("never texts cancelled, checked-in, completed or no-show appointments", async () => {
    const { doctor, doctorToken } = await setup();
    const cancelled = await bookToday(doctor.id, 300);
    const noShow = await bookToday(doctor.id, 310);
    const completed = await bookToday(doctor.id, 320);
    for (const p of [cancelled, noShow, completed]) {
      await request(app).put(`/appointments/${p.appointmentId}/leave-alert`).set(auth(p.token)).send({ travelMinutes: 20 });
    }
    await request(app).post(`/appointments/${cancelled.appointmentId}/cancel`).set(auth(cancelled.token)).send({});
    await request(app).post(`/appointments/${noShow.appointmentId}/no-show`).set(auth(doctorToken));
    await prisma.appointment.update({ where: { id: completed.appointmentId }, data: { status: "COMPLETED" } });

    expect(await evaluateLeaveAlerts({}, new Date(Date.now() + 400 * 60_000))).toBe(0);
    expect(await leaveNowCount()).toBe(0);
    // And it cannot be switched on for them.
    const res = await request(app).put(`/appointments/${cancelled.appointmentId}/leave-alert`).set(auth(cancelled.token)).send({ travelMinutes: 20 });
    expect(res.status).toBe(409);
  });

  it("can be switched off, and is not offered by clinics without coordinates", async () => {
    const { doctor } = await setup();
    const p = await bookToday(doctor.id, 200);
    await request(app).put(`/appointments/${p.appointmentId}/leave-alert`).set(auth(p.token)).send({ travelMinutes: 30 });
    const off = await request(app).delete(`/appointments/${p.appointmentId}/leave-alert`).set(auth(p.token));
    expect(off.body.leaveAlert).toMatchObject({ enabled: false, travelMinutes: null });
    expect(await evaluateLeaveAlerts({}, new Date(Date.now() + 199 * 60_000))).toBe(0);

    const { doctor: noCoords } = await setup({ coordinates: false });
    const q = await bookToday(noCoords.id, 200);
    const ticket = await request(app).get(`/appointments/${q.appointmentId}`).set(auth(q.token));
    expect(ticket.body.leaveAlert.available).toBe(false);
    expect((await request(app).put(`/appointments/${q.appointmentId}/leave-alert`).set(auth(q.token)).send(HOME)).status).toBe(409);
  });

  it("re-arms after a reschedule", async () => {
    const { doctor } = await setup();
    const p = await bookToday(doctor.id, 150);
    await request(app).put(`/appointments/${p.appointmentId}/leave-alert`).set(auth(p.token)).send({ travelMinutes: 200 }); // sends at once
    expect(await leaveNowCount()).toBe(1);
    const later = await createSlotSoon(doctor.id, 400);
    await request(app).post(`/appointments/${p.appointmentId}/reschedule`).set(auth(p.token)).send({ slotId: later.id });
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: p.appointmentId } })).leaveAlertSentAt).toBeNull();
    expect(await evaluateLeaveAlerts({}, new Date(later.startsAt.getTime() - 100 * 60_000))).toBe(1);
  });

  it("only the patient who booked can turn it on, adjust it or turn it off", async () => {
    const { doctor, doctorToken } = await setup();
    const p = await bookToday(doctor.id, 200);
    const other = await createPatient();
    for (const [method, body] of [["put", { travelMinutes: 20 }], ["put", HOME], ["delete", {}]] as const) {
      const asOther = await (request(app) as unknown as Record<string, (u: string) => request.Test>)[method](`/appointments/${p.appointmentId}/leave-alert`).set(auth(other.token)).send(body);
      expect(asOther.status).toBe(404);
      const asDoctor = await (request(app) as unknown as Record<string, (u: string) => request.Test>)[method](`/appointments/${p.appointmentId}/leave-alert`).set(auth(doctorToken)).send(body);
      expect(asDoctor.status).toBe(403);
    }
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: p.appointmentId } })).leaveAlertOptedInAt).toBeNull();
    // Bad input is refused, and coordinates and minutes cannot be mixed.
    expect((await request(app).put(`/appointments/${p.appointmentId}/leave-alert`).set(auth(p.token)).send({ travelMinutes: 0 })).status).toBe(400);
    expect((await request(app).put(`/appointments/${p.appointmentId}/leave-alert`).set(auth(p.token)).send({ ...HOME, travelMinutes: 5 })).status).toBe(400);
  });

  it("is in the patient's data export and cleared when they delete their account", async () => {
    const { doctor } = await setup();
    const p = await bookToday(doctor.id, 3000);
    await request(app).put(`/appointments/${p.appointmentId}/leave-alert`).set(auth(p.token)).send({ travelMinutes: 25 });
    const exported = await request(app).get("/me/patient/export").set(auth(p.token));
    expect(exported.body.appointments[0].leaveNowAlert).toMatchObject({ travelMinutes: 25, source: "manual" });
    expect(JSON.stringify(exported.body)).not.toMatch(/latitude|longitude/);

    await request(app).post("/me/patient/delete").set(auth(p.token)).send({ confirm: "DELETE" });
    const row = await prisma.appointment.findUniqueOrThrow({ where: { id: p.appointmentId } });
    expect(row).toMatchObject({ leaveAlertOptedInAt: null, leaveAlertTravelMinutes: null, leaveAlertSource: null });
  });
});
