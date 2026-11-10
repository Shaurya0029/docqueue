import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../app";
import { prisma } from "../lib/prisma";
import { signQrToken } from "../lib/qr";
import { createClinicWithAdmin, createDoctor, createAssociate, createPatient, createFutureSlot } from "./factories";

const app = createApp();

async function bookAndPay(doctorId: string, patientToken: string, slotId: string) {
  const booked = await request(app)
    .post("/appointments/book")
    .set("Authorization", `Bearer ${patientToken}`)
    .send({ slotId });
  const appointmentId = booked.body.appointment.id;
  const webhook = await request(app)
    .post("/payments/webhook")
    .set("x-webhook-signature", "stub_1")
    .send({ event: "payment.captured", appointmentId, orderId: "o1", gatewayRef: `pay_${appointmentId}` });
  return { appointmentId, qrToken: webhook.body.qrToken as string };
}

describe("QR check-in", () => {
  it("rejects a reused QR with 409", async () => {
    const { clinic } = await createClinicWithAdmin();
    const { doctor } = await createDoctor(clinic.id);
    const { token: associateToken } = await createAssociate(clinic.id, [doctor.id]);
    const { token: patientToken } = await createPatient();
    const slot = await createFutureSlot(doctor.id);

    const { qrToken } = await bookAndPay(doctor.id, patientToken, slot.id);

    const first = await request(app)
      .post("/appointments/qr/scan")
      .set("Authorization", `Bearer ${associateToken}`)
      .send({ token: qrToken });
    expect(first.status).toBe(200);

    const second = await request(app)
      .post("/appointments/qr/scan")
      .set("Authorization", `Bearer ${associateToken}`)
      .send({ token: qrToken });
    expect(second.status).toBe(409);
  });

  it("rejects an expired QR with 409", async () => {
    const { clinic } = await createClinicWithAdmin();
    const { doctor } = await createDoctor(clinic.id);
    const { token: associateToken } = await createAssociate(clinic.id, [doctor.id]);
    const { patient } = await createPatient();
    const slot = await createFutureSlot(doctor.id);

    const appointment = await prisma.appointment.create({
      data: { patientId: patient.id, doctorId: doctor.id, slotId: slot.id, status: "BOOKED", queueToken: 1, queueDate: "2000-01-01" },
    });
    const expiresAtMs = Date.now() - 60_000;
    const token = signQrToken(appointment.id, expiresAtMs);
    await prisma.qrToken.create({ data: { appointmentId: appointment.id, token, expiresAt: new Date(expiresAtMs) } });

    const res = await request(app)
      .post("/appointments/qr/scan")
      .set("Authorization", `Bearer ${associateToken}`)
      .send({ token });
    expect(res.status).toBe(409);
  });
});
