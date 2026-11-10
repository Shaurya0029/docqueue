import { Router } from "express";
import { prisma } from "../lib/prisma";
import { asyncHandler, HttpError } from "../middleware/errorHandler";
import { doctorSearchSchema } from "../schemas";
import { cityAliases } from "../lib/cityAliases";

export const doctorsRouter = Router();

doctorsRouter.get(
  "/search",
  asyncHandler(async (req, res) => {
    const { name, specialization, city } = doctorSearchSchema.parse(req.query);
    const doctors = await prisma.doctor.findMany({
      where: {
        isActive: true,
        fullName: name ? { contains: name, mode: "insensitive" } : undefined,
        specialization: specialization ? { contains: specialization, mode: "insensitive" } : undefined,
        clinic: city ? { OR: cityAliases(city).map((c) => ({ address: { contains: c, mode: "insensitive" as const } })) } : undefined,
      },
      include: {
        clinic: true,
        slots: { where: { isBooked: false, startsAt: { gte: new Date() } }, orderBy: { startsAt: "asc" }, take: 1 },
      },
    });
    res.json({
      doctors: doctors.map((d) => ({
        id: d.id,
        fullName: d.fullName,
        specialization: d.specialization,
        consultationFee: d.consultationFee,
        clinic: { id: d.clinic.id, name: d.clinic.name, address: d.clinic.address },
        nextSlot: d.slots[0] ?? null,
      })),
    });
  })
);

doctorsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const doctor = await prisma.doctor.findUnique({
      where: { id: req.params.id },
      include: {
        clinic: true,
        slots: { where: { isBooked: false, startsAt: { gte: new Date() } }, orderBy: { startsAt: "asc" } },
      },
    });
    if (!doctor || !doctor.isActive) throw new HttpError(404, "Doctor not found");
    res.json({
      id: doctor.id,
      fullName: doctor.fullName,
      specialization: doctor.specialization,
      consultationFee: doctor.consultationFee,
      avgConsultMinutes: doctor.avgConsultMinutes,
      bio: doctor.bio,
      clinic: { id: doctor.clinic.id, name: doctor.clinic.name, address: doctor.clinic.address },
      slots: doctor.slots,
    });
  })
);
