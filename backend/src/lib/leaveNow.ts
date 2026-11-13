import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { HttpError } from "../middleware/errorHandler";
import { todayKey } from "./dates";
import { estimateWait } from "./waitTime";
import { travelMinutes, type Point } from "./travel";
import { notifyPatient } from "./notifications";
import { isMinor, ownedByAccount } from "./family";

/**
 * "Leave now" alerts (opt-in, per appointment).
 *
 * The patient shares their location once; we turn it into travel minutes
 * and keep only that number. When the time until their turn is no more
 * than travel minutes + LEAVE_BUFFER_MINUTES, they get one SMS.
 *
 * Time until turn = the later of the queue estimate (patients ahead x
 * average consultation) and the slot's start time. Without the slot floor,
 * the first patient of the day would have a 0-minute "wait" hours before
 * the clinic opens and be told to leave far too early.
 */
export const LEAVE_BUFFER_MINUTES = 10;
export const MAX_TRAVEL_MINUTES = 300;

export function minutesUntilTurn(estimatedWaitMinutes: number, slotStartsAt: Date, now = new Date()): number {
  const untilSlot = Math.max(0, Math.ceil((slotStartsAt.getTime() - now.getTime()) / 60_000));
  return Math.max(estimatedWaitMinutes, untilSlot);
}

export function shouldLeaveNow(untilTurnMinutes: number, travel: number): boolean {
  return untilTurnMinutes <= travel + LEAVE_BUFFER_MINUTES;
}

export interface LeaveAlertState {
  /** The clinic has coordinates, so the feature is offered. */
  available: boolean;
  /**
   * Whether the trip may be estimated from the device's location. Not for
   * children's visits: no location is collected for under-18s, so their
   * account holder types the travel time instead.
   */
  locationAllowed: boolean;
  enabled: boolean;
  travelMinutes: number | null;
  source: "estimate" | "manual" | null;
  sentAt: Date | null;
}

/** What leaveAlertState needs: the clinic's location and whether the patient is a minor. */
export const leaveAlertInclude = {
  doctor: { include: { clinic: true } },
  patient: { select: { id: true, fullName: true, dateOfBirth: true, ageYears: true, ageRecordedOn: true, relationship: true, accountHolderId: true } },
} satisfies Prisma.AppointmentInclude;

/** The account holder's own appointment or a family member's; 404 otherwise. */
async function ownAppointment(appointmentId: string, holderId: string) {
  const appointment = await prisma.appointment.findFirst({
    where: { id: appointmentId, ...ownedByAccount(holderId) },
    include: leaveAlertInclude,
  });
  if (!appointment) throw new HttpError(404, "Appointment not found");
  return appointment;
}

function clinicPoint(clinic: { latitude: number | null; longitude: number | null }): Point | null {
  return clinic.latitude != null && clinic.longitude != null ? { latitude: clinic.latitude, longitude: clinic.longitude } : null;
}

export function leaveAlertState(appointment: {
  leaveAlertOptedInAt: Date | null;
  leaveAlertTravelMinutes: number | null;
  leaveAlertSource: string | null;
  leaveAlertSentAt: Date | null;
  doctor: { clinic: { latitude: number | null; longitude: number | null } };
  patient: Parameters<typeof isMinor>[0];
}): LeaveAlertState {
  return {
    available: clinicPoint(appointment.doctor.clinic) !== null,
    locationAllowed: !isMinor(appointment.patient),
    enabled: appointment.leaveAlertOptedInAt !== null,
    travelMinutes: appointment.leaveAlertTravelMinutes,
    source: (appointment.leaveAlertSource as LeaveAlertState["source"]) ?? null,
    sentAt: appointment.leaveAlertSentAt,
  };
}

/**
 * Turns the alert on, from the patient's location (read once, not kept) or
 * from minutes they typed. Also used to adjust the minutes later.
 */
export async function enableLeaveAlert(params: {
  appointmentId: string;
  patientProfileId: string;
  from?: Point;
  manualMinutes?: number;
}): Promise<LeaveAlertState> {
  const appointment = await ownAppointment(params.appointmentId, params.patientProfileId);
  if (appointment.status !== "BOOKED") throw new HttpError(409, "Leave-now alerts are only for upcoming bookings");
  const clinic = clinicPoint(appointment.doctor.clinic);
  if (!clinic) throw new HttpError(409, "This clinic does not offer leave-now alerts yet");

  let minutes: number;
  let source: "estimate" | "manual";
  if (params.manualMinutes !== undefined) {
    minutes = params.manualMinutes;
    source = "manual";
  } else if (params.from) {
    if (isMinor(appointment.patient)) {
      throw new HttpError(409, "We don't use location for a child's visit. Enter the travel time instead.");
    }
    minutes = (await travelMinutes(params.from, clinic)).minutes;
    source = "estimate";
  } else {
    throw new HttpError(400, "Send a location or travel minutes");
  }
  minutes = Math.min(MAX_TRAVEL_MINUTES, Math.max(1, Math.round(minutes)));

  const updated = await prisma.appointment.update({
    where: { id: appointment.id },
    data: { leaveAlertOptedInAt: appointment.leaveAlertOptedInAt ?? new Date(), leaveAlertTravelMinutes: minutes, leaveAlertSource: source },
    include: leaveAlertInclude,
  });
  // It may already be time to go.
  await evaluateLeaveAlerts({ appointmentIds: [appointment.id] });
  const fresh = await prisma.appointment.findUniqueOrThrow({ where: { id: updated.id }, include: leaveAlertInclude });
  return leaveAlertState(fresh);
}

export async function disableLeaveAlert(appointmentId: string, patientProfileId: string): Promise<LeaveAlertState> {
  await ownAppointment(appointmentId, patientProfileId);
  const updated = await prisma.appointment.update({
    where: { id: appointmentId },
    data: { leaveAlertOptedInAt: null, leaveAlertTravelMinutes: null, leaveAlertSource: null },
    include: leaveAlertInclude,
  });
  return leaveAlertState(updated);
}

/**
 * Sends due "Leave now" texts for today's opted-in, still-booked
 * appointments (one doctor's, specific ones, or all). Checked-in, cancelled,
 * completed and no-show appointments never qualify. Each appointment is
 * texted once per slot: rescheduling re-arms it.
 */
export async function evaluateLeaveAlerts(scope: { doctorId?: string; appointmentIds?: string[] } = {}, now = new Date()): Promise<number> {
  const candidates = await prisma.appointment.findMany({
    where: {
      status: "BOOKED",
      queueDate: todayKey(),
      queueToken: { not: null },
      leaveAlertOptedInAt: { not: null },
      leaveAlertTravelMinutes: { not: null },
      leaveAlertSentAt: null,
      ...(scope.doctorId ? { doctorId: scope.doctorId } : {}),
      ...(scope.appointmentIds ? { id: { in: scope.appointmentIds } } : {}),
    },
    include: { slot: true, doctor: { include: { clinic: true } } },
  });
  let sent = 0;
  for (const a of candidates) {
    const wait = await estimateWait({ doctorId: a.doctorId, queueDate: a.queueDate!, queueToken: a.queueToken! });
    const untilTurn = minutesUntilTurn(wait.estimatedWaitMinutes, a.slot.startsAt, now);
    if (!shouldLeaveNow(untilTurn, a.leaveAlertTravelMinutes!)) continue;

    const claimed = await prisma.appointment.updateMany({
      where: { id: a.id, leaveAlertSentAt: null, status: "BOOKED" },
      data: { leaveAlertSentAt: now },
    });
    if (claimed.count === 0) continue;
    await notifyPatient({
      patientId: a.patientId,
      type: "LEAVE_NOW",
      dedupeKey: `leave-now:${a.id}:${a.slotId}`,
      message: (w) =>
        `Time to leave${w.forName} for ${a.doctor.fullName} at ${a.doctor.clinic.name}: ${w.your} turn is in about ${untilTurn} min and the trip takes about ${a.leaveAlertTravelMinutes} min. Token ${a.queueToken}.`,
    });
    sent += 1;
  }
  return sent;
}
