import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../app";
import { prisma } from "../lib/prisma";
import { createClinicWithAdmin, createDoctor, createAssociate, createPatient, createFutureSlot } from "./factories";

const app = createApp();
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const verify = (token: string, doctorId: string, body: Record<string, unknown>) =>
  request(app).post(`/admin/doctors/${doctorId}/verification`).set(auth(token)).send(body);
/** Patients only ever see approved doctors, so "in search" means verified and bookable. */
const inSearch = async (doctorId: string) =>
  (await request(app).get("/doctors/search")).body.doctors.some((d: { id: string; isVerified: boolean }) => d.id === doctorId && d.isVerified);

describe("doctor verification", () => {
  it("shows the tick only after the clinic admin approves the registration", async () => {
    const { clinic, token: adminToken } = await createClinicWithAdmin();
    const { doctor, token: doctorToken } = await createDoctor(clinic.id, { verified: false });

    expect(await inSearch(doctor.id)).toBe(false);
    // Cannot approve without registration details.
    expect((await verify(adminToken, doctor.id, { decision: "APPROVE" })).status).toBe(409);

    const saved = await request(app)
      .patch(`/doctors/${doctor.id}`)
      .set(auth(doctorToken))
      .send({ registrationNumber: "KMC-12345", registrationCouncil: "Karnataka Medical Council" });
    expect(saved.status).toBe(200);
    expect(saved.body.doctor.verificationStatus).toBe("PENDING");

    expect((await verify(adminToken, doctor.id, { decision: "APPROVE" })).status).toBe(200);
    expect(await inSearch(doctor.id)).toBe(true);
    const profile = await request(app).get(`/doctors/${doctor.id}`);
    expect(profile.body).toMatchObject({ isVerified: true, registration: { number: "KMC-12345", council: "Karnataka Medical Council" } });
    expect(await prisma.auditLog.count({ where: { action: "DOCTOR_VERIFIED", targetId: doctor.id } })).toBe(1);
  });

  it("goes back to pending when the doctor changes the registration number", async () => {
    const { clinic, token: adminToken } = await createClinicWithAdmin();
    const { doctor, token: doctorToken } = await createDoctor(clinic.id, { verified: false });
    await request(app).patch(`/doctors/${doctor.id}`).set(auth(doctorToken)).send({ registrationNumber: "KMC-1", registrationCouncil: "KMC" });
    await prisma.doctor.update({ where: { id: doctor.id }, data: { registrationNumber: "KMC-111" } });
    await verify(adminToken, doctor.id, { decision: "APPROVE" });

    // Changing the fee keeps the tick; changing the registration removes it.
    await request(app).patch(`/doctors/${doctor.id}`).set(auth(doctorToken)).send({ consultationFee: 650 });
    expect(await inSearch(doctor.id)).toBe(true);
    await request(app).patch(`/doctors/${doctor.id}`).set(auth(doctorToken)).send({ registrationNumber: "KMC-999" });
    expect(await inSearch(doctor.id)).toBe(false);
    expect((await request(app).get(`/doctors/${doctor.id}`)).status).toBe(404); // hidden until re-approved
  });

  it("records a rejection with its reason", async () => {
    const { clinic, token: adminToken } = await createClinicWithAdmin();
    const { doctor } = await createDoctor(clinic.id, { verified: false });
    expect((await verify(adminToken, doctor.id, { decision: "REJECT" })).status).toBe(400); // reason required
    const res = await verify(adminToken, doctor.id, { decision: "REJECT", reason: "Number not found on the NMC register" });
    expect(res.body.doctor).toMatchObject({ verificationStatus: "REJECTED", rejectionReason: "Number not found on the NMC register" });
  });

  it("only the doctor's own clinic admin can decide, and a doctor cannot verify themselves", async () => {
    const { clinic } = await createClinicWithAdmin();
    const { doctor, token: doctorToken } = await createDoctor(clinic.id, { verified: false });
    await prisma.doctor.update({ where: { id: doctor.id }, data: { registrationNumber: "KMC-2", registrationCouncil: "KMC" } });
    const { token: otherAdmin } = await createClinicWithAdmin();
    expect((await verify(otherAdmin, doctor.id, { decision: "APPROVE" })).status).toBe(403);
    expect((await verify(doctorToken, doctor.id, { decision: "APPROVE" })).status).toBe(403);
    // verificationStatus is not a field the doctor can set.
    await request(app).patch(`/doctors/${doctor.id}`).set(auth(doctorToken)).send({ verificationStatus: "APPROVED" });
    expect(await inSearch(doctor.id)).toBe(false);
  });

  it("hides unverified doctors from patients and blocks booking them", async () => {
    const { clinic, token: adminToken } = await createClinicWithAdmin();
    const { doctor } = await createDoctor(clinic.id, { verified: false });
    const { doctor: verified } = await createDoctor(clinic.id);
    const slot = await createFutureSlot(doctor.id, 5);
    await createFutureSlot(verified.id, 5);
    const { token: associateToken } = await createAssociate(clinic.id, [doctor.id]);
    const patient = await createPatient();

    expect(await inSearch(doctor.id)).toBe(false);
    expect((await request(app).get(`/doctors/${doctor.id}`)).status).toBe(404);
    expect((await request(app).get(`/doctors/${verified.id}/alternatives`)).body.doctors).toEqual([]);
    expect((await request(app).put(`/doctors/${doctor.id}/slot-alert`).set(auth(patient.token))).status).toBe(404);
    expect((await request(app).post("/appointments/book").set(auth(patient.token)).send({ slotId: slot.id })).status).toBe(409);
    const walkIn = await request(app)
      .post(`/doctors/${doctor.id}/walk-ins`)
      .set(auth(associateToken))
      .send({ fullName: "Ravi", phoneNumber: "+919845000009", feeCollected: false, consent: true });
    expect(walkIn.status).toBe(409);

    // Approved: visible and bookable.
    await request(app).patch(`/doctors/${doctor.id}`).set(auth(adminToken)).send({ registrationNumber: "KMC-7", registrationCouncil: "KMC" });
    await verify(adminToken, doctor.id, { decision: "APPROVE" });
    expect(await inSearch(doctor.id)).toBe(true);
    expect((await request(app).post("/appointments/book").set(auth(patient.token)).send({ slotId: slot.id })).status).toBe(201);
  });
});
