import { Prisma, type NotificationType } from "@prisma/client";
import { prisma } from "./prisma";
import { getSmsProvider } from "./sms";
import { formatIst, todayKey } from "./dates";
import { getNowServing } from "./queueService";
import { accountUserId, contactSelect, whoFor, type Who } from "./family";

/**
 * Sends a patient notification by SMS and logs it in the Notification table.
 *
 * With a `dedupeKey`, the row is inserted (PENDING) before sending; the
 * unique key means only the first caller sends, so a retried job or a
 * second API instance never texts the patient twice. A failed SMS never
 * fails the action that triggered it: the row is marked FAILED instead.
 *
 * Returns false when the message was skipped as a duplicate.
 */
export async function sendNotification(params: {
  userId: string;
  /** The patient the message is about, when there is one (see notifyPatient). */
  patientId?: string;
  type: NotificationType;
  message: string;
  dedupeKey?: string;
}): Promise<boolean> {
  let rowId: string;
  try {
    const row = await prisma.notification.create({
      data: {
        userId: params.userId,
        patientId: params.patientId ?? null,
        type: params.type,
        channel: "SMS",
        status: "PENDING",
        payload: params.message,
        dedupeKey: params.dedupeKey ?? null,
      },
    });
    rowId = row.id;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return false; // already sent
    throw err;
  }

  let status: "SENT" | "FAILED" = "FAILED";
  const user = await prisma.user.findUnique({ where: { id: params.userId }, select: { phoneNumber: true } });
  if (user) {
    try {
      await getSmsProvider().send(user.phoneNumber, params.message);
      status = "SENT";
    } catch (err) {
      console.error(`notification ${params.type} to user ${params.userId} failed`, err);
    }
  }
  await prisma.notification.update({ where: { id: rowId }, data: { status, sentAt: new Date() } });
  return true;
}

/**
 * Texts about a patient. A family member has no phone of their own, so the
 * message goes to their account holder and names them ("Reminder for Asha").
 * A separate desk walk-in record (walkInPhone) gets no messages.
 */
export async function notifyPatient(params: {
  patientId: string;
  type: NotificationType;
  message: (who: Who) => string;
  dedupeKey?: string;
}): Promise<boolean> {
  const patient = await prisma.patient.findUniqueOrThrow({ where: { id: params.patientId }, select: contactSelect });
  // A separate desk walk-in record has no account to text: the desk tells them in person.
  if (!patient.userId && !patient.accountHolder) return false;
  return sendNotification({
    userId: accountUserId(patient),
    patientId: patient.id,
    type: params.type,
    dedupeKey: params.dedupeKey,
    message: params.message(whoFor(patient)),
  });
}

export const REMINDER_MINUTES_BEFORE = 60;

/**
 * Texts every booked patient whose slot starts within the next hour, once.
 * Bookings made less than an hour before their slot are skipped: the
 * confirmation they just got already serves as the reminder.
 */
export async function sendDueReminders(now = new Date()): Promise<number> {
  const horizon = new Date(now.getTime() + REMINDER_MINUTES_BEFORE * 60_000);
  const due = await prisma.appointment.findMany({
    where: { status: "BOOKED", slot: { startsAt: { gt: now, lte: horizon } } },
    include: { slot: true, doctor: { include: { clinic: true } } },
  });
  let sent = 0;
  for (const a of due) {
    if (a.slot.startsAt.getTime() - a.createdAt.getTime() < REMINDER_MINUTES_BEFORE * 60_000) continue;
    const ok = await notifyPatient({
      patientId: a.patientId,
      type: "REMINDER",
      dedupeKey: `reminder:${a.id}`,
      message: (w) =>
        `Reminder${w.forName}: ${w.your} appointment with ${a.doctor.fullName} is at ${formatIst(a.slot.startsAt)}, ${a.doctor.clinic.name}. ${w.Your} token is ${a.queueToken}. Show the QR on ${w.your} ticket at the desk.`,
    });
    if (ok) sent += 1;
  }
  return sent;
}

/**
 * After the queue moves, tells the patient who is now third in line
 * (two patients ahead) that it is nearly their turn. Sent once per
 * appointment, and only once the doctor has started seeing patients today.
 */
export async function notifyThirdInLine(doctorId: string): Promise<void> {
  const date = todayKey();
  const nowServing = await getNowServing(doctorId, date);
  if (nowServing === 0) return;
  const waiting = await prisma.appointment.findMany({
    where: { doctorId, queueDate: date, status: { in: ["BOOKED", "CHECKED_IN"] }, queueToken: { gt: nowServing } },
    orderBy: { queueToken: "asc" },
    take: 3,
  });
  const third = waiting[2];
  if (!third) return;
  await notifyPatient({
    patientId: third.patientId,
    type: "QUEUE_UPDATE",
    dedupeKey: `third-in-line:${third.id}`,
    message: (w) => `${w.youAre} 3rd in line (token ${third.queueToken}). Please be at the clinic; ${w.your} turn is coming up soon.`,
  });
}

/** Every minute: 1-hour reminders, and "Leave now" texts (time passes even when the queue does not move). */
export function startReminderJob(intervalMs = 60_000): NodeJS.Timeout {
  return setInterval(() => {
    sendDueReminders().catch((err) => console.error("reminder job failed", err));
    import("./leaveNow")
      .then(({ evaluateLeaveAlerts }) => evaluateLeaveAlerts())
      .catch((err) => console.error("leave-now job failed", err));
  }, intervalMs);
}
