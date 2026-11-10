import { Router } from "express";
import { prisma } from "../lib/prisma";
import { asyncHandler, HttpError } from "../middleware/errorHandler";
import { requireAuth, requireRole } from "../middleware/auth";
import { assertDoctorAccess } from "../lib/scope";
import { assertTransition } from "../lib/lifecycle";
import { setNowServing, publishQueueUpdate } from "../lib/queueService";
import { todayKey } from "../lib/dates";
import { pauseQueueSchema } from "../schemas";
import { writeAuditLog } from "../lib/audit";

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
    const doctorId = req.params.id;
    await assertDoctorAccess(req.auth!, doctorId);
    const date = todayKey();
    const appointments = await prisma.appointment.findMany({
      where: { doctorId, queueDate: date, status: { notIn: ["PENDING_PAYMENT", "CANCELLED"] } },
      include: { patient: true },
      orderBy: { queueToken: "asc" },
    });
    const day = await prisma.clinicDay.findUnique({ where: { doctorId_date: { doctorId, date } } });
    res.json({
      date,
      status: day?.status ?? "OPEN",
      nowServing: day?.nowServing ?? 0,
      queue: appointments.map((a) => ({
        appointmentId: a.id,
        token: a.queueToken,
        patientName: a.patient.fullName,
        status: a.status,
      })),
    });
  })
);

queueRouter.get(
  "/doctors/:id/appointments",
  requireAuth,
  requireRole("DOCTOR", "ASSOCIATE"),
  asyncHandler(async (req, res) => {
    const doctorId = req.params.id;
    await assertDoctorAccess(req.auth!, doctorId);
    const date = String(req.query.date ?? todayKey());
    const appointments = await prisma.appointment.findMany({
      where: { doctorId, queueDate: date },
      include: { patient: true, slot: true },
      orderBy: { queueToken: "asc" },
    });
    res.json({ date, appointments });
  })
);

queueRouter.post(
  "/appointments/doctor/:id/call-next",
  requireAuth,
  requireRole("DOCTOR", "ASSOCIATE"),
  asyncHandler(async (req, res) => {
    const doctorId = req.params.id;
    await assertDoctorAccess(req.auth!, doctorId);
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
    const doctorId = req.params.id;
    await assertDoctorAccess(req.auth!, doctorId);
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
