import { Router } from "express";
import { prisma } from "../lib/prisma";
import { asyncHandler, HttpError } from "../middleware/errorHandler";
import { requireAuth, requireRole } from "../middleware/auth";
import { createOrderSchema, webhookSchema } from "../schemas";
import { createOrder, verifyWebhookSignature } from "../lib/payments";
import { toDateKey } from "../lib/dates";
import { issueNextToken } from "../lib/queueService";
import { publishQueueEvent } from "../lib/redis";
import { signQrToken } from "../lib/qr";
import { sendNotification } from "../lib/sms";
import { writeAuditLog } from "../lib/audit";

export const paymentsRouter = Router();

paymentsRouter.post(
  "/create-order",
  requireAuth,
  requireRole("PATIENT"),
  asyncHandler(async (req, res) => {
    const { appointmentId } = createOrderSchema.parse(req.body);
    const appointment = await prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: { doctor: true },
    });
    if (!appointment || appointment.patientId !== req.auth!.profileId) {
      throw new HttpError(404, "Appointment not found");
    }
    if (appointment.status !== "PENDING_PAYMENT") {
      throw new HttpError(409, "Appointment is not awaiting payment");
    }
    const amountPaise = appointment.doctor.consultationFee * 100;
    const order = createOrder(appointment.id, amountPaise);

    await prisma.payment.upsert({
      where: { appointmentId: appointment.id },
      create: { appointmentId: appointment.id, amount: appointment.doctor.consultationFee, status: "CREATED" },
      update: { amount: appointment.doctor.consultationFee, status: "CREATED" },
    });

    res.json({ order });
  })
);

/**
 * The browser never confirms payment directly (PRD section 7). This endpoint
 * is only ever called by the gateway's signed webhook (or, in stub mode, by
 * the frontend's payment-simulation screen using a signature that starts
 * with "stub_" so it is obviously not production-trustable).
 */
paymentsRouter.post(
  "/webhook",
  asyncHandler(async (req, res) => {
    const signature = String(req.headers["x-webhook-signature"] ?? "");
    const rawBody = (req as unknown as { rawBody?: string }).rawBody ?? JSON.stringify(req.body);
    if (!verifyWebhookSignature(rawBody, signature)) {
      throw new HttpError(401, "Invalid webhook signature");
    }

    const { appointmentId, gatewayRef } = webhookSchema.parse(req.body);

    const existing = await prisma.payment.findUnique({ where: { gatewayRef } });
    if (existing) {
      res.json({ ok: true, idempotent: true });
      return;
    }

    const appointment = await prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: { slot: true, payment: true, patient: true },
    });
    if (!appointment) throw new HttpError(404, "Appointment not found");
    if (appointment.status !== "PENDING_PAYMENT") {
      // Already processed by a prior webhook delivery for this appointment.
      res.json({ ok: true, idempotent: true });
      return;
    }

    const queueDate = toDateKey(appointment.slot.startsAt);
    const token = await issueNextToken(appointment.doctorId, queueDate);
    const expiresAtMs = appointment.slot.endsAt.getTime() + 30 * 60 * 1000;
    const qrTokenValue = signQrToken(appointment.id, expiresAtMs);

    await prisma.$transaction(async (tx) => {
      await tx.payment.upsert({
        where: { appointmentId: appointment.id },
        create: { appointmentId: appointment.id, amount: 0, status: "PAID", gatewayRef },
        update: { status: "PAID", gatewayRef },
      });
      await tx.appointment.update({
        where: { id: appointment.id },
        data: { status: "BOOKED", queueToken: token, queueDate },
      });
      await tx.qrToken.create({
        data: {
          appointmentId: appointment.id,
          token: qrTokenValue,
          expiresAt: new Date(expiresAtMs),
        },
      });
    });

    await publishQueueEvent(appointment.doctorId, { type: "TOKEN_ISSUED", doctorId: appointment.doctorId, queueDate, token });
    await sendNotification({
      userId: appointment.patient.userId,
      type: "BOOKING_CONFIRMED",
      message: `Payment received. Your queue token is ${token}.`,
    });
    await writeAuditLog({
      actorUserId: appointment.patient.userId,
      action: "PAYMENT_CONFIRMED",
      targetType: "Appointment",
      targetId: appointment.id,
      metadata: { gatewayRef, token },
    });

    res.json({ ok: true, token, qrToken: qrTokenValue });
  })
);
