import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../app";
import { prisma } from "../lib/prisma";
import { createClinicWithAdmin, createDoctor, createPatient, createFutureSlot } from "./factories";

const app = createApp();

describe("payment webhook", () => {
  it("rejects a bad signature", async () => {
    const res = await request(app)
      .post("/payments/webhook")
      .set("x-webhook-signature", "not_a_stub_signature")
      .send({ event: "payment.captured", appointmentId: "00000000-0000-0000-0000-000000000000", orderId: "o1", gatewayRef: "ref1" });
    expect(res.status).toBe(401);
  });

  it("never double-books on a repeated webhook delivery", async () => {
    const { clinic } = await createClinicWithAdmin();
    const { doctor } = await createDoctor(clinic.id);
    const { token: patientToken } = await createPatient();
    const slot = await createFutureSlot(doctor.id);

    const booked = await request(app)
      .post("/appointments/book")
      .set("Authorization", `Bearer ${patientToken}`)
      .send({ slotId: slot.id });
    const appointmentId = booked.body.appointment.id;
    const gatewayRef = `pay_${appointmentId}`;

    const payload = { event: "payment.captured", appointmentId, orderId: "order_1", gatewayRef };
    const first = await request(app).post("/payments/webhook").set("x-webhook-signature", "stub_1").send(payload);
    const second = await request(app).post("/payments/webhook").set("x-webhook-signature", "stub_1").send(payload);

    expect(first.status).toBe(200);
    expect(first.body.idempotent).toBeUndefined();
    expect(second.status).toBe(200);
    expect(second.body.idempotent).toBe(true);

    const appointment = await prisma.appointment.findUnique({ where: { id: appointmentId } });
    expect(appointment?.queueToken).toBe(1);

    const payments = await prisma.payment.findMany({ where: { appointmentId } });
    expect(payments).toHaveLength(1);
    expect(payments[0].status).toBe("PAID");
  });
});
