import { prisma } from "./prisma";
import { refundPayment } from "./payments";
import { notifyPatient } from "./notifications";
import { writeAuditLog } from "./audit";

/** Cancel this many hours or more before the slot for a full refund. */
export const REFUND_CUTOFF_HOURS = 2;

export function isRefundableByPolicy(slotStartsAt: Date, now = new Date()): boolean {
  return slotStartsAt.getTime() - now.getTime() >= REFUND_CUTOFF_HOURS * 3_600_000;
}

export type RefundResult = "PROCESSED" | "FAILED" | "NOT_PAID";

/**
 * Refunds a paid booking in full through the gateway. Safe to call twice:
 * the PAID -> REFUNDED claim lets only one caller reach the gateway. If the
 * gateway call fails, the payment goes back to PAID with a FAILED Refund
 * record, so the doctor's refund override can retry it.
 */
export async function issueRefund(params: { paymentId: string; actorUserId: string; reason: string }): Promise<RefundResult> {
  const claimed = await prisma.payment.updateMany({ where: { id: params.paymentId, status: "PAID" }, data: { status: "REFUNDED" } });
  if (claimed.count === 0) return "NOT_PAID";

  const payment = await prisma.payment.findUniqueOrThrow({
    where: { id: params.paymentId },
    include: { appointment: { select: { patientId: true } } },
  });
  let status: "PROCESSED" | "FAILED" = "PROCESSED";
  let refundRef: string | null = null;
  const atDesk = payment.method === "DESK";
  try {
    if (atDesk) {
      // Collected in cash/UPI at the desk, so it is handed back there.
    } else {
      if (!payment.gatewayRef) throw new Error("payment has no gateway reference");
      refundRef = (await refundPayment(payment.gatewayRef, payment.amount * 100)).refundId;
    }
  } catch (err) {
    status = "FAILED";
    console.error(`refund for payment ${payment.id} failed`, err);
    await prisma.payment.update({ where: { id: payment.id }, data: { status: "PAID" } });
  }
  await prisma.refund.upsert({
    where: { paymentId: payment.id },
    create: { paymentId: payment.id, amount: payment.amount, status, gatewayRef: refundRef },
    update: { amount: payment.amount, status, gatewayRef: refundRef },
  });

  if (status === "PROCESSED") {
    await notifyPatient({
      patientId: payment.appointment.patientId,
      type: "REFUND_ISSUED",
      message: (w) =>
        atDesk
          ? `A refund of Rs ${payment.amount}${w.forName} is ready for you at the clinic desk.`
          : `A refund of Rs ${payment.amount}${w.forName} has been issued to your original payment method. It usually arrives in 5-7 working days.`,
    });
  }
  await writeAuditLog({
    actorUserId: params.actorUserId,
    action: status === "PROCESSED" ? "REFUND_ISSUED" : "REFUND_FAILED",
    targetType: "Appointment",
    targetId: payment.appointmentId,
    metadata: { reason: params.reason, amount: payment.amount, refundId: refundRef },
  });
  return status;
}
