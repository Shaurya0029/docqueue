import { prisma } from "./prisma";
import { HttpError } from "../middleware/errorHandler";
import { formatIst } from "./dates";
import { sendNotification } from "./notifications";
import { BOOKABLE_DOCTOR } from "./bookable";

/** "Notify me when slots open": saving again re-arms an alert that already fired. */
export async function subscribeToSlots(patientId: string, doctorId: string): Promise<void> {
  const doctor = await prisma.doctor.findFirst({ where: { id: doctorId, ...BOOKABLE_DOCTOR } });
  if (!doctor) throw new HttpError(404, "Doctor not found");
  await prisma.slotAlert.upsert({
    where: { patientId_doctorId: { patientId, doctorId } },
    create: { patientId, doctorId },
    update: { notifiedAt: null, createdAt: new Date() },
  });
}

export async function unsubscribeFromSlots(patientId: string, doctorId: string): Promise<void> {
  await prisma.slotAlert.deleteMany({ where: { patientId, doctorId } });
}

export async function isSubscribed(patientId: string, doctorId: string): Promise<boolean> {
  return (await prisma.slotAlert.count({ where: { patientId, doctorId, notifiedAt: null } })) > 0;
}

/**
 * Called after a doctor publishes slots: texts every patient waiting for
 * this doctor once, with the first new opening. The conditional update
 * claims each alert so two calls never text the same patient.
 */
export async function notifySlotAlerts(doctorId: string): Promise<number> {
  const next = await prisma.slot.findFirst({
    where: { doctorId, isBooked: false, startsAt: { gt: new Date() } },
    orderBy: { startsAt: "asc" },
    include: { doctor: true },
  });
  if (!next) return 0;
  const alerts = await prisma.slotAlert.findMany({ where: { doctorId, notifiedAt: null }, include: { patient: true } });
  let sent = 0;
  for (const alert of alerts) {
    const claimed = await prisma.slotAlert.updateMany({ where: { id: alert.id, notifiedAt: null }, data: { notifiedAt: new Date() } });
    if (claimed.count === 0) continue;
    await sendNotification({
      userId: alert.patient.userId,
      type: "SLOTS_AVAILABLE",
      message: `${next.doctor.fullName} has new appointment slots, starting ${formatIst(next.startsAt)}. Book in the MEDORA app before they fill up.`,
    });
    sent += 1;
  }
  return sent;
}

/**
 * Up to three other doctors, same specialization first, ordered by their
 * soonest free slot. Shown when the chosen doctor has nothing open.
 */
export async function nextAvailableDoctors(doctorId: string, limit = 3) {
  const doctor = await prisma.doctor.findUnique({ where: { id: doctorId } });
  if (!doctor) throw new HttpError(404, "Doctor not found");
  const now = new Date();
  const candidates = await prisma.doctor.findMany({
    where: { id: { not: doctorId }, ...BOOKABLE_DOCTOR, slots: { some: { isBooked: false, startsAt: { gt: now } } } },
    include: {
      clinic: true,
      slots: { where: { isBooked: false, startsAt: { gt: now } }, orderBy: { startsAt: "asc" }, take: 1 },
    },
  });
  return candidates
    .map((d) => ({
      id: d.id,
      fullName: d.fullName,
      specialization: d.specialization,
      consultationFee: d.consultationFee,
      isVerified: d.verificationStatus === "APPROVED",
      clinic: { id: d.clinic.id, name: d.clinic.name, address: d.clinic.address },
      nextSlot: d.slots[0],
      sameSpecialization: d.specialization.toLowerCase() === doctor.specialization.toLowerCase(),
    }))
    .sort((a, b) => Number(b.sameSpecialization) - Number(a.sameSpecialization) || a.nextSlot.startsAt.getTime() - b.nextSlot.startsAt.getTime())
    .slice(0, limit);
}
