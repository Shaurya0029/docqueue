import { Router } from "express";
import { prisma } from "../lib/prisma";
import { asyncHandler, HttpError } from "../middleware/errorHandler";
import { requireAuth, requireRole } from "../middleware/auth";
import { bookAppointmentSchema, cancelAppointmentSchema, leaveAlertSchema, rescheduleSchema } from "../schemas";
import { disableLeaveAlert, enableLeaveAlert, leaveAlertState } from "../lib/leaveNow";
import { estimateWait } from "../lib/waitTime";
import { assertDoctorAccess } from "../lib/scope";
import { cancelAppointment, rescheduleAppointment } from "../lib/appointmentChanges";
import { issueRefund } from "../lib/refunds";
import { assertDoctorBookable } from "../lib/bookable";
import { ownedByAccount, resolveBookingPatient } from "../lib/family";
import { leaveAlertInclude } from "../lib/leaveNow";

/** On a patient's own views: who the visit is for (themself or a family member). */
const visitFor = { select: { id: true, fullName: true, accountHolderId: true } } as const;

export const appointmentsRouter = Router();

appointmentsRouter.post(
  "/book",
  requireAuth,
  requireRole("PATIENT"),
  asyncHandler(async (req, res) => {
    const { slotId, patientId: requestedPatientId } = bookAppointmentSchema.parse(req.body);
    // Who the visit is for: the account holder or one of their own family members.
    const patientId = await resolveBookingPatient(req.auth!.profileId, requestedPatientId);

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
          patientId,
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
      where: ownedByAccount(req.auth!.profileId),
      include: { doctor: { include: { clinic: true } }, slot: true, payment: { include: { refund: true } }, patient: visitFor },
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
    const found = await prisma.appointment.findFirst({
      where: { id: req.params.id, ...ownedByAccount(req.auth!.profileId) },
      include: { ...leaveAlertInclude, slot: true, payment: { include: { refund: true } }, qrToken: true },
    });
    if (!found) throw new HttpError(404, "Appointment not found");
    // Only who the visit is for, never the minor/age fields used for the leave-now rule.
    const { patient, ...appointment } = found;
    res.json({
      appointment: { ...appointment, patient: { id: patient.id, fullName: patient.fullName, accountHolderId: patient.accountHolderId } },
      leaveAlert: leaveAlertState(found),
    });
  })
);

appointmentsRouter.get(
  "/:id/queue-status",
  requireAuth,
  requireRole("PATIENT"),
  asyncHandler(async (req, res) => {
    const appointment = await prisma.appointment.findFirst({ where: { id: req.params.id, ...ownedByAccount(req.auth!.profileId) } });
    if (!appointment) throw new HttpError(404, "Appointment not found");
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
    const appointment = await prisma.appointment.findFirst({ where: { id: req.params.id, ...ownedByAccount(req.auth!.profileId) } });
    if (!appointment) throw new HttpError(404, "Appointment not found");
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

/** "Leave now" alert: turn on (from a one-time location or typed minutes), adjust, or turn off. */
appointmentsRouter.put(
  "/:id/leave-alert",
  requireAuth,
  requireRole("PATIENT"),
  asyncHandler(async (req, res) => {
    const body = leaveAlertSchema.parse(req.body);
    const state = await enableLeaveAlert({
      appointmentId: req.params.id,
      patientProfileId: req.auth!.profileId,
      ...("travelMinutes" in body ? { manualMinutes: body.travelMinutes } : { from: body }),
    });
    res.json({ leaveAlert: state });
  })
);

appointmentsRouter.delete(
  "/:id/leave-alert",
  requireAuth,
  requireRole("PATIENT"),
  asyncHandler(async (req, res) => {
    res.json({ leaveAlert: await disableLeaveAlert(req.params.id, req.auth!.profileId) });
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
