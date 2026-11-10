import { Router } from "express";
import { prisma } from "../lib/prisma";
import { asyncHandler, HttpError } from "../middleware/errorHandler";
import { requireAuth, requireRole } from "../middleware/auth";
import { assertDoctorAccess } from "../lib/scope";
import { toDateKey } from "../lib/dates";
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
      const from = new Date(`${fromDate}T00:00:00.000Z`);
      const to = new Date(`${toDate}T00:00:00.000Z`);
      const toCreate: { doctorId: string; startsAt: Date; endsAt: Date; slotDate: string }[] = [];

      for (let d = new Date(from); d <= to; d.setUTCDate(d.getUTCDate() + 1)) {
        const weekday = d.getUTCDay();
        const dayPatterns = pattern.filter((p) => p.weekday === weekday);
        for (const p of dayPatterns) {
          const dateKey = toDateKey(d);
          const [startH, startM] = p.startTime.split(":").map(Number);
          const [endH, endM] = p.endTime.split(":").map(Number);
          let cursor = new Date(d);
          cursor.setUTCHours(startH, startM, 0, 0);
          const dayEnd = new Date(d);
          dayEnd.setUTCHours(endH, endM, 0, 0);
          while (cursor.getTime() + p.slotMinutes * 60000 <= dayEnd.getTime()) {
            const slotEnd = new Date(cursor.getTime() + p.slotMinutes * 60000);
            toCreate.push({ doctorId, startsAt: new Date(cursor), endsAt: slotEnd, slotDate: dateKey });
            cursor = slotEnd;
          }
        }
      }

      const created = await prisma.slot.createMany({ data: toCreate });
      res.status(201).json({ created: created.count });
      return;
    }

    const { startsAt, endsAt } = slotCreateSchema.parse(req.body);
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
