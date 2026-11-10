import { Router } from "express";
import { prisma } from "../lib/prisma";
import { asyncHandler, HttpError } from "../middleware/errorHandler";
import { requireAuth, requireRole } from "../middleware/auth";
import { patientUpdateSchema } from "../schemas";
import { writeAuditLog } from "../lib/audit";

export const patientRouter = Router();

patientRouter.patch(
  "/",
  requireAuth,
  requireRole("PATIENT"),
  asyncHandler(async (req, res) => {
    const data = patientUpdateSchema.parse(req.body);
    const patient = await prisma.patient.update({ where: { id: req.auth!.profileId }, data });
    res.json(patient);
  })
);

patientRouter.post(
  "/id-document",
  requireAuth,
  requireRole("PATIENT"),
  asyncHandler(async (req, res) => {
    // MVP stub: in production this streams to encrypted object storage and
    // stores only a reference + masked last-4, never the raw document number.
    const { idDocumentRef } = req.body as { idDocumentRef?: string };
    if (!idDocumentRef) throw new HttpError(400, "idDocumentRef required");
    const masked = `****${idDocumentRef.slice(-4)}`;
    await prisma.patient.update({ where: { id: req.auth!.profileId }, data: { idDocumentRef: masked } });
    await writeAuditLog({
      actorUserId: req.auth!.userId,
      action: "PATIENT_ID_DOCUMENT_UPLOADED",
      targetType: "Patient",
      targetId: req.auth!.profileId,
    });
    res.json({ ok: true, idDocumentRef: masked });
  })
);
