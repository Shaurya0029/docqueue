import crypto from "crypto";
import request from "supertest";
import type { Express } from "express";
import { prisma } from "../lib/prisma";
import { signWebhookBody } from "../lib/payments";

/** A Razorpay payment.captured webhook body, as Razorpay sends it. */
export function capturedEvent(orderId: string, amountPaise: number, paymentId = `pay_${crypto.randomBytes(7).toString("hex")}`) {
  return JSON.stringify({
    entity: "event",
    event: "payment.captured",
    payload: { payment: { entity: { id: paymentId, order_id: orderId, amount: amountPaise, currency: "INR", status: "captured" } } },
  });
}

/** Posts a webhook body signed with the test webhook secret, exactly as Razorpay would. */
export function sendWebhook(app: Express, rawBody: string, signature = signWebhookBody(rawBody)) {
  return request(app)
    .post("/payments/webhook")
    .set("Content-Type", "application/json")
    .set("X-Razorpay-Signature", signature)
    .send(rawBody);
}

/** Books for the account holder, or for one of their family members when `patientId` is given. */
export async function book(app: Express, patientToken: string, slotId: string, patientId?: string): Promise<string> {
  const res = await request(app).post("/appointments/book").set("Authorization", `Bearer ${patientToken}`).send({ slotId, patientId });
  if (res.status !== 201) throw new Error(`booking failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.appointment.id as string;
}

export async function createOrder(app: Express, patientToken: string, appointmentId: string) {
  const res = await request(app).post("/payments/create-order").set("Authorization", `Bearer ${patientToken}`).send({ appointmentId });
  if (res.status !== 200) throw new Error(`create-order failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.order as { orderId: string; amount: number };
}

/** Book a slot, create the order and deliver a signed capture webhook. */
export async function bookAndPay(app: Express, patientToken: string, slotId: string, patientId?: string) {
  const appointmentId = await book(app, patientToken, slotId, patientId);
  const order = await createOrder(app, patientToken, appointmentId);
  const webhook = await sendWebhook(app, capturedEvent(order.orderId, order.amount));
  const qr = await prisma.qrToken.findUnique({ where: { appointmentId } });
  return { appointmentId, order, webhook, qrToken: qr?.token ?? "" };
}
