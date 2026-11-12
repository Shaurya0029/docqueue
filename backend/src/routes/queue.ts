import { Router } from "express";
import { prisma } from "../lib/prisma";
import { asyncHandler, HttpError } from "../middleware/errorHandler";
import { requireAuth, requireRole } from "../middleware/auth";
import { assertDoctorAccess , resolveDoctorScope } from "../lib/scope";
import { assertTransition } from "../lib/lifecycle";
import { setNowServing, publishQueueUpdate } from "../lib/queueService";
import { todayKey } from "../lib/dates";
import { pauseQueueSchema, walkInSchema } from "../schemas";
import { addWalkIn } from "../lib/walkIns";
import { auditStaffRead, writeAuditLog } from "../lib/audit";

export const queueRouter = Router();

queueRouter.get(
  "/associates/me/doctors",
  requireAuth,
  requireRole("ASSOCIATE"),
  asyncHandler(async (req, res) => {
    const links = await prisma.associateDoctor.findMany({
      where: { associateId: req.auth!.profileId },
      include: { doctor: true },
    });
    res.json({ doctors: links.map((l) => l.doctor) });
  })
);

queueRouter.get(
  "/doctors/:id/queue",
  requireAuth,
  requireRole("DOCTOR", "ASSOCIATE"),
  asyncHandler(async (req, res) => {
    const doctorId = await resolveDoctorScope(req.auth!, req.params.id);
    const date = todayKey();
    const appointments = await prisma.appointment.findMany({
      where: { doctorId, queueDate: date, status: { notIn: ["PENDING_PAYMENT", "CANCELLED"] } },
      include: { patient: true },
      orderBy: { queueToken: "asc" },
    });
    const day = await prisma.clinicDay.findUnique({ where: { doctorId_date: { doctorId, date } } });
    await auditStaffRead({
      actorUserId: req.auth!.userId,
      action: "STAFF_VIEWED_QUEUE",
      targetType: "DoctorDay",
      targetId: `${doctorId}:${date}`,
      patientIds: appointments.map((a) => a.patientId),
    });
    res.json({
      date,
      status: day?.status ?? "OPEN",
      nowServing: day?.nowServing ?? 0,
      queue: appointments.map((a) => ({
        appointmentId: a.id,
        token: a.queueToken,
        patientName: a.patient.fullName,
        status: a.status,
        isWalkIn: a.isWalkIn,
      })),
    });
  })
);

queueRouter.get(
  "/doctors/:id/appointments",
  requireAuth,
  requireRole("DOCTOR", "ASSOCIATE"),
  asyncHandler(async (req, res) => {
    const doctorId = await resolveDoctorScope(req.auth!, req.params.id);
    const date = String(req.query.date ?? todayKey());
    const appointments = await prisma.appointment.findMany({
      where: { doctorId, queueDate: date },
      // Only what the schedule shows: the patient's name, never their profile.
      include: {
        patient: { select: { fullName: true } },
        slot: true,
        payment: { select: { status: true, amount: true, refund: { select: { status: true, amount: true } } } },
      },
      orderBy: { queueToken: "asc" },
    });
    await auditStaffRead({
      actorUserId: req.auth!.userId,
      action: "STAFF_VIEWED_SCHEDULE",
      targetType: "DoctorDay",
      targetId: `${doctorId}:${date}`,
      patientIds: appointments.map((a) => a.patientId),
    });
    res.json({ date, appointments });
  })
);

/** Associate adds a patient who has no app; they get the next free slot today and a token. */
queueRouter.post(
  "/doctors/:id/walk-ins",
  requireAuth,
  requireRole("ASSOCIATE", "DOCTOR"),
  asyncHandler(async (req, res) => {
    const doctorId = await resolveDoctorScope(req.auth!, req.params.id);
    const body = walkInSchema.parse(req.body);
    const result = await addWalkIn({
      doctorId,
      fullName: body.fullName,
      phoneNumber: body.phoneNumber,
      feeCollected: body.feeCollected,
      actorUserId: req.auth!.userId,
    });
    res.status(201).json(result);
  })
);

queueRouter.post(
  "/appointments/doctor/:id/call-next",
  requireAuth,
  requireRole("DOCTOR", "ASSOCIATE"),
  asyncHandler(async (req, res) => {
    const doctorId = await resolveDoctorScope(req.auth!, req.params.id);
    const date = todayKey();

    const next = await prisma.appointment.findFirst({
      where: { doctorId, queueDate: date, status: "CHECKED_IN" },
      orderBy: { queueToken: "asc" },
    });
    if (!next) throw new HttpError(409, "No checked-in patient waiting");

    assertTransition(next.status, "IN_CONSULTATION");
    await prisma.appointment.update({
      where: { id: next.id },
      data: { status: "IN_CONSULTATION", calledAt: new Date() },
    });
    await setNowServing(doctorId, date, next.queueToken!);
    await publishQueueUpdate(doctorId, { type: "CALLED_NEXT", appointmentId: next.id, token: next.queueToken });
    await writeAuditLog({
      actorUserId: req.auth!.userId,
      action: "CALL_NEXT",
      targetType: "Appointment",
      targetId: next.id,
    });

    res.json({ appointmentId: next.id, token: next.queueToken });
  })
);

queueRouter.post(
  "/appointments/:id/complete",
  requireAuth,
  requireRole("DOCTOR", "ASSOCIATE"),
  asyncHandler(async (req, res) => {
    const appointment = await prisma.appointment.findUnique({ where: { id: req.params.id } });
    if (!appointment) throw new HttpError(404, "Appointment not found");
    await assertDoctorAccess(req.auth!, appointment.doctorId);
    assertTransition(appointment.status, "COMPLETED");

    await prisma.appointment.update({
      where: { id: appointment.id },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
    await publishQueueUpdate(appointment.doctorId, { type: "COMPLETED", appointmentId: appointment.id });
    await writeAuditLog({
      actorUserId: req.auth!.userId,
      action: "APPOINTMENT_COMPLETED",
      targetType: "Appointment",
      targetId: appointment.id,
    });

    res.json({ ok: true });
  })
);

queueRouter.post(
  "/appointments/:id/no-show",
  requireAuth,
  requireRole("DOCTOR", "ASSOCIATE"),
  asyncHandler(async (req, res) => {
    const appointment = await prisma.appointment.findUnique({ where: { id: req.params.id } });
    if (!appointment) throw new HttpError(404, "Appointment not found");
    await assertDoctorAccess(req.auth!, appointment.doctorId);
    assertTransition(appointment.status, "NO_SHOW");

    await prisma.appointment.update({ where: { id: appointment.id }, data: { status: "NO_SHOW" } });
    await publishQueueUpdate(appointment.doctorId, { type: "NO_SHOW", appointmentId: appointment.id });
    await writeAuditLog({
      actorUserId: req.auth!.userId,
      action: "APPOINTMENT_NO_SHOW",
      targetType: "Appointment",
      targetId: appointment.id,
    });

    res.json({ ok: true });
  })
);

queueRouter.post(
  "/doctors/:id/queue/pause",
  requireAuth,
  requireRole("DOCTOR", "ASSOCIATE"),
  asyncHandler(async (req, res) => {
    const doctorId = await resolveDoctorScope(req.auth!, req.params.id);
    const { status } = pauseQueueSchema.parse(req.body);
    const date = todayKey();

    await prisma.clinicDay.upsert({
      where: { doctorId_date: { doctorId, date } },
      create: { doctorId, date, status },
      update: { status },
    });
    await publishQueueUpdate(doctorId, { type: "QUEUE_STATUS", status });
    res.json({ ok: true, status });
  })
);
