import { z } from "zod";
import { prisma } from "./prisma";
import { refundPayment, verifyWebhookSignature } from "./payments";
import { tokenForSlot, ensureClinicDay } from "./queueService";
import { publishQueueEvent } from "./redis";
import { generateShortCode, signQrToken } from "./qr";
import { notifyPatient } from "./notifications";
import { writeAuditLog } from "./audit";
import { HttpError } from "../middleware/errorHandler";
import { HOLD_EXPIRED_REASON } from "../jobs/releaseExpiredHolds";
import { accountUserId, contactSelect } from "./family";

/** The part of Razorpay's payment.captured / order.paid webhook body we rely on. */
const razorpayEventSchema = z.object({
  event: z.string(),
  payload: z
    .object({
      payment: z
        .object({
          entity: z.object({
            id: z.string(),
            order_id: z.string(),
            amount: z.number().int(),
            currency: z.string(),
            status: z.string(),
          }),
        })
        .optional(),
    })
    .optional(),
});

const CAPTURE_EVENTS = new Set(["payment.captured", "order.paid"]);

export type WebhookOutcome =
  | { outcome: "confirmed"; appointmentId: string; token: number }
  | { outcome: "duplicate"; appointmentId: string }
  | { outcome: "refunded"; appointmentId: string; reason: string }
  | { outcome: "ignored"; reason: string };

/**
 * Entry point for the gateway webhook. Verifies the signature over the raw
 * body, then confirms the booking. Safe to call any number of times, in
 * parallel, for the same payment: only one call can move the appointment
 * out of PENDING_PAYMENT, and every other call reports "duplicate".
 */
export async function processWebhook(rawBody: string, signature: string): Promise<WebhookOutcome> {
  if (!verifyWebhookSignature(rawBody, signature)) throw new HttpError(401, "Invalid webhook signature");

  let parsed: z.infer<typeof razorpayEventSchema>;
  try {
    parsed = razorpayEventSchema.parse(JSON.parse(rawBody));
  } catch {
    throw new HttpError(400, "Malformed webhook body");
  }
  const entity = parsed.payload?.payment?.entity;
  if (!CAPTURE_EVENTS.has(parsed.event) || !entity) return { outcome: "ignored", reason: `event ${parsed.event}` };
  if (entity.status !== "captured") return { outcome: "ignored", reason: `payment status ${entity.status}` };

  return confirmCapturedPayment({ gatewayPaymentId: entity.id, orderId: entity.order_id, amountPaise: entity.amount });
}

async function confirmCapturedPayment(captured: {
  gatewayPaymentId: string;
  orderId: string;
  amountPaise: number;
}): Promise<WebhookOutcome> {
  const payment = await prisma.payment.findUnique({
    where: { gatewayOrderId: captured.orderId },
    include: { appointment: { include: { patient: { select: contactSelect } } } },
  });
  if (!payment) return { outcome: "ignored", reason: "unknown order" };
  const appointment = payment.appointment;
  // The login that booked: the patient's own, or their account holder's for a family member.
  const bookerUserId = accountUserId(appointment.patient);

  if (payment.gatewayRef === captured.gatewayPaymentId) {
    return { outcome: "duplicate", appointmentId: appointment.id };
  }
  if (captured.amountPaise !== payment.amount * 100) {
    await writeAuditLog({
      actorUserId: bookerUserId,
      action: "PAYMENT_AMOUNT_MISMATCH",
      targetType: "Appointment",
      targetId: appointment.id,
      metadata: { expectedPaise: payment.amount * 100, receivedPaise: captured.amountPaise, gatewayPaymentId: captured.gatewayPaymentId },
    });
    return { outcome: "ignored", reason: "amount mismatch" };
  }

  const confirmed = await prisma.$transaction(async (tx) => {
    // Only one delivery can win this conditional update; Postgres re-checks
    // the WHERE clause after waiting on a concurrent writer's row lock.
    let won = (await tx.appointment.updateMany({
      where: { id: appointment.id, status: "PENDING_PAYMENT" },
      data: { status: "BOOKED" },
    })).count === 1;

    if (!won) {
      const current = await tx.appointment.findUniqueOrThrow({ where: { id: appointment.id } });
      if (current.status !== "CANCELLED") return null; // already booked by another delivery
      // Only a hold that expired is revived; a booking the patient or clinic
      // cancelled stays cancelled and the late payment is refunded.
      if (current.cancelReason !== HOLD_EXPIRED_REASON) return null;
      // Paid after the 10-minute hold expired. Honour it if the slot is still free.
      const reclaimed = await tx.slot.updateMany({
        where: { id: appointment.slotId, isBooked: false, startsAt: { gt: new Date() } },
        data: { isBooked: true },
      });
      if (reclaimed.count === 0) return null;
      await tx.appointment.update({
        where: { id: appointment.id },
        data: { status: "BOOKED", cancelledAt: null, cancelReason: null },
      });
      won = true;
    }

    const slot = await tx.slot.findUniqueOrThrow({ where: { id: appointment.slotId } });
    const token = await tokenForSlot(tx, slot);
    const expiresAtMs = slot.endsAt.getTime() + 30 * 60 * 1000;
    await tx.appointment.update({
      where: { id: appointment.id },
      data: { queueToken: token, queueDate: slot.slotDate },
    });
    await tx.payment.update({
      where: { id: payment.id },
      data: { status: "PAID", gatewayRef: captured.gatewayPaymentId },
    });
    await tx.qrToken.upsert({
      where: { appointmentId: appointment.id },
      create: {
        appointmentId: appointment.id,
        token: signQrToken(appointment.id, expiresAtMs),
        shortCode: generateShortCode(),
        expiresAt: new Date(expiresAtMs),
      },
      update: { token: signQrToken(appointment.id, expiresAtMs), expiresAt: new Date(expiresAtMs), usedAt: null },
    });
    return { token, queueDate: slot.slotDate };
  });

  if (confirmed) {
    await ensureClinicDay(appointment.doctorId, confirmed.queueDate);
    await publishQueueEvent(appointment.doctorId, {
      type: "TOKEN_ISSUED",
      doctorId: appointment.doctorId,
      queueDate: confirmed.queueDate,
      token: confirmed.token,
    });
    await notifyPatient({
      patientId: appointment.patientId,
      type: "BOOKING_CONFIRMED",
      message: (w) => `Payment received${w.forName}. ${w.Your} queue token is ${confirmed.token}.`,
    });
    await writeAuditLog({
      actorUserId: bookerUserId,
      action: "PAYMENT_CONFIRMED",
      targetType: "Appointment",
      targetId: appointment.id,
      metadata: { gatewayPaymentId: captured.gatewayPaymentId, token: confirmed.token },
    });
    return { outcome: "confirmed", appointmentId: appointment.id, token: confirmed.token };
  }

  const current = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
  if (current.status === "PAID") return { outcome: "duplicate", appointmentId: appointment.id };
  return refundUnbookablePayment(payment.id, appointment.id, appointment.patientId, bookerUserId, captured);
}

/**
 * Money arrived for an appointment that can no longer be booked (the hold
 * expired and someone else took the slot, or it was cancelled). Refund it in
 * full. The conditional update makes sure only one delivery calls the gateway.
 */
async function refundUnbookablePayment(
  paymentId: string,
  appointmentId: string,
  patientId: string,
  patientUserId: string,
  captured: { gatewayPaymentId: string; amountPaise: number }
): Promise<WebhookOutcome> {
  const claimed = await prisma.payment.updateMany({
    where: { id: paymentId, status: "CREATED" },
    data: { status: "REFUNDED", gatewayRef: captured.gatewayPaymentId },
  });
  if (claimed.count === 0) return { outcome: "duplicate", appointmentId };

  const reason = "Slot no longer available when payment arrived";
  let refundStatus: "PROCESSED" | "FAILED" = "PROCESSED";
  let gatewayRef: string | null = null;
  try {
    gatewayRef = (await refundPayment(captured.gatewayPaymentId, captured.amountPaise)).refundId;
  } catch (err) {
    refundStatus = "FAILED";
    console.error("refund failed", err);
  }
  await prisma.refund.create({
    data: { paymentId, amount: captured.amountPaise / 100, status: refundStatus, gatewayRef },
  });
  if (refundStatus === "PROCESSED") {
    await notifyPatient({
      patientId,
      type: "REFUND_ISSUED",
      message: (w) => `Your payment${w.forName} arrived after the slot was released, so it has been refunded in full.`,
    });
  }
  await writeAuditLog({
    actorUserId: patientUserId,
    action: refundStatus === "PROCESSED" ? "PAYMENT_REFUNDED_UNBOOKABLE" : "PAYMENT_REFUND_FAILED",
    targetType: "Appointment",
    targetId: appointmentId,
    metadata: { gatewayPaymentId: captured.gatewayPaymentId, refundId: gatewayRef },
  });
  return { outcome: "refunded", appointmentId, reason };
}
