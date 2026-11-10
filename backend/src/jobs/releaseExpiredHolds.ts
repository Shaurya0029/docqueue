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

  let released = 0;
  for (const appointment of expired) {
    await prisma.$transaction(async (tx) => {
      // Conditional: if the payment webhook confirmed this booking a moment
      // ago, the status is no longer PENDING_PAYMENT and nothing is released.
      const cancelled = await tx.appointment.updateMany({
        where: { id: appointment.id, status: "PENDING_PAYMENT" },
        data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: "Payment window expired" },
      });
      if (cancelled.count === 1) {
        await tx.slot.update({ where: { id: appointment.slotId }, data: { isBooked: false } });
        released += 1;
      }
    });
  }

  return released;
}

export function startSlotHoldExpiryJob(intervalMs = 60_000): NodeJS.Timeout {
  return setInterval(() => {
    releaseExpiredHolds().catch((err) => console.error("releaseExpiredHolds failed", err));
  }, intervalMs);
}
