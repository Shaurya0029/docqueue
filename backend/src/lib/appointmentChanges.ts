import { prisma } from "./prisma";
import { HttpError } from "../middleware/errorHandler";
import { formatIst } from "./dates";
import { tokenForSlot, ensureClinicDay, publishQueueUpdate } from "./queueService";
import { generateShortCode, signQrToken } from "./qr";
import { sendNotification } from "./notifications";
import { writeAuditLog } from "./audit";
import { assertDoctorBookable } from "./bookable";
import { isRefundableByPolicy, issueRefund, REFUND_CUTOFF_HOURS, type RefundResult } from "./refunds";

/**
 * Cancels a booking that has not started yet (awaiting payment or booked).
 *
 * - by "patient": full refund only if cancelled REFUND_CUTOFF_HOURS or more
 *   before the slot.
 * - by "clinic" (the doctor or clinic admin): always a full refund.
 *
 * The slot is freed for someone else and the queue is told.
 */
export async function cancelAppointment(params: {
  appointmentId: string;
  by: "patient" | "clinic";
  actorUserId: string;
  reason?: string;
}): Promise<{ refund: RefundResult | "NOT_ELIGIBLE" }> {
  const appointment = await prisma.appointment.findUniqueOrThrow({
    where: { id: params.appointmentId },
    include: { slot: true, payment: true, patient: true },
  });

  const cancelled = await prisma.$transaction(async (tx) => {
    const res = await tx.appointment.updateMany({
      where: { id: appointment.id, status: { in: ["PENDING_PAYMENT", "BOOKED"] } },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancelReason: params.reason ?? (params.by === "clinic" ? "Cancelled by the clinic" : "Cancelled by the patient"),
      },
    });
    if (res.count === 0) return false;
    await tx.slot.update({ where: { id: appointment.slotId }, data: { isBooked: false } });
    return true;
  });
  if (!cancelled) throw new HttpError(409, `Cannot cancel an appointment that is ${appointment.status.toLowerCase().replace("_", " ")}`);

  const eligible = params.by === "clinic" || isRefundableByPolicy(appointment.slot.startsAt);
  let refund: RefundResult | "NOT_ELIGIBLE" = "NOT_PAID";
  if (appointment.payment?.status === "PAID") {
    refund = eligible
      ? await issueRefund({ paymentId: appointment.payment.id, actorUserId: params.actorUserId, reason: `cancelled by ${params.by}` })
      : "NOT_ELIGIBLE";
  }

  const when = formatIst(appointment.slot.startsAt);
  const refundLine =
    refund === "PROCESSED" ? " A full refund has been issued."
      : refund === "NOT_ELIGIBLE" ? ` It was cancelled less than ${REFUND_CUTOFF_HOURS} hours before the slot, so no refund applies.`
        : refund === "FAILED" ? " Your refund is being processed; the clinic will follow up."
          : "";
  await sendNotification({
    userId: appointment.patient.userId,
    type: "CANCELLED",
    message:
      params.by === "clinic"
        ? `The clinic has cancelled your appointment on ${when}.${refundLine}`
        : `Your appointment on ${when} is cancelled.${refundLine}`,
  });
  await publishQueueUpdate(appointment.doctorId, { type: "CANCELLED", appointmentId: appointment.id });
  await writeAuditLog({
    actorUserId: params.actorUserId,
    action: params.by === "clinic" ? "APPOINTMENT_CANCELLED_BY_CLINIC" : "APPOINTMENT_CANCELLED",
    targetType: "Appointment",
    targetId: appointment.id,
    metadata: { refund, reason: params.reason ?? null },
  });
  return { refund };
}

/**
 * Moves a booked appointment to another free slot with the same doctor. The
 * patient keeps their payment and gets a new token and a new QR / check-in
 * code; the old QR stops working. Allowed up to REFUND_CUTOFF_HOURS before
 * the original slot, the same window as a refundable cancellation.
 */
export async function rescheduleAppointment(params: {
  appointmentId: string;
  patientProfileId: string;
  actorUserId: string;
  newSlotId: string;
}): Promise<{ token: number }> {
  const appointment = await prisma.appointment.findUnique({
    where: { id: params.appointmentId },
    include: { slot: true, patient: true },
  });
  if (!appointment || appointment.patientId !== params.patientProfileId) throw new HttpError(404, "Appointment not found");
  if (appointment.status !== "BOOKED") throw new HttpError(409, "Only a booked appointment can be rescheduled");
  if (!isRefundableByPolicy(appointment.slot.startsAt)) {
    throw new HttpError(409, `Appointments can be rescheduled up to ${REFUND_CUTOFF_HOURS} hours before the slot`);
  }
  if (params.newSlotId === appointment.slotId) throw new HttpError(400, "That is already your slot");
  await assertDoctorBookable(appointment.doctorId);

  const result = await prisma.$transaction(async (tx) => {
    const claimed = await tx.slot.updateMany({
      where: { id: params.newSlotId, doctorId: appointment.doctorId, isBooked: false, startsAt: { gt: new Date() } },
      data: { isBooked: true },
    });
    if (claimed.count === 0) throw new HttpError(409, "That slot is no longer available");
    await tx.slot.update({ where: { id: appointment.slotId }, data: { isBooked: false } });

    const slot = await tx.slot.findUniqueOrThrow({ where: { id: params.newSlotId } });
    const token = await tokenForSlot(tx, slot);
    await tx.appointment.update({
      where: { id: appointment.id },
      data: { slotId: slot.id, queueToken: token, queueDate: slot.slotDate, leaveAlertSentAt: null },
    });
    const expiresAtMs = slot.endsAt.getTime() + 30 * 60 * 1000;
    await tx.qrToken.update({
      where: { appointmentId: appointment.id },
      data: { token: signQrToken(appointment.id, expiresAtMs), shortCode: generateShortCode(), expiresAt: new Date(expiresAtMs), usedAt: null },
    });
    return { token, slot };
  });

  await ensureClinicDay(appointment.doctorId, result.slot.slotDate);
  await publishQueueUpdate(appointment.doctorId, { type: "RESCHEDULED", appointmentId: appointment.id });
  await sendNotification({
    userId: appointment.patient.userId,
    type: "BOOKING_CONFIRMED",
    message: `Your appointment has moved to ${formatIst(result.slot.startsAt)}. Your new token is ${result.token}; use the new QR on your ticket.`,
  });
  await writeAuditLog({
    actorUserId: params.actorUserId,
    action: "APPOINTMENT_RESCHEDULED",
    targetType: "Appointment",
    targetId: appointment.id,
    metadata: { fromSlot: appointment.slotId, toSlot: result.slot.id, token: result.token },
  });
  return { token: result.token };
}
