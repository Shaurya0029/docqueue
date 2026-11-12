import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../app";
import { prisma } from "../lib/prisma";
import { createClinicWithAdmin, createDoctor, createAssociate, createPatient, createSlotSoon } from "./factories";

const app = createApp();
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const walkIn = (token: string, doctorId: string, body: Record<string, unknown>) =>
  request(app).post(`/doctors/${doctorId}/walk-ins`).set(auth(token)).send({ feeCollected: true, consent: true, ...body });

async function setup() {
  const { clinic } = await createClinicWithAdmin();
  const { doctor, token: doctorToken } = await createDoctor(clinic.id, { consultationFee: 400 });
  const { token: associateToken } = await createAssociate(clinic.id, [doctor.id]);
  return { clinic, doctor, doctorToken, associateToken };
}

describe("walk-ins", () => {
  it("creates the patient, takes the next free slot today, and checks them in with a token", async () => {
    const { doctor, associateToken } = await setup();
    const s1 = await createSlotSoon(doctor.id, 5);
    const s2 = await createSlotSoon(doctor.id, 20);
    await prisma.slot.update({ where: { id: s1.id }, data: { isBooked: true } }); // first slot taken

    const res = await walkIn(associateToken, doctor.id, { fullName: "Lakshmi Devi", phoneNumber: "+919845012345" });
    expect(res.status).toBe(201);
    const appointment = await prisma.appointment.findUniqueOrThrow({ where: { id: res.body.appointmentId }, include: { payment: true, patient: { include: { user: true } } } });
    expect(appointment).toMatchObject({ status: "CHECKED_IN", isWalkIn: true, slotId: s2.id, queueToken: res.body.token });
    expect(appointment.payment).toMatchObject({ method: "DESK", status: "PAID", amount: 400 });
    expect(appointment.patient).toMatchObject({ fullName: "Lakshmi Devi", consentSource: "desk" });
    expect(appointment.patient.user.phoneNumber).toBe("+919845012345");

    const sms = await prisma.notification.findFirstOrThrow({ where: { userId: appointment.patient.userId } });
    expect(sms.payload).toContain(`Your token is ${res.body.token}`);
    expect(await prisma.auditLog.count({ where: { action: "WALK_IN_ADDED" } })).toBe(1);

  });

  it("reuses an existing patient account and refuses a duplicate or a staff number", async () => {
    const { doctor, associateToken } = await setup();
    await createSlotSoon(doctor.id, 5);
    await createSlotSoon(doctor.id, 20);
    const existing = await createPatient();

    const first = await walkIn(associateToken, doctor.id, { fullName: "Someone Else", phoneNumber: existing.user.phoneNumber, feeCollected: false });
    expect(first.status).toBe(201);
    const appt = await prisma.appointment.findUniqueOrThrow({ where: { id: first.body.appointmentId }, include: { payment: true } });
    expect(appt.patientId).toBe(existing.patient.id);
    expect(appt.payment).toBeNull();

    const again = await walkIn(associateToken, doctor.id, { fullName: "Someone Else", phoneNumber: existing.user.phoneNumber });
    expect(again.status).toBe(409);

    const staff = await prisma.user.findFirstOrThrow({ where: { role: "DOCTOR" } });
    expect((await walkIn(associateToken, doctor.id, { fullName: "Dr X", phoneNumber: staff.phoneNumber })).status).toBe(409);
  });

  it("says so when no slot is left today, and requires consent", async () => {
    const { doctor, associateToken } = await setup();
    expect((await walkIn(associateToken, doctor.id, { fullName: "Ravi Kumar", phoneNumber: "+919845000001" })).status).toBe(409);
    await createSlotSoon(doctor.id, 5);
    expect((await walkIn(associateToken, doctor.id, { fullName: "Ravi Kumar", phoneNumber: "+919845000001", consent: false })).status).toBe(400);
  });

  it("is only allowed for the associate's assigned doctors", async () => {
    const { clinic, doctor } = await setup();
    const { doctor: other } = await createDoctor(clinic.id);
    const { token: outsiderToken } = await createAssociate(clinic.id, [other.id]);
    await createSlotSoon(doctor.id, 5);
    expect((await walkIn(outsiderToken, doctor.id, { fullName: "Ravi Kumar", phoneNumber: "+919845000002" })).status).toBe(403);
    const patient = await createPatient();
    expect((await walkIn(patient.token, doctor.id, { fullName: "Ravi Kumar", phoneNumber: "+919845000002" })).status).toBe(403);
  });

  it("refunds a desk payment at the desk, not through the gateway", async () => {
    const { doctor, associateToken, doctorToken } = await setup();
    await createSlotSoon(doctor.id, 5);
    const res = await walkIn(associateToken, doctor.id, { fullName: "Meena", phoneNumber: "+919845000003" });
    // A walk-in is checked in; a no-show then a refund override returns the cash.
    await request(app).post(`/appointments/${res.body.appointmentId}/no-show`).set(auth(doctorToken));
    await prisma.appointment.update({ where: { id: res.body.appointmentId }, data: { status: "CANCELLED" } });
    const refund = await request(app).post(`/appointments/${res.body.appointmentId}/refund-override`).set(auth(doctorToken)).send({});
    expect(refund.body.refund).toBe("PROCESSED");
    const sms = await prisma.notification.findFirstOrThrow({ where: { type: "REFUND_ISSUED" } });
    expect(sms.payload).toContain("at the clinic desk");
  });
});
