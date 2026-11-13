import { prisma } from "./prisma";
import { redis } from "./redis";
import { HttpError } from "../middleware/errorHandler";
import { writeAuditLog } from "./audit";
import { cancelAppointment } from "./appointmentChanges";
import { revokeUserSessions } from "./revocation";
import { assertFamilyMember, presentMember } from "./family";
import { eraseWaitlist, waitlistForExport } from "./waitlist";
import type { Prisma } from "@prisma/client";

const appointmentInclude = {
  slot: { select: { startsAt: true, endsAt: true } },
  doctor: { select: { fullName: true, specialization: true, clinic: { select: { name: true, address: true } } } },
  payment: { select: { amount: true, method: true, status: true, createdAt: true, refund: { select: { amount: true, status: true, createdAt: true } } } },
} satisfies Prisma.AppointmentInclude;
type ExportAppointment = Prisma.AppointmentGetPayload<{ include: typeof appointmentInclude }>;

function exportAppointment(a: ExportAppointment) {
  return {
    doctor: a.doctor.fullName,
    specialization: a.doctor.specialization,
    clinic: a.doctor.clinic.name,
    clinicAddress: a.doctor.clinic.address,
    startsAt: a.slot.startsAt,
    endsAt: a.slot.endsAt,
    status: a.status,
    queueToken: a.queueToken,
    walkIn: a.isWalkIn,
    bookedAt: a.createdAt,
    checkedInAt: a.checkedInAt,
    calledAt: a.calledAt,
    completedAt: a.completedAt,
    cancelledAt: a.cancelledAt,
    cancelReason: a.cancelReason,
    payment: a.payment,
    // Only the travel time is kept for "Leave now", never a location.
    leaveNowAlert: a.leaveAlertOptedInAt
      ? { optedInAt: a.leaveAlertOptedInAt, travelMinutes: a.leaveAlertTravelMinutes, source: a.leaveAlertSource, sentAt: a.leaveAlertSentAt }
      : null,
  };
}

/**
 * DPDP right of access: everything MEDORA holds about this account holder
 * and the family members they manage, in a plain JSON document they can keep.
 */
export async function exportPatientData(patientId: string, actorUserId: string) {
  const patient = await prisma.patient.findUniqueOrThrow({
    where: { id: patientId },
    include: {
      user: { select: { phoneNumber: true, createdAt: true } },
      appointments: { orderBy: { createdAt: "asc" }, include: appointmentInclude },
      slotAlerts: { include: { doctor: { select: { fullName: true } } } },
      familyMembers: {
        where: { deletedAt: null },
        orderBy: { createdAt: "asc" },
        include: { appointments: { orderBy: { createdAt: "asc" }, include: appointmentInclude } },
      },
    },
  });
  if (!patient.user || !patient.userId) throw new HttpError(403, "Only an account holder can download data");
  const notifications = await prisma.notification.findMany({
    where: { userId: patient.userId },
    orderBy: { sentAt: "asc" },
    select: { type: true, channel: true, status: true, payload: true, sentAt: true, patientId: true },
  });
  const names = new Map(patient.familyMembers.map((m) => [m.id, m.fullName]));
  await writeAuditLog({
    actorUserId,
    action: "PATIENT_DATA_EXPORTED",
    targetType: "Patient",
    targetId: patientId,
    metadata: { familyMembers: patient.familyMembers.map((m) => m.id) },
  });
  return {
    exportedAt: new Date().toISOString(),
    about: "Your data held by MEDORA, and that of the family members you manage. Clinics you visited may keep their own medical records separately.",
    profile: {
      fullName: patient.fullName,
      phoneNumber: patient.user.phoneNumber,
      address: patient.address,
      idDocument: patient.idDocumentRef, // only the last 4 digits are ever stored
      accountCreatedAt: patient.user.createdAt,
      consent: { givenAt: patient.consentAt, givenVia: patient.consentSource },
    },
    appointments: patient.appointments.map(exportAppointment),
    waitlist: await waitlistForExport(patient.id),
    familyMembers: await Promise.all(
      patient.familyMembers.map(async (m) => ({
        ...presentMember(m),
        appointments: m.appointments.map(exportAppointment),
        waitlist: await waitlistForExport(m.id),
      }))
    ),
    messagesSent: notifications.map(({ patientId: about, ...n }) => ({
      ...n,
      about: about && names.has(about) ? names.get(about) : "you",
    })),
    slotAlerts: patient.slotAlerts.map((s) => ({ doctor: s.doctor.fullName, requestedAt: s.createdAt, notifiedAt: s.notifiedAt })),
  };
}

const IN_CLINIC = ["CHECKED_IN", "IN_CONSULTATION"] as const;

/**
 * Erases one patient record (an account holder's or a family member's):
 * upcoming bookings are cancelled (refunded under the usual 2-hour policy),
 * then the person's name, age, ID reference and consent are cleared and the
 * messages and alerts about them deleted. Visit and payment records stay,
 * no longer linked to anyone identifiable, because the clinic must keep its
 * accounts. The caller checks nobody is in the clinic first.
 */
async function erasePatientRecord(patientId: string, actorUserId: string, reason: string): Promise<number> {
  const upcoming = await prisma.appointment.findMany({ where: { patientId, status: { in: ["BOOKED", "PENDING_PAYMENT"] } } });
  for (const a of upcoming) {
    await cancelAppointment({ appointmentId: a.id, by: "patient", actorUserId, reason });
  }
  // Leaves every waitlist (a pending offer passes to the next person), then deletes the records.
  await eraseWaitlist(patientId);
  await prisma.$transaction([
    prisma.notification.deleteMany({ where: { patientId } }),
    prisma.slotAlert.deleteMany({ where: { patientId } }),
    prisma.appointment.updateMany({
      where: { patientId },
      data: { leaveAlertOptedInAt: null, leaveAlertTravelMinutes: null, leaveAlertSource: null, leaveAlertSentAt: null },
    }),
    prisma.patient.update({
      where: { id: patientId },
      data: {
        fullName: null,
        address: null,
        idDocumentRef: null,
        relationship: null,
        dateOfBirth: null,
        ageYears: null,
        ageRecordedOn: null,
        consentAt: null,
        consentSource: null,
        deletedAt: new Date(),
      },
    }),
  ]);
  return upcoming.length;
}

/** DPDP erasure of one family member: only their data; the account and other members are untouched. */
export async function deleteFamilyMember(holderId: string, memberId: string, actorUserId: string): Promise<{ cancelledBookings: number }> {
  await assertFamilyMember(holderId, memberId);
  if ((await prisma.appointment.count({ where: { patientId: memberId, status: { in: [...IN_CLINIC] } } })) > 0) {
    throw new HttpError(409, "This family member is checked in for a visit right now. Remove them after the consultation.");
  }
  const cancelledBookings = await erasePatientRecord(memberId, actorUserId, "Family member removed by the account holder");
  await writeAuditLog({ actorUserId, action: "FAMILY_MEMBER_DELETED", targetType: "Patient", targetId: memberId, metadata: { cancelledBookings } });
  return { cancelledBookings };
}

/**
 * DPDP right to erasure for an account holder: every family member they
 * manage is erased too (the app warns them first), then their own record,
 * and the login is disabled with every session ended. The number can sign
 * up again later as a new patient.
 */
export async function deletePatientAccount(
  patientId: string,
  actorUserId: string
): Promise<{ cancelledBookings: number; deletedFamilyMembers: number }> {
  const patient = await prisma.patient.findUniqueOrThrow({ where: { id: patientId }, include: { user: true } });
  if (patient.deletedAt) throw new HttpError(409, "This account is already deleted");
  if (!patient.user || !patient.userId) throw new HttpError(403, "Only an account holder can delete an account");
  const userId = patient.userId;

  const members = await prisma.patient.findMany({ where: { accountHolderId: patientId, deletedAt: null }, select: { id: true } });
  const everyone = [patientId, ...members.map((m) => m.id)];
  const inClinic = await prisma.appointment.count({ where: { patientId: { in: everyone }, status: { in: [...IN_CLINIC] } } });
  if (inClinic > 0) {
    throw new HttpError(409, "You or a family member are checked in for a visit right now. Delete your account after the consultation.");
  }

  let cancelledBookings = 0;
  for (const m of members) {
    cancelledBookings += await erasePatientRecord(m.id, actorUserId, "Account deleted by the patient");
  }
  cancelledBookings += await erasePatientRecord(patientId, actorUserId, "Account deleted by the patient");

  const phone = patient.user.phoneNumber;
  await prisma.$transaction([
    // Every message sent to this number, whoever it was about.
    prisma.notification.deleteMany({ where: { userId } }),
    prisma.user.update({
      where: { id: userId },
      // The unique placeholder frees the real number for a future sign-up.
      data: { phoneNumber: `deleted:${userId}`, passwordHash: null, isActive: false },
    }),
  ]);
  await redis.del(`otp:${phone}`, `otp:${phone}:attempts`);
  await revokeUserSessions(userId);
  await writeAuditLog({
    actorUserId,
    action: "PATIENT_ACCOUNT_DELETED",
    targetType: "Patient",
    targetId: patientId,
    metadata: { cancelledBookings, deletedFamilyMembers: members.map((m) => m.id) },
  });
  return { cancelledBookings, deletedFamilyMembers: members.length };
}
