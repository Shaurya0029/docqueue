import { Router } from "express";
import { prisma } from "../lib/prisma";
import { asyncHandler, HttpError } from "../middleware/errorHandler";
import { requireAuth, requireRole } from "../middleware/auth";
import { familyMemberSchema, patientUpdateSchema } from "../schemas";
import { writeAuditLog } from "../lib/audit";
import { deleteFamilyMember, deletePatientAccount, exportPatientData } from "../lib/patientData";
import { addFamilyMember, listFamily, updateFamilyMember } from "../lib/family";

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

/** DPDP: download everything MEDORA holds about me. */
patientRouter.get(
  "/export",
  requireAuth,
  requireRole("PATIENT"),
  asyncHandler(async (req, res) => {
    const data = await exportPatientData(req.auth!.profileId, req.auth!.userId);
    res.setHeader("Content-Disposition", `attachment; filename="medora-my-data-${new Date().toISOString().slice(0, 10)}.json"`);
    res.json(data);
  })
);

/** DPDP: erase my account. The body must be { "confirm": "DELETE" }. */
patientRouter.post(
  "/delete",
  requireAuth,
  requireRole("PATIENT"),
  asyncHandler(async (req, res) => {
    if ((req.body as { confirm?: string })?.confirm !== "DELETE") {
      throw new HttpError(400, 'Send { "confirm": "DELETE" } to delete your account');
    }
    const result = await deletePatientAccount(req.auth!.profileId, req.auth!.userId);
    res.json({ ok: true, ...result });
  })
);

/**
 * Family profiles: the account holder adds, changes and removes the family
 * members they book for. Every route is scoped to the holder in the login
 * token; another account's member is a 404.
 */
patientRouter.get(
  "/family",
  requireAuth,
  requireRole("PATIENT"),
  asyncHandler(async (req, res) => {
    res.json({ members: await listFamily(req.auth!.profileId) });
  })
);

patientRouter.post(
  "/family",
  requireAuth,
  requireRole("PATIENT"),
  asyncHandler(async (req, res) => {
    const { consent: _consent, ...input } = familyMemberSchema.parse(req.body);
    res.status(201).json({ member: await addFamilyMember(req.auth!.profileId, req.auth!.userId, input) });
  })
);

patientRouter.put(
  "/family/:id",
  requireAuth,
  requireRole("PATIENT"),
  asyncHandler(async (req, res) => {
    const { consent: _consent, ...input } = familyMemberSchema.parse(req.body);
    res.json({ member: await updateFamilyMember(req.auth!.profileId, req.auth!.userId, req.params.id, input) });
  })
);

/** DPDP: erase one family member's data. The body must be { "confirm": "DELETE" }. */
patientRouter.post(
  "/family/:id/delete",
  requireAuth,
  requireRole("PATIENT"),
  asyncHandler(async (req, res) => {
    if ((req.body as { confirm?: string })?.confirm !== "DELETE") {
      throw new HttpError(400, 'Send { "confirm": "DELETE" } to remove this family member');
    }
    const result = await deleteFamilyMember(req.auth!.profileId, req.params.id, req.auth!.userId);
    res.json({ ok: true, ...result });
  })
);
