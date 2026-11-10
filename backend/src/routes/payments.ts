import crypto from "crypto";
import { Router } from "express";
import { prisma } from "../lib/prisma";
import { asyncHandler, HttpError } from "../middleware/errorHandler";
import { requireAuth, requireRole } from "../middleware/auth";
import { createOrderSchema } from "../schemas";
import { createOrder, signWebhookBody } from "../lib/payments";
import { processWebhook } from "../lib/paymentService";
import { env } from "../lib/env";

export const paymentsRouter = Router();

paymentsRouter.post(
  "/create-order",
  requireAuth,
  requireRole("PATIENT"),
  asyncHandler(async (req, res) => {
    const { appointmentId } = createOrderSchema.parse(req.body);
    const appointment = await prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: { doctor: true, payment: true },
    });
    if (!appointment || appointment.patientId !== req.auth!.profileId) {
      throw new HttpError(404, "Appointment not found");
    }
    if (appointment.status !== "PENDING_PAYMENT") {
      throw new HttpError(409, "Appointment is not awaiting payment");
    }

    // Reuse an unpaid order on retry: a second order for the same booking
    // could be paid too, and then one of the two payments would need a refund.
    const existing = appointment.payment;
    if (existing?.status === "CREATED" && existing.gatewayOrderId) {
      res.json({
        order: {
          orderId: existing.gatewayOrderId,
          amount: existing.amount * 100,
          currency: "INR",
          keyId: env.paymentsMode === "stub" ? "rzp_test_stub" : env.razorpayKeyId,
          mode: env.paymentsMode,
        },
      });
      return;
    }

    const fee = appointment.doctor.consultationFee;
    const order = await createOrder(appointment.id, fee * 100);
    await prisma.payment.upsert({
      where: { appointmentId: appointment.id },
      create: { appointmentId: appointment.id, amount: fee, status: "CREATED", gatewayOrderId: order.orderId },
      update: { amount: fee, status: "CREATED", gatewayOrderId: order.orderId },
    });
    res.json({ order });
  })
);

/**
 * Razorpay webhook. The ONLY way a booking becomes paid: the browser never
 * confirms payment. Configure it in the Razorpay dashboard for the
 * payment.captured event, with RAZORPAY_WEBHOOK_SECRET as its secret.
 */
paymentsRouter.post(
  "/webhook",
  asyncHandler(async (req, res) => {
    const signature = String(req.headers["x-razorpay-signature"] ?? "");
    const rawBody = (req as unknown as { rawBody?: string }).rawBody;
    if (!rawBody) throw new HttpError(400, "Missing body");
    const result = await processWebhook(rawBody, signature);
    res.json({ ok: true, ...result });
  })
);

/**
 * Local development only (PAYMENTS_MODE=stub, NODE_ENV not production):
 * stands in for the Razorpay checkout by building the webhook Razorpay would
 * send, signing it with the webhook secret, and running it through exactly
 * the same verification and confirmation code as the real webhook.
 */
paymentsRouter.post(
  "/dev/simulate",
  requireAuth,
  requireRole("PATIENT"),
  asyncHandler(async (req, res) => {
    if (env.paymentsMode !== "stub" || env.isProduction) throw new HttpError(404, "Not found");
    const { appointmentId } = createOrderSchema.parse(req.body);
    const payment = await prisma.payment.findUnique({ where: { appointmentId }, include: { appointment: true } });
    if (!payment || payment.appointment.patientId !== req.auth!.profileId || !payment.gatewayOrderId) {
      throw new HttpError(404, "No order for this appointment; create one first");
    }
    const rawBody = JSON.stringify({
      event: "payment.captured",
      payload: {
        payment: {
          entity: {
            id: `pay_stub_${crypto.randomBytes(8).toString("hex")}`,
            order_id: payment.gatewayOrderId,
            amount: payment.amount * 100,
            currency: "INR",
            status: "captured",
          },
        },
      },
    });
    const result = await processWebhook(rawBody, signWebhookBody(rawBody));
    res.json({ ok: true, ...result });
  })
);
