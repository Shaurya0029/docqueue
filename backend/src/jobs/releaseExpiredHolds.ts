import { prisma } from "../lib/prisma";
import { announceOffer, expireOffers, releaseSlot } from "../lib/waitlist";

const HOLD_MINUTES = 10;
/** cancelReason of a hold that expired unpaid; only these may be revived by a late payment. */
export const HOLD_EXPIRED_REASON = "Payment window expired";

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
    let offer: string | null = null;
    await prisma.$transaction(async (tx) => {
      // Conditional: if the payment webhook confirmed this booking a moment
      // ago, the status is no longer PENDING_PAYMENT and nothing is released.
      const cancelled = await tx.appointment.updateMany({
        where: { id: appointment.id, status: "PENDING_PAYMENT" },
        data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: HOLD_EXPIRED_REASON },
      });
      if (cancelled.count === 1) {
        offer = await releaseSlot(tx, appointment.slotId); // waitlist first, else open
        released += 1;
      }
    });
    await announceOffer(offer);
  }

  return released;
}

export function startSlotHoldExpiryJob(intervalMs = 60_000): NodeJS.Timeout {
  return setInterval(() => {
    releaseExpiredHolds().catch((err) => console.error("releaseExpiredHolds failed", err));
    expireOffers().catch((err) => console.error("waitlist offer expiry failed", err));
  }, intervalMs);
}
