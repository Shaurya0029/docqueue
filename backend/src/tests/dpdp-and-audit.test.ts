import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../app";
import { prisma } from "../lib/prisma";
import { createClinicWithAdmin, createDoctor, createAssociate, createPatient, createFutureSlot, createSlotSoon } from "./factories";
import { bookAndPay } from "./paymentHelpers";

const app = createApp();
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function patientWithHistory() {
  const { clinic, token: adminToken } = await createClinicWithAdmin();
  const { doctor } = await createDoctor(clinic.id);
  const { token: associateToken } = await createAssociate(clinic.id, [doctor.id]);
  const patient = await createPatient();
  await prisma.patient.update({ where: { id: patient.patient.id }, data: { address: "12 Lake Road", idDocumentRef: "****1234" } });
  const past = await bookAndPay(app, patient.token, (await createFutureSlot(doctor.id, 30)).id);
  const upcoming = await bookAndPay(app, patient.token, (await createFutureSlot(doctor.id, 50)).id);
  await prisma.slotAlert.create({ data: { patientId: patient.patient.id, doctorId: doctor.id } });
  return { clinic, adminToken, doctor, associateToken, patient, past, upcoming };
}

describe("DPDP data export", () => {
  it("returns the patient's profile, visits, payments, messages and alerts as a download", async () => {
    const { patient } = await patientWithHistory();
    const res = await request(app).get("/me/patient/export").set(auth(patient.token));
    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toMatch(/attachment; filename="medora-my-data-/);
    expect(res.body.profile).toMatchObject({ phoneNumber: patient.user.phoneNumber, address: "12 Lake Road", idDocument: "****1234" });
    expect(res.body.profile.consent.givenAt).toBeTruthy();
    expect(res.body.appointments).toHaveLength(2);
    expect(res.body.appointments[0].payment).toMatchObject({ status: "PAID", method: "ONLINE" });
    expect(res.body.messagesSent.length).toBeGreaterThanOrEqual(2);
    expect(res.body.slotAlerts).toHaveLength(1);
    expect(await prisma.auditLog.count({ where: { action: "PATIENT_DATA_EXPORTED" } })).toBe(1);
  });

  it("is only ever the caller's own data", async () => {
    await patientWithHistory();
    const stranger = await createPatient();
    const res = await request(app).get("/me/patient/export").set(auth(stranger.token));
    expect(res.body.appointments).toEqual([]);
  });
});

describe("DPDP account deletion", () => {
  it("cancels upcoming bookings with refunds, erases identity, ends sessions and frees the number", async () => {
    const { patient, past, upcoming } = await patientWithHistory();
    expect((await request(app).post("/me/patient/delete").set(auth(patient.token)).send({})).status).toBe(400); // needs confirmation

    const res = await request(app).post("/me/patient/delete").set(auth(patient.token)).send({ confirm: "DELETE" });
    expect(res.status).toBe(200);
    expect(res.body.cancelledBookings).toBe(2);

    const after = await prisma.patient.findUniqueOrThrow({ where: { id: patient.patient.id }, include: { user: true } });
    expect(after).toMatchObject({ fullName: null, address: null, idDocumentRef: null, consentAt: null });
    expect(after.deletedAt).toBeInstanceOf(Date);
    expect(after.user!.phoneNumber).not.toBe(patient.user.phoneNumber);
    expect(after.user!.isActive).toBe(false);
    expect(await prisma.notification.count({ where: { userId: patient.user.id } })).toBe(0);
    expect(await prisma.slotAlert.count({ where: { patientId: patient.patient.id } })).toBe(0);

    // Bookings 30h and 50h away were refunded in full; the records stay, anonymously.
    for (const id of [past.appointmentId, upcoming.appointmentId]) {
      const a = await prisma.appointment.findUniqueOrThrow({ where: { id }, include: { payment: { include: { refund: true } } } });
      expect(a.status).toBe("CANCELLED");
      expect(a.payment?.refund?.status).toBe("PROCESSED");
    }

    // The old token stops working at once.
    expect((await request(app).get("/appointments/mine").set(auth(patient.token))).status).toBe(401);
    // The number can sign up again as a brand-new patient.
    await request(app).post("/auth/otp/request").send({ phoneNumber: patient.user.phoneNumber });
    const again = await request(app).post("/auth/otp/verify").send({ phoneNumber: patient.user.phoneNumber, code: "123456", consent: true });
    expect(again.status).toBe(200);
    expect(again.body.user.id).not.toBe(patient.user.id);
    expect(await prisma.auditLog.count({ where: { action: "PATIENT_ACCOUNT_DELETED" } })).toBe(1);
  });

  it("is refused while the patient is checked in", async () => {
    const { patient, associateToken, upcoming } = await patientWithHistory();
    await request(app).post("/appointments/qr/scan").set(auth(associateToken)).send({ token: upcoming.qrToken });
    const res = await request(app).post("/me/patient/delete").set(auth(patient.token)).send({ confirm: "DELETE" });
    expect(res.status).toBe(409);
  });
});

describe("audit of staff access", () => {
  it("logs each staff member's view of a queue or schedule once per window, with the patients shown", async () => {
    const { clinic } = await createClinicWithAdmin();
    const { doctor, token: doctorToken } = await createDoctor(clinic.id);
    const { token: associateToken, user: associateUser } = await createAssociate(clinic.id, [doctor.id]);
    const patient = await createPatient();
    await bookAndPay(app, patient.token, (await createSlotSoon(doctor.id, 20)).id);

    for (let i = 0; i < 3; i++) await request(app).get(`/doctors/${doctor.id}/queue`).set(auth(associateToken));
    await request(app).get(`/doctors/${doctor.id}/queue`).set(auth(doctorToken));
    await request(app).get(`/doctors/${doctor.id}/appointments`).set(auth(doctorToken));

    const views = await prisma.auditLog.findMany({ where: { action: { in: ["STAFF_VIEWED_QUEUE", "STAFF_VIEWED_SCHEDULE"] } } });
    expect(views).toHaveLength(3); // associate's queue once, doctor's queue once, doctor's schedule once
    const associateView = views.find((v) => v.actorUserId === associateUser.id)!;
    expect(JSON.parse(associateView.metadata!).patientIds).toEqual([patient.patient.id]);
  });

  it("ends a deactivated staff member's sessions immediately", async () => {
    const { clinic, token: adminToken } = await createClinicWithAdmin();
    const { doctor, token: doctorToken, user } = await createDoctor(clinic.id);
    expect((await request(app).get(`/doctors/${doctor.id}/queue`).set(auth(doctorToken))).status).toBe(200);
    await request(app).patch(`/users/${user.id}/deactivate`).set(auth(adminToken));
    expect((await request(app).get(`/doctors/${doctor.id}/queue`).set(auth(doctorToken))).status).toBe(401);
  });
});
