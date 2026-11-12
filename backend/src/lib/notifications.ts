import type { NotificationType } from "@prisma/client";
import { prisma } from "./prisma";
import { getSmsProvider } from "./sms";

/**
 * Sends a patient notification by SMS and logs it in the Notification table,
 * whether it was delivered or not. A failed SMS never fails the action that
 * triggered it (a booking, a cancellation): it is logged as FAILED instead.
 */
export async function sendNotification(params: {
  userId: string;
  type: NotificationType;
  message: string;
}): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: params.userId }, select: { phoneNumber: true } });
  let status: "SENT" | "FAILED" = "FAILED";
  if (user) {
    try {
      await getSmsProvider().send(user.phoneNumber, params.message);
      status = "SENT";
    } catch (err) {
      console.error(`notification ${params.type} to user ${params.userId} failed`, err);
    }
  }
  await prisma.notification.create({
    data: { userId: params.userId, type: params.type, channel: "SMS", status, payload: params.message },
  });
}
