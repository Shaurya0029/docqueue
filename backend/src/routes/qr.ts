import { Router } from "express";
import { prisma } from "../lib/prisma";
import { asyncHandler, HttpError } from "../middleware/errorHandler";
import { requireAuth, requireRole } from "../middleware/auth";
import { qrScanSchema } from "../schemas";
import { normalizeShortCode, verifyQrToken } from "../lib/qr";
import { assertDoctorAccess } from "../lib/scope";
import { assertTransition } from "../lib/lifecycle";
import { publishQueueUpdate } from "../lib/queueService";
import { writeAuditLog } from "../lib/audit";

export const qrRouter = Router();

qrRouter.post(
  "/scan",
  requireAuth,
  requireRole("ASSOCIATE"),
  asyncHandler(async (req, res) => {
    const body = qrScanSchema.parse(req.body);
    let qrRecord;
    if (body.token) {
      if (!verifyQrToken(body.token)) throw new HttpError(400, "Invalid QR code");
      qrRecord = await prisma.qrToken.findUnique({ where: { token: body.token } });
    } else {
      qrRecord = await prisma.qrToken.findUnique({ where: { shortCode: normalizeShortCode(body.code!) } });
    }
    if (!qrRecord) throw new HttpError(400, "Invalid QR code");
    if (qrRecord.usedAt) throw new HttpError(409, "QR code already used");
    if (qrRecord.expiresAt.getTime() < Date.now()) throw new HttpError(409, "QR code expired");
    const token = qrRecord.token;

    const appointment = await prisma.appointment.findUnique({
      where: { id: qrRecord.appointmentId },
      include: { patient: true, payment: true },
    });
    if (!appointment) throw new HttpError(404, "Appointment not found");

    await assertDoctorAccess(req.auth!, appointment.doctorId);
    assertTransition(appointment.status, "CHECKED_IN");

    await prisma.$transaction(async (tx) => {
      await tx.qrToken.update({ where: { token }, data: { usedAt: new Date() } });
      await tx.appointment.update({
        where: { id: appointment.id },
        data: { status: "CHECKED_IN", checkedInAt: new Date() },
      });
    });

    await publishQueueUpdate(appointment.doctorId, { type: "CHECKED_IN", appointmentId: appointment.id, token: appointment.queueToken });
    await writeAuditLog({
      actorUserId: req.auth!.userId,
      action: "QR_SCANNED_CHECK_IN",
      targetType: "Appointment",
      targetId: appointment.id,
    });

    // Only what the associate needs to decide check-in: never full history.
    res.json({
      name: appointment.patient.fullName,
      queueToken: appointment.queueToken,
      paymentStatus: appointment.payment?.status ?? "UNKNOWN",
    });
  })
);
