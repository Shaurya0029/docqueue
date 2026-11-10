import { prisma } from "../lib/prisma";

const HOLD_MINUTES = 10;

/**
 * A booked slot with no payment within 10 minutes is released so an
 * abandoned checkout never blocks a doctor's day (PRD section 7).
 */
export async function releaseExpiredHolds(): Promise<number> {
  const cutoff = new Date(Date.now() - HOLD_MINUTES * 60 * 1000);
  const expired = await prisma.appointment.findMany({
    where: { status: "PENDING_PAYMENT", createdAt: { lt: cutoff } },
    select: { id: true, slotId: true },
  });

  for (const appointment of expired) {
    await prisma.$transaction([
      prisma.appointment.update({
        where: { id: appointment.id },
        data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: "Payment window expired" },
      }),
      prisma.slot.update({ where: { id: appointment.slotId }, data: { isBooked: false } }),
    ]);
  }

  return expired.length;
}

export function startSlotHoldExpiryJob(intervalMs = 60_000): NodeJS.Timeout {
  return setInterval(() => {
    releaseExpiredHolds().catch((err) => console.error("releaseExpiredHolds failed", err));
  }, intervalMs);
}
