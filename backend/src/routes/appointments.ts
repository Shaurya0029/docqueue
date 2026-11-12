import { Router } from "express";
import { prisma } from "../lib/prisma";
import { asyncHandler, HttpError } from "../middleware/errorHandler";
import { requireAuth, requireRole } from "../middleware/auth";
import { bookAppointmentSchema, cancelAppointmentSchema, rescheduleSchema } from "../schemas";
import { estimateWait } from "../lib/waitTime";
import { assertDoctorAccess } from "../lib/scope";
import { cancelAppointment, rescheduleAppointment } from "../lib/appointmentChanges";
import { issueRefund } from "../lib/refunds";
import { assertDoctorBookable } from "../lib/bookable";

export const appointmentsRouter = Router();

appointmentsRouter.post(
  "/book",
  requireAuth,
  requireRole("PATIENT"),
  asyncHandler(async (req, res) => {
    const { slotId } = bookAppointmentSchema.parse(req.body);

    const target = await prisma.slot.findUnique({ where: { id: slotId }, select: { doctorId: true } });
    if (!target) throw new HttpError(404, "Slot not found");
    await assertDoctorBookable(target.doctorId);

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
      include: { doctor: { include: { clinic: true } }, slot: true, payment: { include: { refund: true } } },
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
      include: { doctor: { include: { clinic: true } }, slot: true, payment: { include: { refund: true } }, qrToken: true },
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
      res.json({
        status: appointment.status,
        myToken: null,
        nowServing: null,
        patientsAhead: null,
        estimatedWaitMinutes: null,
        averageConsultMinutes: null,
        estimateBasis: null,
        estimateSampleSize: null,
      });
      return;
    }
    const wait = await estimateWait({
      doctorId: appointment.doctorId,
      queueDate: appointment.queueDate,
      queueToken: appointment.queueToken,
    });
    res.json({
      status: appointment.status,
      myToken: appointment.queueToken,
      nowServing: wait.nowServing,
      patientsAhead: wait.patientsAhead,
      estimatedWaitMinutes: wait.estimatedWaitMinutes,
      averageConsultMinutes: wait.averageMinutes,
      estimateBasis: wait.basis,
      estimateSampleSize: wait.sampleSize,
    });
  })
);

appointmentsRouter.post(
  "/:id/cancel",
  requireAuth,
  requireRole("PATIENT"),
  asyncHandler(async (req, res) => {
    const { reason } = cancelAppointmentSchema.parse(req.body);
    const appointment = await prisma.appointment.findUnique({ where: { id: req.params.id } });
    if (!appointment || appointment.patientId !== req.auth!.profileId) {
      throw new HttpError(404, "Appointment not found");
    }
    const { refund } = await cancelAppointment({ appointmentId: appointment.id, by: "patient", actorUserId: req.auth!.userId, reason });
    res.json({ ok: true, refund, refunded: refund === "PROCESSED" });
  })
);

appointmentsRouter.post(
  "/:id/reschedule",
  requireAuth,
  requireRole("PATIENT"),
  asyncHandler(async (req, res) => {
    const { slotId } = rescheduleSchema.parse(req.body);
    const result = await rescheduleAppointment({
      appointmentId: req.params.id,
      patientProfileId: req.auth!.profileId,
      actorUserId: req.auth!.userId,
      newSlotId: slotId,
    });
    res.json({ ok: true, ...result });
  })
);

/** Doctor (or the clinic's admin) cancels a booking: the patient is always refunded in full. */
appointmentsRouter.post(
  "/:id/cancel-by-clinic",
  requireAuth,
  requireRole("DOCTOR", "ADMIN"),
  asyncHandler(async (req, res) => {
    const { reason } = cancelAppointmentSchema.parse(req.body);
    const appointment = await prisma.appointment.findUnique({ where: { id: req.params.id } });
    if (!appointment) throw new HttpError(404, "Appointment not found");
    await assertDoctorAccess(req.auth!, appointment.doctorId);
    const { refund } = await cancelAppointment({ appointmentId: appointment.id, by: "clinic", actorUserId: req.auth!.userId, reason });
    res.json({ ok: true, refund });
  })
);

/**
 * Doctor override: refund a cancelled booking that the policy did not refund
 * (cancelled late), or retry a refund the gateway failed.
 */
appointmentsRouter.post(
  "/:id/refund-override",
  requireAuth,
  requireRole("DOCTOR", "ADMIN"),
  asyncHandler(async (req, res) => {
    const { reason } = cancelAppointmentSchema.parse(req.body);
    const appointment = await prisma.appointment.findUnique({ where: { id: req.params.id }, include: { payment: true } });
    if (!appointment) throw new HttpError(404, "Appointment not found");
    await assertDoctorAccess(req.auth!, appointment.doctorId);
    if (appointment.status !== "CANCELLED") throw new HttpError(409, "Only a cancelled appointment can be refunded");
    if (appointment.payment?.status !== "PAID") throw new HttpError(409, "There is no unrefunded payment for this appointment");
    const refund = await issueRefund({
      paymentId: appointment.payment.id,
      actorUserId: req.auth!.userId,
      reason: `doctor override${reason ? `: ${reason}` : ""}`,
    });
    res.json({ ok: true, refund });
  })
);
