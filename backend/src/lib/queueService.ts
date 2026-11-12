import { prisma } from "./prisma";
import type { Prisma } from "@prisma/client";
import { redis, nowServingKey, publishQueueEvent } from "./redis";
import { HttpError } from "../middleware/errorHandler";
import { todayKey } from "./dates";

/**
 * Tokens follow slot time: a patient's token is their slot's position in the
 * doctor's IST day (10:00 = 1, 10:15 = 2, ...). It is stable because slot
 * changes that would renumber a day with issued tokens are refused (see
 * assertDayNotRenumbered), and it resets every day by construction.
 */
export async function tokenForSlot(
  db: Prisma.TransactionClient | typeof prisma,
  slot: { doctorId: string; slotDate: string; startsAt: Date }
): Promise<number> {
  const earlier = await db.slot.count({
    where: { doctorId: slot.doctorId, slotDate: slot.slotDate, startsAt: { lt: slot.startsAt } },
  });
  return earlier + 1;
}

/**
 * Adding, moving or removing a slot earlier in a day than an already-issued
 * token would shift every later slot's position, and so its token. Refuse it.
 */
export async function assertDayNotRenumbered(doctorId: string, slotDate: string, startsAt: Date): Promise<void> {
  const laterIssued = await prisma.appointment.findFirst({
    where: {
      doctorId,
      queueDate: slotDate,
      queueToken: { not: null },
      status: { not: "CANCELLED" },
      slot: { startsAt: { gte: startsAt } },
    },
    select: { id: true },
  });
  if (laterIssued) {
    throw new HttpError(409, "Patients already hold tokens after this time on this day; change slots after the last booked one");
  }
}

export async function ensureClinicDay(doctorId: string, date: string): Promise<void> {
  await prisma.clinicDay.upsert({
    where: { doctorId_date: { doctorId, date } },
    create: { doctorId, date, status: "OPEN", nowServing: 0 },
    update: {},
  });
}

export async function getNowServing(doctorId: string, date: string): Promise<number> {
  const cached = await redis.get(nowServingKey(doctorId, date));
  if (cached !== null) return Number(cached);
  const day = await prisma.clinicDay.findUnique({ where: { doctorId_date: { doctorId, date } } });
  return day?.nowServing ?? 0;
}

export async function setNowServing(doctorId: string, date: string, value: number): Promise<void> {
  // Expires after two days: the key is only read for its own day.
  await redis.set(nowServingKey(doctorId, date), value, "EX", 2 * 24 * 3600);
  await prisma.clinicDay.upsert({
    where: { doctorId_date: { doctorId, date } },
    create: { doctorId, date, status: "OPEN", nowServing: value },
    update: { nowServing: value },
  });
}

export async function publishQueueUpdate(doctorId: string, extra: Record<string, unknown> = {}): Promise<void> {
  const date = todayKey();
  const nowServing = await getNowServing(doctorId, date);
  await publishQueueEvent(doctorId, { type: "QUEUE_UPDATE", doctorId, date, nowServing, ...extra });
  // Imported lazily: notifications.ts imports this module too.
  const { notifyThirdInLine } = await import("./notifications");
  await notifyThirdInLine(doctorId).catch((err) => console.error("third-in-line notification failed", err));
  const { evaluateLeaveAlerts } = await import("./leaveNow");
  await evaluateLeaveAlerts({ doctorId }).catch((err) => console.error("leave-now check failed", err));
}
