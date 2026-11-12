import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../app";
import { createClinicWithAdmin, createDoctor, createAssociate } from "./factories";

const app = createApp();

describe("role isolation", () => {
  it("doctor A can never read doctor B's queue, schedule, or earnings", async () => {
    const { clinic } = await createClinicWithAdmin();
    const { doctor: doctorA, token: tokenA } = await createDoctor(clinic.id);
    const { doctor: doctorB } = await createDoctor(clinic.id);
    void doctorA;

    const queue = await request(app).get(`/doctors/${doctorB.id}/queue`).set("Authorization", `Bearer ${tokenA}`);
    expect(queue.status).toBe(403);

    const schedule = await request(app).get(`/doctors/${doctorB.id}/appointments`).set("Authorization", `Bearer ${tokenA}`);
    expect(schedule.status).toBe(403);

    const earnings = await request(app).get(`/doctors/${doctorB.id}/earnings`).set("Authorization", `Bearer ${tokenA}`);
    expect(earnings.status).toBe(403);

    const settings = await request(app).patch(`/doctors/${doctorB.id}`).set("Authorization", `Bearer ${tokenA}`).send({ bio: "hacked" });
    expect(settings.status).toBe(403);
  });

  it("an associate not assigned to a doctor cannot scan or call next for them", async () => {
    const { clinic } = await createClinicWithAdmin();
    const { doctor } = await createDoctor(clinic.id);
    const { token: unassignedAssociateToken } = await createAssociate(clinic.id, []);

    const callNext = await request(app)
      .post(`/appointments/doctor/${doctor.id}/call-next`)
      .set("Authorization", `Bearer ${unassignedAssociateToken}`);
    expect(callNext.status).toBe(403);
  });

  it("an admin cannot manage a clinic they do not own", async () => {
    const { clinic: clinicA } = await createClinicWithAdmin();
    const { token: tokenB } = await createClinicWithAdmin();

    const res = await request(app)
      .patch(`/clinics/${clinicA.id}`)
      .set("Authorization", `Bearer ${tokenB}`)
      .send({ name: "Hostile takeover" });
    expect(res.status).toBe(403);
  });

  it("rejects requests with no token", async () => {
    const res = await request(app).get("/appointments/mine");
    expect(res.status).toBe(401);
  });
});

// Every staff route that names a doctor or an appointment, attempted by the wrong
// doctor, an unassigned associate, another clinic's admin, and a patient.
import { prisma } from "../lib/prisma";
import { resolveAllowedDoctorId } from "../ws";
import { verifyAccessToken } from "../lib/jwt";
import { createPatient, createFutureSlot, createSlotSoon } from "./factories";
import { bookAndPay } from "./paymentHelpers";

describe("role isolation across every doctor-scoped route", () => {
  async function world() {
    const { clinic, token: adminToken } = await createClinicWithAdmin();
    const { doctor: a, token: tokenA } = await createDoctor(clinic.id);
    const { doctor: b, token: tokenB } = await createDoctor(clinic.id);
    const { token: assocA } = await createAssociate(clinic.id, [a.id]);
    const { token: otherAdmin } = await createClinicWithAdmin();
    const patient = await createPatient();
    const slotA = await createSlotSoon(a.id, 30);
    const paid = await bookAndPay(app, patient.token, slotA.id);
    await createFutureSlot(a.id, 48);
    return { clinic, adminToken, a, b, tokenA, tokenB, assocA, otherAdmin, patient, appointmentId: paid.appointmentId };
  }
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  it("refuses doctor B, an unassigned associate and another clinic's admin on doctor A's data", async () => {
    const w = await world();
    const { token: assocB } = await createAssociate(w.clinic.id, [w.b.id]);
    const routes: [string, string, Record<string, unknown>?][] = [
      ["get", `/doctors/${w.a.id}/queue`],
      ["get", `/doctors/${w.a.id}/appointments`],
      ["get", `/doctors/${w.a.id}/slots`],
      ["get", `/doctors/${w.a.id}/earnings`],
      ["patch", `/doctors/${w.a.id}`, { bio: "x" }],
      ["post", `/doctors/${w.a.id}/slots`, { startsAt: new Date(Date.now() + 9e7).toISOString(), endsAt: new Date(Date.now() + 9.1e7).toISOString() }],
      ["post", `/doctors/${w.a.id}/walk-ins`, { fullName: "Intruder", phoneNumber: "+919811111111", feeCollected: false, consent: true }],
      ["post", `/appointments/doctor/${w.a.id}/call-next`],
      ["post", `/doctors/${w.a.id}/queue/pause`, { status: "PAUSED" }],
      ["post", `/appointments/${w.appointmentId}/complete`],
      ["post", `/appointments/${w.appointmentId}/no-show`],
      ["post", `/appointments/${w.appointmentId}/cancel-by-clinic`, {}],
      ["post", `/appointments/${w.appointmentId}/refund-override`, {}],
      ["post", `/admin/doctors/${w.a.id}/verification`, { decision: "APPROVE" }],
    ];
    for (const [method, path, body] of routes) {
      for (const [who, token] of [["doctor B", w.tokenB], ["associate of B", assocB], ["other admin", w.otherAdmin], ["patient", w.patient.token]] as const) {
        const res = await (request(app) as unknown as Record<string, (p: string) => request.Test>)[method](path).set(auth(token)).send(body ?? {});
        expect(res.status, `${who}: ${method.toUpperCase()} ${path}`).toBe(403);
      }
    }
    // Nothing changed for doctor A or the patient.
    const appointment = await prisma.appointment.findUniqueOrThrow({ where: { id: w.appointmentId } });
    expect(appointment.status).toBe("BOOKED");
    expect((await prisma.doctor.findUniqueOrThrow({ where: { id: w.a.id } })).bio).toBeNull();
    expect(await prisma.appointment.count({ where: { isWalkIn: true } })).toBe(0);
  });

  it("lets the right people in", async () => {
    const w = await world();
    expect((await request(app).get(`/doctors/${w.a.id}/queue`).set(auth(w.tokenA))).status).toBe(200);
    expect((await request(app).get(`/doctors/${w.a.id}/queue`).set(auth(w.assocA))).status).toBe(200);
    expect((await request(app).get(`/doctors/${w.a.id}/slots`).set(auth(w.adminToken))).status).toBe(200);
  });

  it("keeps patients to their own appointments", async () => {
    const w = await world();
    const other = await createPatient();
    for (const path of [`/appointments/${w.appointmentId}`, `/appointments/${w.appointmentId}/queue-status`]) {
      expect((await request(app).get(path).set(auth(other.token))).status).toBe(404);
    }
    expect((await request(app).post(`/appointments/${w.appointmentId}/cancel`).set(auth(other.token)).send({})).status).toBe(404);
    expect((await request(app).get("/appointments/mine").set(auth(other.token))).body.appointments).toEqual([]);
  });

  it("subscribes sockets only to the doctor the token allows", async () => {
    const w = await world();
    // A doctor naming another doctor still gets only their own channel.
    const doctorB = verifyAccessToken(w.tokenB);
    expect(await resolveAllowedDoctorId(doctorB, w.a.id)).toBe(w.b.id);
    const { token: assocB } = await createAssociate(w.clinic.id, [w.b.id]);
    await expect(resolveAllowedDoctorId(verifyAccessToken(assocB), w.a.id)).rejects.toThrow();
    // A patient only while they have a live booking with that doctor.
    const patient = verifyAccessToken(w.patient.token);
    expect(await resolveAllowedDoctorId(patient, w.a.id)).toBe(w.a.id);
    await expect(resolveAllowedDoctorId(patient, w.b.id)).rejects.toThrow();
    await prisma.appointment.update({ where: { id: w.appointmentId }, data: { status: "COMPLETED" } });
    await expect(resolveAllowedDoctorId(patient, w.a.id)).rejects.toThrow();
  });
});
