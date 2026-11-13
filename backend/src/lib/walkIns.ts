import { prisma } from "./prisma";
import { HttpError } from "../middleware/errorHandler";
import { formatIst, todayKey } from "./dates";
import { tokenForSlot, ensureClinicDay, publishQueueUpdate } from "./queueService";
import { notifyPatient } from "./notifications";
import { writeAuditLog } from "./audit";
import { assertDoctorBookable } from "./bookable";
import { checkFamilyCode, normalizeName, sendFamilyCode } from "./walkInConfirm";

/**
 * Whose record a walk-in goes on:
 * - "new-account": the number has no MEDORA account, so one is created.
 * - "account-holder": the number's account holder, by the same name.
 * - "family-member": a member of that account holder's family, only after
 *   the account holder confirmed with the code texted to them.
 * - "standalone": a different name on someone's number, not confirmed: a
 *   separate record with the name and number given, never linked to the
 *   account, and no SMS (the desk tells them their token).
 */
export type WalkInLink = "new-account" | "account-holder" | "family-member" | "standalone";

async function patientAccountFor(phoneNumber: string) {
  const user = await prisma.user.findUnique({ where: { phoneNumber }, include: { patient: true } });
  if (user && user.role !== "PATIENT") throw new HttpError(409, "This phone number belongs to a staff account");
  if (user && !user.isActive) throw new HttpError(409, "This patient account is disabled");
  return user;
}

const isHolder = (holderName: string | null, name: string) => !holderName || normalizeName(holderName) === normalizeName(name);
const tidy = (name: string) => name.trim().replace(/\s+/g, " ");

/**
 * The desk asks the account holder to confirm that this walk-in is family:
 * a code is texted to the number's account holder. Nothing is linked yet.
 */
export async function requestFamilyConfirmation(params: {
  doctorId: string;
  fullName: string;
  phoneNumber: string;
  actorUserId: string;
}): Promise<{ sent: true }> {
  const doctor = await prisma.doctor.findUniqueOrThrow({ where: { id: params.doctorId }, include: { clinic: true } });
  const user = await patientAccountFor(params.phoneNumber);
  if (!user?.patient) throw new HttpError(404, "No MEDORA account uses this number. Add them as a walk-in directly.");
  if (isHolder(user.patient.fullName, params.fullName)) throw new HttpError(409, "This is the account holder: no confirmation is needed.");
  await sendFamilyCode({ holderUserId: user.id, phoneNumber: params.phoneNumber, memberName: params.fullName, clinicName: doctor.clinic.name });
  await writeAuditLog({
    actorUserId: params.actorUserId,
    action: "WALK_IN_FAMILY_CODE_SENT",
    targetType: "Patient",
    targetId: user.patient.id,
    metadata: { doctorId: doctor.id },
  });
  return { sent: true };
}

/**
 * A patient without the app, added at the desk by an associate.
 *
 * The walk-in takes the doctor's earliest free slot today that has not
 * ended, so their token follows slot time like everyone else's and the
 * doctor is never overbooked. They are checked in at once (they are at the
 * desk). See WalkInLink for whose record the visit goes on.
 */
export async function addWalkIn(params: {
  doctorId: string;
  fullName: string;
  phoneNumber: string;
  feeCollected: boolean;
  /** The code the account holder received, if the desk asked them to confirm. */
  familyCode?: string;
  actorUserId: string;
}): Promise<{ appointmentId: string; token: number; slotStartsAt: Date; patientName: string; linkedTo: WalkInLink }> {
  await assertDoctorBookable(params.doctorId);
  const doctor = await prisma.doctor.findUniqueOrThrow({ where: { id: params.doctorId }, include: { clinic: true } });
  const fullName = tidy(params.fullName);

  // Consent was given to the associate in person.
  const desk = { consentAt: new Date(), consentSource: "desk" };
  const user = await patientAccountFor(params.phoneNumber);
  let linkedTo: WalkInLink;
  let patient: { id: string; fullName: string | null };
  if (!user) {
    const created = await prisma.user.create({
      data: { phoneNumber: params.phoneNumber, role: "PATIENT", patient: { create: { fullName, ...desk } } },
      include: { patient: true },
    });
    patient = created.patient!;
    linkedTo = "new-account";
  } else if (isHolder(user.patient!.fullName, fullName)) {
    patient = user.patient!;
    linkedTo = "account-holder";
  } else if (params.familyCode) {
    if (!(await checkFamilyCode(user.id, fullName, params.familyCode))) {
      throw new HttpError(400, "The confirmation code is wrong or has expired");
    }
    const holderId = user.patient!.id;
    const members = await prisma.patient.findMany({ where: { accountHolderId: holderId, deletedAt: null }, select: { id: true, fullName: true } });
    patient =
      members.find((m) => m.fullName && normalizeName(m.fullName) === normalizeName(fullName)) ??
      (await prisma.patient.create({
        data: { accountHolderId: holderId, fullName, relationship: "OTHER", ...desk },
        select: { id: true, fullName: true },
      }));
    linkedTo = "family-member";
  } else {
    // Not confirmed: never attached to the account. Reuse this name and number's earlier separate record, if any.
    const earlier = await prisma.patient.findFirst({
      where: { walkInPhone: params.phoneNumber, deletedAt: null, fullName: { equals: fullName, mode: "insensitive" } },
      select: { id: true, fullName: true },
    });
    patient = earlier ?? (await prisma.patient.create({ data: { fullName, walkInPhone: params.phoneNumber, ...desk }, select: { id: true, fullName: true } }));
    linkedTo = "standalone";
  }

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
          data: { appointmentId: appointment.id, amount: doctor.consultationFee, method: "DESK", status: "PAID", paidAt: now },
        });
      }
      return { appointment, token, slot };
    }
    throw new HttpError(409, `${doctor.fullName} has no free slots left today`);
  });

  await ensureClinicDay(doctor.id, today);
  await publishQueueUpdate(doctor.id, { type: "WALK_IN", appointmentId: result.appointment.id, token: result.token });
  // A separate (unconfirmed) record gets no SMS: notifyPatient skips it.
  await notifyPatient({
    patientId: patient.id,
    type: "BOOKING_CONFIRMED",
    message: (w) =>
      `${w.youAre} checked in with ${doctor.fullName} at ${doctor.clinic.name}. ${w.Your} token is ${result.token} (around ${formatIst(result.slot.startsAt)}).`,
  });
  if (linkedTo === "family-member" || linkedTo === "standalone") {
    await writeAuditLog({
      actorUserId: params.actorUserId,
      action: linkedTo === "family-member" ? "WALK_IN_FAMILY_CONFIRMED" : "WALK_IN_STANDALONE",
      targetType: "Patient",
      targetId: patient.id,
      metadata: { appointmentId: result.appointment.id },
    });
  }
  await writeAuditLog({
    actorUserId: params.actorUserId,
    action: "WALK_IN_ADDED",
    targetType: "Appointment",
    targetId: result.appointment.id,
    metadata: { token: result.token, feeCollected: params.feeCollected, linkedTo },
  });
  return { appointmentId: result.appointment.id, token: result.token, slotStartsAt: result.slot.startsAt, patientName: patient.fullName ?? fullName, linkedTo };
}
