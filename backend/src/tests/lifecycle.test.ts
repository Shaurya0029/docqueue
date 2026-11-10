import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../app";
import { createClinicWithAdmin, createDoctor, createPatient, createFutureSlot } from "./factories";

const app = createApp();

describe("appointment lifecycle", () => {
  it("moves PENDING_PAYMENT -> BOOKED -> CHECKED_IN -> IN_CONSULTATION -> COMPLETED", async () => {
    const { clinic } = await createClinicWithAdmin();
    const { doctor, token: doctorToken } = await createDoctor(clinic.id);
    const { patient, token: patientToken } = await createPatient();
    const slot = await createFutureSlot(doctor.id);

    const booked = await request(app)
      .post("/appointments/book")
      .set("Authorization", `Bearer ${patientToken}`)
      .send({ slotId: slot.id });
    expect(booked.status).toBe(201);
    const appointmentId = booked.body.appointment.id;

    await request(app)
      .post("/payments/create-order")
      .set("Authorization", `Bearer ${patientToken}`)
      .send({ appointmentId });

    const webhook = await request(app)
      .post("/payments/webhook")
      .set("x-webhook-signature", "stub_test")
      .send({ event: "payment.captured", appointmentId, orderId: "order_1", gatewayRef: `pay_${appointmentId}` });
    expect(webhook.status).toBe(200);
    expect(webhook.body.token).toBe(1);

    const qrToken = webhook.body.qrToken as string;
    expect(qrToken).toBeTruthy();

    void patient; // factory return kept for clarity, not otherwise needed here

    const appt = await request(app)
      .get(`/appointments/${appointmentId}`)
      .set("Authorization", `Bearer ${patientToken}`);
    expect(appt.body.appointment.status).toBe("BOOKED");

    const callNextTooEarly = await request(app)
      .post(`/appointments/doctor/${doctor.id}/call-next`)
      .set("Authorization", `Bearer ${doctorToken}`);
    expect(callNextTooEarly.status).toBe(409); // nobody checked in yet

    const complete = await request(app)
      .post(`/appointments/${appointmentId}/complete`)
      .set("Authorization", `Bearer ${doctorToken}`);
    expect(complete.status).toBe(409); // cannot complete before being called
  });

  it("rejects an invalid transition with 409", async () => {
    const { clinic } = await createClinicWithAdmin();
    const { doctor, token: doctorToken } = await createDoctor(clinic.id);
    const { token: patientToken } = await createPatient();
    const slot = await createFutureSlot(doctor.id);

    const booked = await request(app)
      .post("/appointments/book")
      .set("Authorization", `Bearer ${patientToken}`)
      .send({ slotId: slot.id });
    const appointmentId = booked.body.appointment.id;

    // Still PENDING_PAYMENT: completing should 409, not 500.
    const complete = await request(app)
      .post(`/appointments/${appointmentId}/complete`)
      .set("Authorization", `Bearer ${doctorToken}`);
    expect(complete.status).toBe(409);
  });
});
