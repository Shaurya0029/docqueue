import { Router } from "express";
import { prisma } from "../lib/prisma";
import { asyncHandler, HttpError } from "../middleware/errorHandler";
import { requireAuth, requireRole } from "../middleware/auth";
import { assertDoctorAccess } from "../lib/scope";
import { toDateKey } from "../lib/dates";
import { generateSlots } from "../lib/slots";
import { assertDayNotRenumbered } from "../lib/queueService";
import {
  slotCreateSchema,
  slotBulkCreateSchema,
  slotUpdateSchema,
  doctorUpdateSchema,
} from "../schemas";

export const doctorSettingsRouter = Router();

doctorSettingsRouter.get(
  "/doctors/:id/slots",
  requireAuth,
  requireRole("DOCTOR", "ADMIN"),
  asyncHandler(async (req, res) => {
    const doctorId = req.params.id;
    await assertDoctorAccess(req.auth!, doctorId);
    const slots = await prisma.slot.findMany({
      where: { doctorId, startsAt: { gte: new Date() } },
      orderBy: { startsAt: "asc" },
    });
    res.json({ slots });
  })
);

doctorSettingsRouter.post(
  "/doctors/:id/slots",
  requireAuth,
  requireRole("DOCTOR", "ADMIN"),
  asyncHandler(async (req, res) => {
    const doctorId = req.params.id;
    await assertDoctorAccess(req.auth!, doctorId);

    if (req.body && Array.isArray((req.body as { pattern?: unknown }).pattern)) {
      const { pattern, fromDate, toDate } = slotBulkCreateSchema.parse(req.body);
      // Pattern times are IST wall-clock times (see lib/dates.ts).
      const toCreate = generateSlots(doctorId, fromDate, toDate, pattern);
      const earliestPerDay = new Map<string, Date>();
      for (const s of toCreate) {
        const seen = earliestPerDay.get(s.slotDate);
        if (!seen || s.startsAt < seen) earliestPerDay.set(s.slotDate, s.startsAt);
      }
      for (const [day, startsAt] of earliestPerDay) await assertDayNotRenumbered(doctorId, day, startsAt);
      const created = await prisma.slot.createMany({ data: toCreate, skipDuplicates: true });
      res.status(201).json({ created: created.count });
      return;
    }

    const { startsAt, endsAt } = slotCreateSchema.parse(req.body);
    await assertDayNotRenumbered(doctorId, toDateKey(new Date(startsAt)), new Date(startsAt));
    const slot = await prisma.slot.create({
      data: { doctorId, startsAt: new Date(startsAt), endsAt: new Date(endsAt), slotDate: toDateKey(new Date(startsAt)) },
    });
    res.status(201).json({ slot });
  })
);

doctorSettingsRouter.patch(
  "/slots/:id",
  requireAuth,
  requireRole("DOCTOR", "ADMIN"),
  asyncHandler(async (req, res) => {
    const slot = await prisma.slot.findUnique({ where: { id: req.params.id } });
    if (!slot) throw new HttpError(404, "Slot not found");
    await assertDoctorAccess(req.auth!, slot.doctorId);
    if (slot.isBooked) throw new HttpError(409, "Cannot edit a booked slot");

    const data = slotUpdateSchema.parse(req.body);
    await assertDayNotRenumbered(slot.doctorId, slot.slotDate, slot.startsAt);
    if (data.startsAt) {
      await assertDayNotRenumbered(slot.doctorId, toDateKey(new Date(data.startsAt)), new Date(data.startsAt));
    }
    const updated = await prisma.slot.update({
      where: { id: slot.id },
      data: {
        startsAt: data.startsAt ? new Date(data.startsAt) : undefined,
        endsAt: data.endsAt ? new Date(data.endsAt) : undefined,
        slotDate: data.startsAt ? toDateKey(new Date(data.startsAt)) : undefined,
      },
    });
    res.json({ slot: updated });
  })
);

doctorSettingsRouter.delete(
  "/slots/:id",
  requireAuth,
  requireRole("DOCTOR", "ADMIN"),
  asyncHandler(async (req, res) => {
    const slot = await prisma.slot.findUnique({ where: { id: req.params.id } });
    if (!slot) throw new HttpError(404, "Slot not found");
    await assertDoctorAccess(req.auth!, slot.doctorId);
    if (slot.isBooked) throw new HttpError(409, "Cannot remove a booked slot");
    await assertDayNotRenumbered(slot.doctorId, slot.slotDate, slot.startsAt);
    // A slot with cancelled appointments is kept for their history.
    if (await prisma.appointment.count({ where: { slotId: slot.id } })) {
      throw new HttpError(409, "This slot has past bookings and cannot be removed");
    }

    await prisma.slot.delete({ where: { id: slot.id } });
    res.json({ ok: true });
  })
);

doctorSettingsRouter.patch(
  "/doctors/:id",
  requireAuth,
  requireRole("DOCTOR", "ADMIN"),
  asyncHandler(async (req, res) => {
    const doctorId = req.params.id;
    await assertDoctorAccess(req.auth!, doctorId);
    const data = doctorUpdateSchema.parse(req.body);
    const doctor = await prisma.doctor.update({ where: { id: doctorId }, data });
    res.json({ doctor });
  })
);

doctorSettingsRouter.get(
  "/doctors/:id/earnings",
  requireAuth,
  requireRole("DOCTOR", "ADMIN"),
  asyncHandler(async (req, res) => {
    const doctorId = req.params.id;
    await assertDoctorAccess(req.auth!, doctorId);

    const payments = await prisma.payment.findMany({
      where: { status: "PAID", appointment: { doctorId } },
      include: { appointment: true },
    });

    const byDay = new Map<string, number>();
    const byMonth = new Map<string, number>();
    for (const p of payments) {
      const day = toDateKey(p.createdAt);
      const month = day.slice(0, 7);
      byDay.set(day, (byDay.get(day) ?? 0) + p.amount);
      byMonth.set(month, (byMonth.get(month) ?? 0) + p.amount);
    }

    res.json({
      totalPaid: payments.reduce((sum, p) => sum + p.amount, 0),
      byDay: Object.fromEntries(byDay),
      byMonth: Object.fromEntries(byMonth),
    });
  })
);
