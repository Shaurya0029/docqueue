import { prisma } from "./prisma";
import { redis, nowServingKey, tokenCounterKey, publishQueueEvent } from "./redis";
import { todayKey } from "./dates";

/** Issues the next daily token for a doctor, atomically, via Redis INCR. */
export async function issueNextToken(doctorId: string, date: string): Promise<number> {
  const token = await redis.incr(tokenCounterKey(doctorId, date));
  await prisma.clinicDay.upsert({
    where: { doctorId_date: { doctorId, date } },
    create: { doctorId, date, status: "OPEN", nowServing: 0 },
    update: {},
  });
  return token;
}

export async function getNowServing(doctorId: string, date: string): Promise<number> {
  const cached = await redis.get(nowServingKey(doctorId, date));
  if (cached !== null) return Number(cached);
  const day = await prisma.clinicDay.findUnique({ where: { doctorId_date: { doctorId, date } } });
  return day?.nowServing ?? 0;
}

export async function setNowServing(doctorId: string, date: string, value: number): Promise<void> {
  await redis.set(nowServingKey(doctorId, date), value);
  await prisma.clinicDay.upsert({
    where: { doctorId_date: { doctorId, date } },
    create: { doctorId, date, status: "OPEN", nowServing: value },
    update: { nowServing: value },
  });
}

/** Rolling average of the doctor's last 20 completed consultations, in minutes. */
export async function getRollingAvgConsultMinutes(doctorId: string): Promise<number> {
  const recent = await prisma.appointment.findMany({
    where: { doctorId, status: "COMPLETED", calledAt: { not: null }, completedAt: { not: null } },
    orderBy: { completedAt: "desc" },
    take: 20,
    select: { calledAt: true, completedAt: true },
  });
  if (recent.length === 0) {
    const doctor = await prisma.doctor.findUnique({ where: { id: doctorId } });
    return doctor?.avgConsultMinutes ?? 15;
  }
  const totalMinutes = recent.reduce((sum, a) => {
    const mins = (a.completedAt!.getTime() - a.calledAt!.getTime()) / 60000;
    return sum + Math.max(mins, 1);
  }, 0);
  return totalMinutes / recent.length;
}

export async function publishQueueUpdate(doctorId: string, extra: Record<string, unknown> = {}): Promise<void> {
  const date = todayKey();
  const nowServing = await getNowServing(doctorId, date);
  await publishQueueEvent(doctorId, { type: "QUEUE_UPDATE", doctorId, date, nowServing, ...extra });
}
