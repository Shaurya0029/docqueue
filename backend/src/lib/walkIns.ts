import { prisma } from "./prisma";
import { HttpError } from "../middleware/errorHandler";
import { formatIst, todayKey } from "./dates";
import { tokenForSlot, ensureClinicDay, publishQueueUpdate } from "./queueService";
import { sendNotification } from "./notifications";
import { writeAuditLog } from "./audit";

/**
 * A patient without the app, added at the desk by an associate.
 *
 * The walk-in takes the doctor's earliest free slot today that has not
 * ended, so their token follows slot time like everyone else's and the
 * doctor is never overbooked. They are checked in at once (they are at the
 * desk). An existing patient account with that phone is reused.
 */
export async function addWalkIn(params: {
  doctorId: string;
  fullName: string;
  phoneNumber: string;
  feeCollected: boolean;
  actorUserId: string;
}): Promise<{ appointmentId: string; token: number; slotStartsAt: Date; patientName: string }> {
  const doctor = await prisma.doctor.findUniqueOrThrow({ where: { id: params.doctorId }, include: { clinic: true } });

  // Find or create the patient. Consent was given to the associate in person.
  let user = await prisma.user.findUnique({ where: { phoneNumber: params.phoneNumber }, include: { patient: true } });
  if (user && user.role !== "PATIENT") throw new HttpError(409, "This phone number belongs to a staff account");
  if (user && !user.isActive) throw new HttpError(409, "This patient account is disabled");
  const newPatient = !user;
  if (!user) {
    user = await prisma.user.create({
      data: {
        phoneNumber: params.phoneNumber,
        role: "PATIENT",
        patient: { create: { fullName: params.fullName, consentAt: new Date(), consentSource: "desk" } },
      },
      include: { patient: true },
    });
  }
  const patient = user.patient!;

  const today = todayKey();
  const result = await prisma.$transaction(async (tx) => {
    const active = await tx.appointment.findFirst({
      where: { patientId: patient.id, doctorId: doctor.id, queueDate: today, status: { in: ["BOOKED", "CHECKED_IN", "IN_CONSULTATION"] } },
    });
    if (active) throw new HttpError(409, `This patient is already in today's queue (token ${active.queueToken})`);

    const now = new Date();
    const candidates = await tx.slot.findMany({
      where: { doctorId: doctor.id, slotDate: today, isBooked: false, endsAt: { gt: now } },
      orderBy: { startsAt: "asc" },
      take: 5,
    });
    for (const slot of candidates) {
      const claimed = await tx.slot.updateMany({ where: { id: slot.id, isBooked: false }, data: { isBooked: true } });
      if (claimed.count === 0) continue; // taken a moment ago; try the next one
      const token = await tokenForSlot(tx, slot);
      const appointment = await tx.appointment.create({
        data: {
          patientId: patient.id,
          doctorId: doctor.id,
          slotId: slot.id,
          status: "CHECKED_IN",
          isWalkIn: true,
          queueToken: token,
          queueDate: today,
          checkedInAt: now,
        },
      });
      if (params.feeCollected) {
        await tx.payment.create({
          data: { appointmentId: appointment.id, amount: doctor.consultationFee, method: "DESK", status: "PAID" },
        });
      }
      return { appointment, token, slot };
    }
    throw new HttpError(409, `${doctor.fullName} has no free slots left today`);
  });

  await ensureClinicDay(doctor.id, today);
  await publishQueueUpdate(doctor.id, { type: "WALK_IN", appointmentId: result.appointment.id, token: result.token });
  await sendNotification({
    userId: user.id,
    type: "BOOKING_CONFIRMED",
    message: `You are checked in with ${doctor.fullName} at ${doctor.clinic.name}. Your token is ${result.token} (around ${formatIst(result.slot.startsAt)}).`,
  });
  await writeAuditLog({
    actorUserId: params.actorUserId,
    action: "WALK_IN_ADDED",
    targetType: "Appointment",
    targetId: result.appointment.id,
    metadata: { token: result.token, feeCollected: params.feeCollected, newPatient },
  });
  return { appointmentId: result.appointment.id, token: result.token, slotStartsAt: result.slot.startsAt, patientName: patient.fullName ?? params.fullName };
}
