import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { HttpError } from "../middleware/errorHandler";
import { addDays, formatIst, todayKey } from "./dates";
import { BOOKABLE_DOCTOR, assertDoctorBookable } from "./bookable";
import { notifyPatient } from "./notifications";
import { resolveBookingPatient } from "./family";
import { writeAuditLog } from "./audit";

/**
 * Waitlist for a fully booked day.
 *
 * Every place that frees a slot (patient or clinic cancellation, an expired
 * payment hold, a reschedule, an account deletion) calls releaseSlot inside
 * its own transaction. If the slot can be offered, the first person waiting
 * for that doctor and day (join order) gets it held for OFFER_MINUTES and
 * the slot stays marked booked, so nobody else can book it meanwhile.
 * Otherwise it goes back to open.
 *
 * - A person has at most one pending offer at a time (entry WAITING -> OFFERED
 *   is a conditional update) and is offered a given slot at most once
 *   (unique entry+slot), so they get at most one offer SMS per slot.
 * - A slot has at most one pending offer (partial unique index).
 * - Claiming is one conditional update (PENDING and not expired -> CLAIMED);
 *   it creates a normal booking awaiting payment with the usual 10-minute
 *   payment hold. Nothing is free and payment is never skipped.
 * - An offer that expires, is declined or withdrawn passes to the next person.
 */
export const OFFER_MINUTES = 10;
/** Never offer a slot that starts this soon: there would be no time to claim, pay and travel. */
export const MIN_LEAD_MINUTES = 30;
/** How far ahead a patient can join a waitlist. */
export const WAITLIST_DAYS_AHEAD = 30;

const LIVE: Prisma.EnumWaitlistStatusFilter = { in: ["WAITING", "OFFERED"] };
type Tx = Prisma.TransactionClient;

/**
 * A slot was just given up. Offer it to the next person waiting, or open it.
 * Call inside the transaction that released it; then call announceOffer
 * with the result once that transaction has committed.
 */
export async function releaseSlot(tx: Tx, slotId: string, now = new Date()): Promise<string | null> {
  const slot = await tx.slot.findUniqueOrThrow({ where: { id: slotId } });
  const bookable = (await tx.doctor.count({ where: { id: slot.doctorId, ...BOOKABLE_DOCTOR } })) > 0;
  const enoughLead = slot.startsAt.getTime() - now.getTime() > MIN_LEAD_MINUTES * 60_000;
  if (bookable && enoughLead) {
    const waiting = await tx.waitlistEntry.findMany({
      where: {
        doctorId: slot.doctorId,
        date: slot.slotDate,
        status: "WAITING",
        patient: { deletedAt: null },
        offers: { none: { slotId } }, // never the same slot twice
      },
      orderBy: { createdAt: "asc" },
      take: 10,
      select: { id: true },
    });
    for (const entry of waiting) {
      // Conditional: someone else's release may be offering this person another slot right now.
      const taken = await tx.waitlistEntry.updateMany({ where: { id: entry.id, status: "WAITING" }, data: { status: "OFFERED" } });
      if (taken.count === 0) continue;
      const offer = await tx.waitlistOffer.create({
        data: { entryId: entry.id, slotId, offeredAt: now, expiresAt: new Date(now.getTime() + OFFER_MINUTES * 60_000) },
      });
      await tx.slot.update({ where: { id: slotId }, data: { isBooked: true } }); // held for the offer
      return offer.id;
    }
  }
  await tx.slot.update({ where: { id: slotId }, data: { isBooked: false } });
  return null;
}

/** Texts a new offer to the person (their account holder for a family member), once per person per slot. */
export async function announceOffer(offerId: string | null): Promise<void> {
  if (!offerId) return;
  const offer = await prisma.waitlistOffer.findUniqueOrThrow({
    where: { id: offerId },
    include: { slot: true, entry: { include: { doctor: true } } },
  });
  await notifyPatient({
    patientId: offer.entry.patientId,
    type: "WAITLIST_OFFER",
    dedupeKey: `waitlist-offer:${offer.entryId}:${offer.slotId}`,
    message: (w) =>
      `A slot opened${w.forName} with ${offer.entry.doctor.fullName} at ${formatIst(offer.slot.startsAt)}. It is held for ${OFFER_MINUTES} minutes: open MEDORA > Bookings > Waitlist to claim it and pay.`,
  });
}

/**
 * Ends a pending offer without a booking and passes the slot on. DECLINED and
 * EXPIRED put the person back in line (for other slots); WITHDRAWN is used when
 * they leave the waitlist.
 */
async function endOffer(offerId: string, outcome: "DECLINED" | "EXPIRED" | "WITHDRAWN", now = new Date()): Promise<boolean> {
  let next: string | null = null;
  const ended = await prisma.$transaction(async (tx) => {
    const offer = await tx.waitlistOffer.findUniqueOrThrow({ where: { id: offerId } });
    const done = await tx.waitlistOffer.updateMany({ where: { id: offerId, status: "PENDING" }, data: { status: outcome, respondedAt: now } });
    if (done.count === 0) return false;
    if (outcome !== "WITHDRAWN") {
      await tx.waitlistEntry.updateMany({ where: { id: offer.entryId, status: "OFFERED" }, data: { status: "WAITING" } });
    }
    next = await releaseSlot(tx, offer.slotId, now);
    return true;
  });
  await announceOffer(next);
  return ended;
}

/** Every minute: expire offers not claimed in time, passing each slot to the next person. */
export async function expireOffers(now = new Date()): Promise<number> {
  const due = await prisma.waitlistOffer.findMany({ where: { status: "PENDING", expiresAt: { lte: now } }, select: { id: true } });
  let expired = 0;
  for (const o of due) if (await endOffer(o.id, "EXPIRED", now)) expired += 1;
  return expired;
}

/** Live entries for days that have passed are closed; called by the daily close job. */
export async function expirePastEntries(today = todayKey()): Promise<number> {
  const past = await prisma.waitlistEntry.findMany({ where: { status: LIVE, date: { lt: today } }, select: { id: true } });
  if (past.length === 0) return 0;
  const ids = past.map((e) => e.id);
  await prisma.$transaction([
    prisma.waitlistOffer.updateMany({ where: { entryId: { in: ids }, status: "PENDING" }, data: { status: "EXPIRED", respondedAt: new Date() } }),
    prisma.waitlistEntry.updateMany({ where: { id: { in: ids }, status: LIVE }, data: { status: "EXPIRED", endedAt: new Date() } }),
  ]);
  return ids.length;
}

/** The waitlist entry's patient is the account holder or one of their family members. */
const ownedEntry = (holderId: string): Prisma.WaitlistEntryWhereInput => ({
  OR: [{ patientId: holderId }, { patient: { accountHolderId: holderId } }],
});

/** Days in the coming weeks when the doctor has slots but none free: those can be waitlisted. */
export async function fullyBookedDays(doctorId: string, now = new Date()): Promise<string[]> {
  const today = todayKey();
  const until = addDays(today, WAITLIST_DAYS_AHEAD);
  const soonest = new Date(now.getTime() + MIN_LEAD_MINUTES * 60_000);
  const slots = await prisma.slot.findMany({
    where: { doctorId, slotDate: { gte: today, lte: until }, startsAt: { gt: soonest } },
    select: { slotDate: true, isBooked: true },
  });
  const days = new Map<string, boolean>(); // date -> has a free slot
  for (const s of slots) days.set(s.slotDate, (days.get(s.slotDate) ?? false) || !s.isBooked);
  return [...days.entries()].filter(([, free]) => !free).map(([d]) => d).sort();
}

export async function joinWaitlist(params: { holderId: string; doctorId: string; date: string; patientId?: string }) {
  const patientId = await resolveBookingPatient(params.holderId, params.patientId);
  await assertDoctorBookable(params.doctorId);
  if (!(await fullyBookedDays(params.doctorId)).includes(params.date)) {
    throw new HttpError(409, "You can join the waitlist only for a day that is fully booked. Book a free slot instead.");
  }
  try {
    return await prisma.waitlistEntry.create({ data: { patientId, doctorId: params.doctorId, date: params.date } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new HttpError(409, "Already on the waitlist for this doctor and day");
    }
    throw err;
  }
}

export async function leaveWaitlist(holderId: string, entryId: string): Promise<void> {
  const entry = await prisma.waitlistEntry.findFirst({ where: { id: entryId, ...ownedEntry(holderId) }, include: { offers: { where: { status: "PENDING" } } } });
  if (!entry) throw new HttpError(404, "Waitlist entry not found");
  await withdrawEntry(entry.id);
}

/** Takes an entry off the waitlist; a pending offer passes to the next person. Used when leaving and on deletion. */
export async function withdrawEntry(entryId: string): Promise<void> {
  const left = await prisma.waitlistEntry.updateMany({ where: { id: entryId, status: LIVE }, data: { status: "LEFT", endedAt: new Date() } });
  if (left.count === 0) return;
  const pending = await prisma.waitlistOffer.findMany({ where: { entryId, status: "PENDING" }, select: { id: true } });
  for (const o of pending) await endOffer(o.id, "WITHDRAWN");
}

async function ownedOffer(holderId: string, offerId: string) {
  const offer = await prisma.waitlistOffer.findFirst({ where: { id: offerId, entry: ownedEntry(holderId) }, include: { entry: true, slot: true } });
  if (!offer) throw new HttpError(404, "Offer not found");
  return offer;
}

export async function declineOffer(holderId: string, offerId: string): Promise<void> {
  await ownedOffer(holderId, offerId);
  if (!(await endOffer(offerId, "DECLINED"))) throw new HttpError(409, "This offer has already ended");
}

/**
 * Claims an offered slot: one conditional update, so it succeeds at most once
 * and only before the offer expires. Creates a booking awaiting payment; the
 * patient then pays through the normal flow (10-minute payment hold).
 */
export async function claimOffer(holderId: string, actorUserId: string, offerId: string) {
  const offer = await ownedOffer(holderId, offerId);
  const doctorOk = (await prisma.doctor.count({ where: { id: offer.entry.doctorId, ...BOOKABLE_DOCTOR } })) > 0;
  if (!doctorOk) {
    await endOffer(offerId, "WITHDRAWN");
    throw new HttpError(409, "This doctor is not taking bookings right now");
  }
  const now = new Date();
  const appointment = await prisma.$transaction(async (tx) => {
    const claimed = await tx.waitlistOffer.updateMany({
      where: { id: offerId, status: "PENDING", expiresAt: { gt: now } },
      data: { status: "CLAIMED", respondedAt: now },
    });
    if (claimed.count === 0) throw new HttpError(409, "This offer has expired or was already used");
    // The slot has been held (isBooked) for this offer since it was made.
    const created = await tx.appointment.create({
      data: { patientId: offer.entry.patientId, doctorId: offer.entry.doctorId, slotId: offer.slotId, status: "PENDING_PAYMENT" },
    });
    await tx.waitlistOffer.update({ where: { id: offerId }, data: { appointmentId: created.id } });
    await tx.waitlistEntry.update({ where: { id: offer.entryId }, data: { status: "CLAIMED", endedAt: now } });
    return created;
  });
  await writeAuditLog({ actorUserId, action: "WAITLIST_OFFER_CLAIMED", targetType: "Appointment", targetId: appointment.id, metadata: { offerId } });
  return appointment;
}

/** The account holder's live waitlist entries (theirs and their family's), with any pending offer. */
export async function myWaitlist(holderId: string) {
  const entries = await prisma.waitlistEntry.findMany({
    where: { ...ownedEntry(holderId), status: LIVE, date: { gte: todayKey() } },
    orderBy: { createdAt: "asc" },
    include: {
      doctor: { select: { id: true, fullName: true, specialization: true } },
      patient: { select: { id: true, fullName: true, accountHolderId: true } },
      offers: { where: { status: "PENDING" }, include: { slot: { select: { startsAt: true } } } },
    },
  });
  return Promise.all(
    entries.map(async (e) => {
      const ahead = await prisma.waitlistEntry.count({
        where: { doctorId: e.doctorId, date: e.date, status: LIVE, createdAt: { lt: e.createdAt } },
      });
      const offer = e.offers[0];
      return {
        id: e.id,
        date: e.date,
        status: e.status,
        joinedAt: e.createdAt,
        position: ahead + 1,
        doctor: e.doctor,
        patient: e.patient,
        offer: offer ? { id: offer.id, slotStartsAt: offer.slot.startsAt, expiresAt: offer.expiresAt } : null,
      };
    })
  );
}

/** Staff see only how many are waiting: never who. */
export async function waitingCount(doctorId: string, date: string): Promise<number> {
  return prisma.waitlistEntry.count({ where: { doctorId, date, status: LIVE } });
}

/** For the DPDP export: one patient's entries and offers. */
export async function waitlistForExport(patientId: string) {
  const entries = await prisma.waitlistEntry.findMany({
    where: { patientId },
    orderBy: { createdAt: "asc" },
    include: { doctor: { select: { fullName: true } }, offers: { include: { slot: { select: { startsAt: true } } }, orderBy: { offeredAt: "asc" } } },
  });
  return entries.map((e) => ({
    doctor: e.doctor.fullName,
    date: e.date,
    status: e.status,
    joinedAt: e.createdAt,
    endedAt: e.endedAt,
    offers: e.offers.map((o) => ({ slotStartsAt: o.slot.startsAt, status: o.status, offeredAt: o.offeredAt, expiresAt: o.expiresAt, respondedAt: o.respondedAt })),
  }));
}

/** For DPDP erasure: leave every waitlist (pending offers pass on), then delete the records. */
export async function eraseWaitlist(patientId: string): Promise<void> {
  const live = await prisma.waitlistEntry.findMany({ where: { patientId, status: LIVE }, select: { id: true } });
  for (const e of live) await withdrawEntry(e.id);
  await prisma.$transaction([
    prisma.waitlistOffer.deleteMany({ where: { entry: { patientId } } }),
    prisma.waitlistEntry.deleteMany({ where: { patientId } }),
  ]);
}
