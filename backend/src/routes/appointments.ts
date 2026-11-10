import { Router } from "express";
import { prisma } from "../lib/prisma";
import { asyncHandler, HttpError } from "../middleware/errorHandler";
import { requireAuth, requireRole } from "../middleware/auth";
import { bookAppointmentSchema, cancelAppointmentSchema } from "../schemas";
import { assertTransition } from "../lib/lifecycle";
import { getNowServing, getRollingAvgConsultMinutes } from "../lib/queueService";
import { sendNotification } from "../lib/sms";
import { writeAuditLog } from "../lib/audit";

export const appointmentsRouter = Router();

appointmentsRouter.post(
  "/book",
  requireAuth,
  requireRole("PATIENT"),
  asyncHandler(async (req, res) => {
    const { slotId } = bookAppointmentSchema.parse(req.body);

    const appointment = await prisma.$transaction(async (tx) => {
      // Atomic claim: only one booking can win the race on a given slot.
      const claimed = await tx.slot.updateMany({
        where: { id: slotId, isBooked: false, startsAt: { gte: new Date() } },
        data: { isBooked: true },
      });
      if (claimed.count === 0) throw new HttpError(409, "Slot not available");

      const slot = await tx.slot.findUniqueOrThrow({ where: { id: slotId } });
      return tx.appointment.create({
        data: {
          patientId: req.auth!.profileId,
          doctorId: slot.doctorId,
          slotId: slot.id,
          status: "PENDING_PAYMENT",
        },
      });
    });

    res.status(201).json({ appointment });
  })
);

appointmentsRouter.get(
  "/mine",
  requireAuth,
  requireRole("PATIENT"),
  asyncHandler(async (req, res) => {
    const appointments = await prisma.appointment.findMany({
      where: { patientId: req.auth!.profileId },
      include: { doctor: { include: { clinic: true } }, slot: true, payment: true },
      orderBy: { createdAt: "desc" },
    });
    res.json({ appointments });
  })
);

appointmentsRouter.get(
  "/:id",
  requireAuth,
  requireRole("PATIENT"),
  asyncHandler(async (req, res) => {
    const appointment = await prisma.appointment.findUnique({
      where: { id: req.params.id },
      include: { doctor: { include: { clinic: true } }, slot: true, payment: true, qrToken: true },
    });
    if (!appointment || appointment.patientId !== req.auth!.profileId) {
      throw new HttpError(404, "Appointment not found");
    }
    res.json({ appointment });
  })
);

appointmentsRouter.get(
  "/:id/queue-status",
  requireAuth,
  requireRole("PATIENT"),
  asyncHandler(async (req, res) => {
    const appointment = await prisma.appointment.findUnique({ where: { id: req.params.id } });
    if (!appointment || appointment.patientId !== req.auth!.profileId) {
      throw new HttpError(404, "Appointment not found");
    }
    if (!appointment.queueToken || !appointment.queueDate) {
      res.json({ status: appointment.status, myToken: null, nowServing: null, patientsAhead: null, estimatedWaitMinutes: null });
      return;
    }
    const nowServing = await getNowServing(appointment.doctorId, appointment.queueDate);
    const avgMinutes = await getRollingAvgConsultMinutes(appointment.doctorId);
    // Tokens follow slot positions, so empty or cancelled slots leave gaps:
    // count the real patients still waiting ahead, not the token difference.
    const patientsAhead = await prisma.appointment.count({
      where: {
        doctorId: appointment.doctorId,
        queueDate: appointment.queueDate,
        status: { in: ["BOOKED", "CHECKED_IN"] },
        queueToken: { lt: appointment.queueToken, gt: nowServing },
      },
    });
    res.json({
      status: appointment.status,
      myToken: appointment.queueToken,
      nowServing,
      patientsAhead,
      estimatedWaitMinutes: Math.round(patientsAhead * avgMinutes),
    });
  })
);

appointmentsRouter.post(
  "/:id/cancel",
  requireAuth,
  requireRole("PATIENT"),
  asyncHandler(async (req, res) => {
    const { reason } = cancelAppointmentSchema.parse(req.body);
    const appointment = await prisma.appointment.findUnique({
      where: { id: req.params.id },
      include: { slot: true, payment: true },
    });
    if (!appointment || appointment.patientId !== req.auth!.profileId) {
      throw new HttpError(404, "Appointment not found");
    }
    assertTransition(appointment.status, "CANCELLED");

    const hoursUntilSlot = (appointment.slot.startsAt.getTime() - Date.now()) / 3_600_000;
    const eligibleForRefund = hoursUntilSlot >= 2;

    await prisma.$transaction(async (tx) => {
      await tx.appointment.update({
        where: { id: appointment.id },
        data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: reason ?? null },
      });
      await tx.slot.update({ where: { id: appointment.slotId }, data: { isBooked: false } });
      if (appointment.payment && appointment.payment.status === "PAID" && eligibleForRefund) {
        await tx.refund.create({
          data: { paymentId: appointment.payment.id, amount: appointment.payment.amount, status: "PENDING" },
        });
        await tx.payment.update({ where: { id: appointment.payment.id }, data: { status: "REFUNDED" } });
      }
    });

    const patient = await prisma.patient.findUnique({ where: { id: appointment.patientId } });
    if (patient) {
      await sendNotification({
        userId: patient.userId,
        type: "CANCELLED",
        message: `Your appointment has been cancelled.${eligibleForRefund ? " A refund has been issued." : ""}`,
      });
    }
    await writeAuditLog({
      actorUserId: req.auth!.userId,
      action: "APPOINTMENT_CANCELLED",
      targetType: "Appointment",
      targetId: appointment.id,
      metadata: { eligibleForRefund },
    });

    res.json({ ok: true, refunded: eligibleForRefund });
  })
);
