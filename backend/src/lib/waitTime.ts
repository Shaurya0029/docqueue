import { prisma } from "./prisma";
import { getNowServing } from "./queueService";

/**
 * Wait-time estimate: patients ahead x the doctor's average consultation.
 *
 * The average comes from the doctor's last 20 *real* consultations: called
 * and then completed, lasting 1 to 120 minutes. Shorter is a mis-tap on
 * "Complete"; longer is a consultation nobody closed until much later.
 * With fewer than 5 real consultations the doctor's configured average is
 * used instead, since a handful of visits is too noisy to predict from.
 */
export const HISTORY_SIZE = 20;
export const MIN_HISTORY = 5;
export const MIN_REAL_MINUTES = 1;
export const MAX_REAL_MINUTES = 120;

export interface ConsultAverage {
  minutes: number;
  basis: "history" | "configured";
  /** Real consultations found (up to HISTORY_SIZE). */
  sampleSize: number;
}

export async function averageConsultMinutes(doctorId: string): Promise<ConsultAverage> {
  // Look a little further back so a few discarded outliers do not shrink the sample.
  const recent = await prisma.appointment.findMany({
    where: { doctorId, status: "COMPLETED", calledAt: { not: null }, completedAt: { not: null } },
    orderBy: { completedAt: "desc" },
    take: HISTORY_SIZE * 3,
    select: { calledAt: true, completedAt: true },
  });
  const durations = recent
    .map((a) => (a.completedAt!.getTime() - a.calledAt!.getTime()) / 60_000)
    .filter((m) => m >= MIN_REAL_MINUTES && m <= MAX_REAL_MINUTES)
    .slice(0, HISTORY_SIZE);

  if (durations.length < MIN_HISTORY) {
    const doctor = await prisma.doctor.findUnique({ where: { id: doctorId }, select: { avgConsultMinutes: true } });
    return { minutes: doctor?.avgConsultMinutes ?? 15, basis: "configured", sampleSize: durations.length };
  }
  const mean = durations.reduce((sum, m) => sum + m, 0) / durations.length;
  return { minutes: Math.round(mean * 10) / 10, basis: "history", sampleSize: durations.length };
}

export interface WaitEstimate {
  nowServing: number;
  /** Booked or checked-in patients with an earlier token who have not been called yet. */
  patientsAhead: number;
  averageMinutes: number;
  basis: ConsultAverage["basis"];
  sampleSize: number;
  estimatedWaitMinutes: number;
}

export async function estimateWait(appointment: {
  doctorId: string;
  queueDate: string;
  queueToken: number;
}): Promise<WaitEstimate> {
  const nowServing = await getNowServing(appointment.doctorId, appointment.queueDate);
  // Tokens are slot positions, so gaps (empty or cancelled slots) are skipped:
  // count real patients still waiting ahead, not the token difference.
  const patientsAhead = await prisma.appointment.count({
    where: {
      doctorId: appointment.doctorId,
      queueDate: appointment.queueDate,
      status: { in: ["BOOKED", "CHECKED_IN"] },
      queueToken: { lt: appointment.queueToken, gt: nowServing },
    },
  });
  const average = await averageConsultMinutes(appointment.doctorId);
  return {
    nowServing,
    patientsAhead,
    averageMinutes: average.minutes,
    basis: average.basis,
    sampleSize: average.sampleSize,
    estimatedWaitMinutes: Math.round(patientsAhead * average.minutes),
  };
}
