import { describe, it, expect } from "vitest";
import { createApp } from "../app";
import { prisma } from "../lib/prisma";
import { releaseExpiredHolds } from "../jobs/releaseExpiredHolds";
import { createClinicWithAdmin, createDoctor, createPatient, createFutureSlot } from "./factories";
import { book, capturedEvent, createOrder, sendWebhook } from "./paymentHelpers";

const app = createApp();

async function setup() {
  const { clinic } = await createClinicWithAdmin();
  const { doctor } = await createDoctor(clinic.id);
  const { token: patientToken } = await createPatient();
  const slot = await createFutureSlot(doctor.id);
  const appointmentId = await book(app, patientToken, slot.id);
  const order = await createOrder(app, patientToken, appointmentId);
  return { doctor, slot, patientToken, appointmentId, order };
}

describe("payment webhook", () => {
  it("rejects a bad or missing signature", async () => {
    const { order } = await setup();
    const body = capturedEvent(order.orderId, order.amount);
    expect((await sendWebhook(app, body, "0".repeat(64))).status).toBe(401);
    expect((await sendWebhook(app, body, "")).status).toBe(401);
    // A body altered after signing fails too.
    const signedForOther = capturedEvent(order.orderId, 1);
    const tampered = await sendWebhook(app, body, (await import("../lib/payments")).signWebhookBody(signedForOther));
    expect(tampered.status).toBe(401);
  });

  it("never double-books on a repeated webhook delivery", async () => {
    const { appointmentId, order } = await setup();
    const body = capturedEvent(order.orderId, order.amount, "pay_repeat_1");

    const first = await sendWebhook(app, body);
    const second = await sendWebhook(app, body);
    expect(first.body.outcome).toBe("confirmed");
    expect(second.status).toBe(200);
    expect(second.body.outcome).toBe("duplicate");

    const payments = await prisma.payment.findMany({ where: { appointmentId } });
    expect(payments).toHaveLength(1);
    expect(payments[0].status).toBe("PAID");
    expect(await prisma.qrToken.count({ where: { appointmentId } })).toBe(1);
  });

  it("confirms exactly once when the same webhook arrives in parallel", async () => {
    const { appointmentId, order } = await setup();
    const body = capturedEvent(order.orderId, order.amount, "pay_parallel_1");

    const results = await Promise.all(Array.from({ length: 5 }, () => sendWebhook(app, body)));
    expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
    expect(results.filter((r) => r.body.outcome === "confirmed")).toHaveLength(1);

    const appointment = await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } });
    expect(appointment.status).toBe("BOOKED");
    expect(await prisma.notification.count({ where: { type: "BOOKING_CONFIRMED" } })).toBe(1);
  });

  it("ignores a capture whose amount does not match the order", async () => {
    const { appointmentId, order } = await setup();
    const res = await sendWebhook(app, capturedEvent(order.orderId, order.amount - 100));
    expect(res.body.outcome).toBe("ignored");
    const appointment = await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } });
    expect(appointment.status).toBe("PENDING_PAYMENT");
  });

  it("honours a late payment if the expired slot is still free", async () => {
    const { appointmentId, order } = await setup();
    await prisma.appointment.update({ where: { id: appointmentId }, data: { createdAt: new Date(Date.now() - 11 * 60_000) } });
    expect(await releaseExpiredHolds()).toBe(1);

    const res = await sendWebhook(app, capturedEvent(order.orderId, order.amount));
    expect(res.body.outcome).toBe("confirmed");
    const appointment = await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId }, include: { slot: true } });
    expect(appointment.status).toBe("BOOKED");
    expect(appointment.slot.isBooked).toBe(true);
  });

  it("refunds a late payment when someone else has taken the slot", async () => {
    const { slot, appointmentId, order } = await setup();
    await prisma.appointment.update({ where: { id: appointmentId }, data: { createdAt: new Date(Date.now() - 11 * 60_000) } });
    await releaseExpiredHolds();
    const { token: otherPatient } = await createPatient();
    await book(app, otherPatient, slot.id); // the released slot is bookable again

    const res = await sendWebhook(app, capturedEvent(order.orderId, order.amount));
    expect(res.body.outcome).toBe("refunded");
    const payment = await prisma.payment.findUniqueOrThrow({ where: { appointmentId }, include: { refund: true } });
    expect(payment.status).toBe("REFUNDED");
    expect(payment.refund?.status).toBe("PROCESSED");
    expect(payment.refund?.amount).toBe(order.amount / 100);

    // Re-delivery does not refund twice.
    const again = await sendWebhook(app, capturedEvent(order.orderId, order.amount, payment.gatewayRef!));
    expect(again.body.outcome).toBe("duplicate");
    expect(await prisma.refund.count()).toBe(1);
  });

  it("does not let the hold-expiry job cancel a booking that was just paid", async () => {
    const { appointmentId, order } = await setup();
    await prisma.appointment.update({ where: { id: appointmentId }, data: { createdAt: new Date(Date.now() - 11 * 60_000) } });
    await sendWebhook(app, capturedEvent(order.orderId, order.amount));
    expect(await releaseExpiredHolds()).toBe(0);
    const appointment = await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } });
    expect(appointment.status).toBe("BOOKED");
  });

  it("reuses the unpaid order when the patient retries payment", async () => {
    const { patientToken, appointmentId, order } = await setup();
    const retry = await createOrder(app, patientToken, appointmentId);
    expect(retry.orderId).toBe(order.orderId);
  });
});
