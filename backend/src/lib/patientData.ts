import { prisma } from "./prisma";
import { redis } from "./redis";
import { HttpError } from "../middleware/errorHandler";
import { writeAuditLog } from "./audit";
import { cancelAppointment } from "./appointmentChanges";
import { revokeUserSessions } from "./revocation";

/**
 * DPDP right of access: everything MEDORA holds about this patient, in a
 * plain JSON document they can keep.
 */
export async function exportPatientData(patientId: string, actorUserId: string) {
  const patient = await prisma.patient.findUniqueOrThrow({
    where: { id: patientId },
    include: {
      user: { select: { phoneNumber: true, createdAt: true } },
      appointments: {
        orderBy: { createdAt: "asc" },
        include: {
          slot: { select: { startsAt: true, endsAt: true } },
          doctor: { select: { fullName: true, specialization: true, clinic: { select: { name: true, address: true } } } },
          payment: { select: { amount: true, method: true, status: true, createdAt: true, refund: { select: { amount: true, status: true, createdAt: true } } } },
        },
      },
      slotAlerts: { include: { doctor: { select: { fullName: true } } } },
    },
  });
  const notifications = await prisma.notification.findMany({
    where: { userId: patient.userId },
    orderBy: { sentAt: "asc" },
    select: { type: true, channel: true, status: true, payload: true, sentAt: true },
  });
  await writeAuditLog({ actorUserId, action: "PATIENT_DATA_EXPORTED", targetType: "Patient", targetId: patientId });
  return {
    exportedAt: new Date().toISOString(),
    about: "Your data held by MEDORA. Clinics you visited may keep their own medical records separately.",
    profile: {
      fullName: patient.fullName,
      phoneNumber: patient.user.phoneNumber,
      address: patient.address,
      idDocument: patient.idDocumentRef, // only the last 4 digits are ever stored
      accountCreatedAt: patient.user.createdAt,
      consent: { givenAt: patient.consentAt, givenVia: patient.consentSource },
    },
    appointments: patient.appointments.map((a) => ({
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
    })),
    messagesSent: notifications,
    slotAlerts: patient.slotAlerts.map((s) => ({ doctor: s.doctor.fullName, requestedAt: s.createdAt, notifiedAt: s.notifiedAt })),
  };
}

/**
 * DPDP right to erasure. Upcoming bookings are cancelled first (refunded
 * under the usual 2-hour policy). Then the patient's name, phone number,
 * address, ID reference and consent are erased, their messages and alerts
 * deleted, and the login disabled with every session ended. Visit and
 * payment records stay, no longer linked to anyone identifiable, because
 * the clinic must keep its accounts. The number can sign up again later as
 * a new patient.
 */
export async function deletePatientAccount(patientId: string, actorUserId: string): Promise<{ cancelledBookings: number }> {
  const patient = await prisma.patient.findUniqueOrThrow({ where: { id: patientId }, include: { user: true } });
  if (patient.deletedAt) throw new HttpError(409, "This account is already deleted");

  const inClinic = await prisma.appointment.count({ where: { patientId, status: { in: ["CHECKED_IN", "IN_CONSULTATION"] } } });
  if (inClinic > 0) {
    throw new HttpError(409, "You are checked in for a visit right now. Delete your account after the consultation.");
  }

  const upcoming = await prisma.appointment.findMany({ where: { patientId, status: { in: ["BOOKED", "PENDING_PAYMENT"] } } });
  for (const a of upcoming) {
    await cancelAppointment({ appointmentId: a.id, by: "patient", actorUserId, reason: "Account deleted by the patient" });
  }

  const phone = patient.user.phoneNumber;
  await prisma.$transaction([
    prisma.notification.deleteMany({ where: { userId: patient.userId } }),
    prisma.slotAlert.deleteMany({ where: { patientId } }),
    prisma.appointment.updateMany({
      where: { patientId },
      data: { leaveAlertOptedInAt: null, leaveAlertTravelMinutes: null, leaveAlertSource: null, leaveAlertSentAt: null },
    }),
    prisma.patient.update({
      where: { id: patientId },
      data: { fullName: null, address: null, idDocumentRef: null, consentAt: null, consentSource: null, deletedAt: new Date() },
    }),
    prisma.user.update({
      where: { id: patient.userId },
      // The unique placeholder frees the real number for a future sign-up.
      data: { phoneNumber: `deleted:${patient.userId}`, passwordHash: null, isActive: false },
    }),
  ]);
  await redis.del(`otp:${phone}`, `otp:${phone}:attempts`);
  await revokeUserSessions(patient.userId);
  await writeAuditLog({
    actorUserId,
    action: "PATIENT_ACCOUNT_DELETED",
    targetType: "Patient",
    targetId: patientId,
    metadata: { cancelledBookings: upcoming.length },
  });
  return { cancelledBookings: upcoming.length };
}
