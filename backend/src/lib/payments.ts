import crypto from "crypto";
import { env } from "./env";

/**
 * Payment gateway client.
 *
 * - `stub`: no network calls; order and refund ids are generated locally.
 *   Used by tests and by local runs without Razorpay keys.
 * - `razorpay`: real Razorpay API calls. With rzp_test_ keys this is
 *   Razorpay test mode; no money moves.
 *
 * In both modes a payment is confirmed ONLY by a webhook whose HMAC-SHA256
 * signature matches RAZORPAY_WEBHOOK_SECRET (see verifyWebhookSignature).
 */

export interface GatewayOrder {
  orderId: string;
  amount: number; // paise
  currency: "INR";
  keyId: string;
  mode: "stub" | "razorpay";
}

const RAZORPAY_API = "https://api.razorpay.com/v1";

async function razorpay<T>(path: string, body: unknown): Promise<T> {
  const auth = Buffer.from(`${env.razorpayKeyId}:${env.razorpayKeySecret}`).toString("base64");
  const res = await fetch(`${RAZORPAY_API}${path}`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Razorpay ${path} failed with ${res.status}: ${detail}`);
  }
  return (await res.json()) as T;
}

export async function createOrder(appointmentId: string, amountPaise: number): Promise<GatewayOrder> {
  if (env.paymentsMode === "stub") {
    return {
      orderId: `order_stub_${crypto.randomBytes(8).toString("hex")}`,
      amount: amountPaise,
      currency: "INR",
      keyId: "rzp_test_stub",
      mode: "stub",
    };
  }
  const order = await razorpay<{ id: string; amount: number }>("/orders", {
    amount: amountPaise,
    currency: "INR",
    receipt: appointmentId,
    notes: { appointmentId },
  });
  return { orderId: order.id, amount: order.amount, currency: "INR", keyId: env.razorpayKeyId, mode: "razorpay" };
}

export async function refundPayment(gatewayPaymentId: string, amountPaise: number): Promise<{ refundId: string }> {
  if (env.paymentsMode === "stub") {
    return { refundId: `rfnd_stub_${crypto.randomBytes(8).toString("hex")}` };
  }
  const refund = await razorpay<{ id: string }>(`/payments/${gatewayPaymentId}/refund`, { amount: amountPaise });
  return { refundId: refund.id };
}

export function signWebhookBody(rawBody: string): string {
  return crypto.createHmac("sha256", env.razorpayWebhookSecret).update(rawBody).digest("hex");
}

/** Razorpay signs the raw request body with the webhook secret (X-Razorpay-Signature). */
export function verifyWebhookSignature(rawBody: string, signature: string): boolean {
  const expected = Buffer.from(signWebhookBody(rawBody), "utf8");
  const given = Buffer.from(signature, "utf8");
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}
