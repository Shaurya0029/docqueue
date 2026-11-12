import { prisma } from "../lib/prisma";
import { todayKey } from "../lib/dates";

/**
 * Closes every queue day before today (IST):
 * - a paid booking whose patient never checked in becomes NO_SHOW, so old
 *   tickets stop saying "Booked" and no-show history is complete;
 * - the doctor's ClinicDay is marked CLOSED.
 * Checked-in or in-consultation leftovers are kept as they are for the
 * clinic to resolve, since the patient did arrive.
 *
 * Tokens need no reset: a token is the slot's position within its own day,
 * so every day starts again at 1 by construction.
 */
export async function closePastDays(): Promise<{ noShows: number; daysClosed: number }> {
  const today = todayKey();
  const noShows = await prisma.appointment.updateMany({
    where: { status: "BOOKED", queueDate: { lt: today } },
    data: { status: "NO_SHOW" },
  });
  const daysClosed = await prisma.clinicDay.updateMany({
    where: { date: { lt: today }, status: { not: "CLOSED" } },
    data: { status: "CLOSED" },
  });
  return { noShows: noShows.count, daysClosed: daysClosed.count };
}

export function startCloseDaysJob(intervalMs = 15 * 60_000): NodeJS.Timeout {
  const run = () => closePastDays().catch((err) => console.error("close-past-days job failed", err));
  void run();
  return setInterval(run, intervalMs);
}
