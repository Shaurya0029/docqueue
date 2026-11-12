import { Router } from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { prisma } from "../lib/prisma";
import { asyncHandler, HttpError } from "../middleware/errorHandler";
import { requireAuth, requireRole } from "../middleware/auth";
import { assertClinicAccess } from "../lib/scope";
import {
  clinicCreateSchema,
  clinicUpdateSchema,
  createDoctorSchema,
  createAssociateSchema,
  auditLogQuerySchema,
 verifyDoctorSchema,
} from "../schemas";
import { writeAuditLog } from "../lib/audit";

export const adminRouter = Router();

adminRouter.get(
  "/clinics",
  requireAuth,
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const clinics = await prisma.clinic.findMany({ where: { adminId: req.auth!.profileId } });
    res.json({ clinics });
  })
);

adminRouter.post(
  "/clinics",
  requireAuth,
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const data = clinicCreateSchema.parse(req.body);
    const clinic = await prisma.clinic.create({ data: { ...data, adminId: req.auth!.profileId } });
    await writeAuditLog({ actorUserId: req.auth!.userId, action: "CLINIC_CREATED", targetType: "Clinic", targetId: clinic.id });
    res.status(201).json({ clinic });
  })
);

adminRouter.patch(
  "/clinics/:id",
  requireAuth,
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    await assertClinicAccess(req.auth!, req.params.id);
    const data = clinicUpdateSchema.parse(req.body);
    const clinic = await prisma.clinic.update({ where: { id: req.params.id }, data });
    res.json({ clinic });
  })
);

adminRouter.get(
  "/clinics/:id/doctors",
  requireAuth,
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    await assertClinicAccess(req.auth!, req.params.id);
    const doctors = await prisma.doctor.findMany({ where: { clinicId: req.params.id } });
    res.json({ doctors });
  })
);

adminRouter.get(
  "/clinics/:id/associates",
  requireAuth,
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    await assertClinicAccess(req.auth!, req.params.id);
    const associates = await prisma.associate.findMany({
      where: { clinicId: req.params.id },
      include: { assignedDoctors: { include: { doctor: true } } },
    });
    res.json({ associates });
  })
);

function tempPassword(): string {
  return crypto.randomBytes(6).toString("hex");
}

/**
 * The clinic admin checks the doctor's registration (for example on the NMC
 * register) and approves or rejects it. Only approved doctors show the
 * verified tick to patients.
 */
adminRouter.post(
  "/admin/doctors/:id/verification",
  requireAuth,
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const body = verifyDoctorSchema.parse(req.body);
    const doctor = await prisma.doctor.findUnique({ where: { id: req.params.id } });
    if (!doctor) throw new HttpError(404, "Doctor not found");
    await assertClinicAccess(req.auth!, doctor.clinicId);
    if (body.decision === "APPROVE" && (!doctor.registrationNumber || !doctor.registrationCouncil)) {
      throw new HttpError(409, "Add the registration number and council before approving");
    }
    const updated = await prisma.doctor.update({
      where: { id: doctor.id },
      data:
        body.decision === "APPROVE"
          ? { verificationStatus: "APPROVED", verifiedAt: new Date(), verifiedByUserId: req.auth!.userId, rejectionReason: null }
          : { verificationStatus: "REJECTED", verifiedAt: null, verifiedByUserId: req.auth!.userId, rejectionReason: body.reason },
    });
    await writeAuditLog({
      actorUserId: req.auth!.userId,
      action: body.decision === "APPROVE" ? "DOCTOR_VERIFIED" : "DOCTOR_VERIFICATION_REJECTED",
      targetType: "Doctor",
      targetId: doctor.id,
      metadata: {
        registrationNumber: doctor.registrationNumber,
        registrationCouncil: doctor.registrationCouncil,
        ...(body.decision === "REJECT" ? { reason: body.reason } : {}),
      },
    });
    res.json({ doctor: updated });
  })
);

adminRouter.post(
  "/clinics/:id/doctors",
  requireAuth,
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    await assertClinicAccess(req.auth!, req.params.id);
    const data = createDoctorSchema.parse(req.body);
    const existing = await prisma.user.findUnique({ where: { phoneNumber: data.phoneNumber } });
    if (existing) throw new HttpError(409, "A user with this phone number already exists");

    const plainPassword = tempPassword();
    const passwordHash = await bcrypt.hash(plainPassword, 10);

    const user = await prisma.user.create({
      data: {
        phoneNumber: data.phoneNumber,
        passwordHash,
        role: "DOCTOR",
        doctor: {
          create: {
            clinicId: req.params.id,
            fullName: data.fullName,
            specialization: data.specialization,
            consultationFee: data.consultationFee,
            avgConsultMinutes: data.avgConsultMinutes,
            registrationNumber: data.registrationNumber,
            registrationCouncil: data.registrationCouncil,
          },
        },
      },
      include: { doctor: true },
    });

    await writeAuditLog({
      actorUserId: req.auth!.userId,
      action: "DOCTOR_CREATED",
      targetType: "Doctor",
      targetId: user.doctor!.id,
    });

    res.status(201).json({ doctor: user.doctor, loginPhone: data.phoneNumber, tempPassword: plainPassword });
  })
);

adminRouter.post(
  "/clinics/:id/associates",
  requireAuth,
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    await assertClinicAccess(req.auth!, req.params.id);
    const data = createAssociateSchema.parse(req.body);
    const existing = await prisma.user.findUnique({ where: { phoneNumber: data.phoneNumber } });
    if (existing) throw new HttpError(409, "A user with this phone number already exists");

    for (const doctorId of data.doctorIds) {
      await assertClinicAccess(req.auth!, req.params.id);
      const doctor = await prisma.doctor.findUnique({ where: { id: doctorId } });
      if (!doctor || doctor.clinicId !== req.params.id) throw new HttpError(400, `Doctor ${doctorId} not in this clinic`);
    }

    const plainPassword = tempPassword();
    const passwordHash = await bcrypt.hash(plainPassword, 10);

    const user = await prisma.user.create({
      data: {
        phoneNumber: data.phoneNumber,
        passwordHash,
        role: "ASSOCIATE",
        associate: {
          create: {
            clinicId: req.params.id,
            assignedDoctors: { create: data.doctorIds.map((doctorId) => ({ doctorId })) },
          },
        },
      },
      include: { associate: true },
    });

    await writeAuditLog({
      actorUserId: req.auth!.userId,
      action: "ASSOCIATE_CREATED",
      targetType: "Associate",
      targetId: user.associate!.id,
    });

    res.status(201).json({ associate: user.associate, loginPhone: data.phoneNumber, tempPassword: plainPassword });
  })
);

adminRouter.patch(
  "/users/:id/deactivate",
  requireAuth,
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      include: { doctor: true, associate: true },
    });
    if (!user) throw new HttpError(404, "User not found");

    const clinicId = user.doctor?.clinicId ?? user.associate?.clinicId;
    if (!clinicId) throw new HttpError(403, "Can only deactivate clinic staff");
    await assertClinicAccess(req.auth!, clinicId);

    await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });
    await writeAuditLog({ actorUserId: req.auth!.userId, action: "USER_DEACTIVATED", targetType: "User", targetId: user.id });
    res.json({ ok: true });
  })
);

adminRouter.get(
  "/admin/overview",
  requireAuth,
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const clinics = await prisma.clinic.findMany({ where: { adminId: req.auth!.profileId }, include: { doctors: true } });
    const overview = [];
    for (const clinic of clinics) {
      const doctorIds = clinic.doctors.map((d) => d.id);
      const appointments = await prisma.appointment.findMany({ where: { doctorId: { in: doctorIds } } });
      const bookings = appointments.filter((a) => a.status !== "PENDING_PAYMENT" && a.status !== "CANCELLED").length;
      const noShows = appointments.filter((a) => a.status === "NO_SHOW").length;
      const payments = await prisma.payment.findMany({ where: { status: "PAID", appointment: { doctorId: { in: doctorIds } } } });
      const revenue = payments.reduce((sum, p) => sum + p.amount, 0);
      overview.push({
        clinicId: clinic.id,
        clinicName: clinic.name,
        bookings,
        noShowRate: bookings > 0 ? noShows / bookings : 0,
        revenue,
      });
    }
    res.json({ overview });
  })
);

adminRouter.get(
  "/admin/audit-log",
  requireAuth,
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const { actorUserId, action, from, to } = auditLogQuerySchema.parse(req.query);

    // Scope to staff inside this admin's own clinics only -- never another
    // admin's clinic actions.
    const clinics = await prisma.clinic.findMany({
      where: { adminId: req.auth!.profileId },
      include: { doctors: true, associates: true },
    });
    const ownUserIds = new Set<string>([req.auth!.userId]);
    for (const clinic of clinics) {
      for (const d of clinic.doctors) ownUserIds.add(d.userId);
      for (const a of clinic.associates) ownUserIds.add(a.userId);
    }
    if (actorUserId && !ownUserIds.has(actorUserId)) throw new HttpError(403, "Actor not in your clinics");

    const logs = await prisma.auditLog.findMany({
      where: {
        actorUserId: actorUserId ?? { in: Array.from(ownUserIds) },
        action,
        createdAt: {
          gte: from ? new Date(from) : undefined,
          lte: to ? new Date(to) : undefined,
        },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    res.json({ logs });
  })
);
