import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../app";
import { prisma } from "../lib/prisma";
import { createClinicWithAdmin, createDoctor, createAssociate, createPatient, createFutureSlot } from "./factories";
import { book, bookAndPay, capturedEvent, createOrder, sendWebhook } from "./paymentHelpers";

const app = createApp();
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function paidBooking(hoursFromNow: number) {
  const { clinic, token: adminToken } = await createClinicWithAdmin();
  const { doctor, token: doctorToken } = await createDoctor(clinic.id);
  const patient = await createPatient();
  const slot = await createFutureSlot(doctor.id, hoursFromNow);
  const { appointmentId, qrToken } = await bookAndPay(app, patient.token, slot.id);
  return { clinic, adminToken, doctor, doctorToken, patient, slot, appointmentId, qrToken };
}

async function notificationTypes(userId: string) {
  return (await prisma.notification.findMany({ where: { userId }, orderBy: { sentAt: "asc" } })).map((n) => n.type);
}

describe("patient cancellation", () => {
  it("refunds in full when cancelled 2+ hours before, and frees the slot", async () => {
    const { patient, slot, appointmentId } = await paidBooking(5);
    const res = await request(app).post(`/appointments/${appointmentId}/cancel`).set(auth(patient.token)).send({});
    expect(res.status).toBe(200);
    expect(res.body.refund).toBe("PROCESSED");

    const payment = await prisma.payment.findUniqueOrThrow({ where: { appointmentId }, include: { refund: true } });
    expect(payment.status).toBe("REFUNDED");
    expect(payment.refund).toMatchObject({ status: "PROCESSED", amount: payment.amount });
    expect((await prisma.slot.findUniqueOrThrow({ where: { id: slot.id } })).isBooked).toBe(false);
    expect(await notificationTypes(patient.user.id)).toEqual(["BOOKING_CONFIRMED", "REFUND_ISSUED", "CANCELLED"]);

    // Cancelling twice is refused and does not refund twice.
    expect((await request(app).post(`/appointments/${appointmentId}/cancel`).set(auth(patient.token)).send({})).status).toBe(409);
    expect(await prisma.refund.count()).toBe(1);
  });

  it("does not refund within 2 hours, but the doctor can override", async () => {
    const { patient, doctorToken, appointmentId } = await paidBooking(1);
    const res = await request(app).post(`/appointments/${appointmentId}/cancel`).set(auth(patient.token)).send({});
    expect(res.body.refund).toBe("NOT_ELIGIBLE");
    expect((await prisma.payment.findUniqueOrThrow({ where: { appointmentId } })).status).toBe("PAID");

    const override = await request(app).post(`/appointments/${appointmentId}/refund-override`).set(auth(doctorToken)).send({ reason: "family emergency" });
    expect(override.status).toBe(200);
    expect(override.body.refund).toBe("PROCESSED");
    const again = await request(app).post(`/appointments/${appointmentId}/refund-override`).set(auth(doctorToken)).send({});
    expect(again.status).toBe(409);
    expect(await prisma.refund.count()).toBe(1);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "REFUND_ISSUED", targetId: appointmentId } });
    expect(audit.metadata).toContain("family emergency");
  });

  it("refunds a payment that lands after the patient cancelled, instead of re-booking", async () => {
    const { clinic } = await createClinicWithAdmin();
    const { doctor } = await createDoctor(clinic.id);
    const patient = await createPatient();
    const slot = await createFutureSlot(doctor.id, 5);
    const appointmentId = await book(app, patient.token, slot.id);
    const order = await createOrder(app, patient.token, appointmentId);
    await request(app).post(`/appointments/${appointmentId}/cancel`).set(auth(patient.token)).send({});

    const webhook = await sendWebhook(app, capturedEvent(order.orderId, order.amount));
    expect(webhook.body.outcome).toBe("refunded");
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } })).status).toBe("CANCELLED");
  });

  it("keeps the payment refundable when the gateway refund fails", async () => {
    const { patient, doctorToken, appointmentId } = await paidBooking(5);
    // Simulate a payment the gateway cannot refund (no gateway reference).
    await prisma.payment.update({ where: { appointmentId }, data: { gatewayRef: null } });
    const res = await request(app).post(`/appointments/${appointmentId}/cancel`).set(auth(patient.token)).send({});
    expect(res.body.refund).toBe("FAILED");
    expect((await prisma.payment.findUniqueOrThrow({ where: { appointmentId } })).status).toBe("PAID");
    expect(await notificationTypes(patient.user.id)).not.toContain("REFUND_ISSUED");

    await prisma.payment.update({ where: { appointmentId }, data: { gatewayRef: "pay_restored" } });
    const retry = await request(app).post(`/appointments/${appointmentId}/refund-override`).set(auth(doctorToken)).send({});
    expect(retry.body.refund).toBe("PROCESSED");
    expect((await prisma.refund.findFirstOrThrow()).status).toBe("PROCESSED");
  });
});

describe("clinic cancellation", () => {
  it("always refunds in full, and only the patient's own doctor or clinic admin may do it", async () => {
    const { clinic, adminToken, doctor, patient, appointmentId } = await paidBooking(1);
    const { token: otherDoctorToken } = await createDoctor(clinic.id);
    const { token: associateToken } = await createAssociate(clinic.id, [doctor.id]);
    const { token: otherAdminToken } = await createClinicWithAdmin();

    expect((await request(app).post(`/appointments/${appointmentId}/cancel-by-clinic`).set(auth(otherDoctorToken)).send({})).status).toBe(403);
    expect((await request(app).post(`/appointments/${appointmentId}/cancel-by-clinic`).set(auth(associateToken)).send({})).status).toBe(403);
    expect((await request(app).post(`/appointments/${appointmentId}/cancel-by-clinic`).set(auth(otherAdminToken)).send({})).status).toBe(403);

    const res = await request(app).post(`/appointments/${appointmentId}/cancel-by-clinic`).set(auth(adminToken)).send({ reason: "Doctor unwell" });
    expect(res.body.refund).toBe("PROCESSED");
    const message = await prisma.notification.findFirstOrThrow({ where: { userId: patient.user.id, type: "CANCELLED" } });
    expect(message.payload).toContain("The clinic has cancelled");
  });
});

describe("reschedule", () => {
  it("moves to another free slot of the same doctor with a new token and QR", async () => {
    const { doctor, patient, slot, appointmentId, qrToken } = await paidBooking(5);
    const { token: associateToken } = await createAssociate((await prisma.doctor.findUniqueOrThrow({ where: { id: doctor.id } })).clinicId, [doctor.id]);
    const newSlot = await createFutureSlot(doctor.id, 6);

    const res = await request(app).post(`/appointments/${appointmentId}/reschedule`).set(auth(patient.token)).send({ slotId: newSlot.id });
    expect(res.status).toBe(200);

    const appointment = await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId }, include: { qrToken: true } });
    expect(appointment.slotId).toBe(newSlot.id);
    expect(appointment.status).toBe("BOOKED");
    expect(appointment.qrToken!.token).not.toBe(qrToken);
    expect((await prisma.slot.findUniqueOrThrow({ where: { id: slot.id } })).isBooked).toBe(false);
    expect((await prisma.slot.findUniqueOrThrow({ where: { id: newSlot.id } })).isBooked).toBe(true);

    // The old QR no longer checks anyone in; the new one does.
    expect((await request(app).post("/appointments/qr/scan").set(auth(associateToken)).send({ token: qrToken })).status).toBe(400);
    expect((await request(app).post("/appointments/qr/scan").set(auth(associateToken)).send({ token: appointment.qrToken!.token })).status).toBe(200);
  });

  it("refuses within 2 hours, a taken slot, and another doctor's slot", async () => {
    const late = await paidBooking(1);
    const lateTarget = await createFutureSlot(late.doctor.id, 7);
    expect((await request(app).post(`/appointments/${late.appointmentId}/reschedule`).set(auth(late.patient.token)).send({ slotId: lateTarget.id })).status).toBe(409);

    const { doctor, patient, appointmentId, clinic } = await paidBooking(5);
    const taken = await createFutureSlot(doctor.id, 8);
    const other = await createPatient();
    await bookAndPay(app, other.token, taken.id);
    expect((await request(app).post(`/appointments/${appointmentId}/reschedule`).set(auth(patient.token)).send({ slotId: taken.id })).status).toBe(409);

    const { doctor: otherDoctor } = await createDoctor(clinic.id);
    const foreign = await createFutureSlot(otherDoctor.id, 9);
    expect((await request(app).post(`/appointments/${appointmentId}/reschedule`).set(auth(patient.token)).send({ slotId: foreign.id })).status).toBe(409);

    // Someone else's appointment cannot be moved.
    const free = await createFutureSlot(doctor.id, 10);
    expect((await request(app).post(`/appointments/${appointmentId}/reschedule`).set(auth(other.token)).send({ slotId: free.id })).status).toBe(404);
  });
});
