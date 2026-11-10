import crypto from "crypto";
import { env } from "./env";

export interface GatewayOrder {
  orderId: string;
  amount: number;
  currency: string;
  keyId: string;
}

/**
 * In stub mode we create a fake order id and the frontend "pays" by calling
 * a dev-only confirm endpoint that mimics the webhook. In live mode this
 * would call Razorpay's orders.create API.
 */
export function createOrder(appointmentId: string, amountPaise: number): GatewayOrder {
  if (env.paymentsMode === "stub") {
    return {
      orderId: `order_stub_${appointmentId}_${Date.now()}`,
      amount: amountPaise,
      currency: "INR",
      keyId: "rzp_test_stub",
    };
  }
  throw new Error("Live Razorpay integration not configured");
}

/**
 * Verifies the Razorpay webhook signature (HMAC SHA256 of the raw body with
 * the webhook secret). In stub mode any signature prefixed "stub_" passes.
 */
export function verifyWebhookSignature(rawBody: string, signature: string): boolean {
  if (env.paymentsMode === "stub") {
    return signature.startsWith("stub_");
  }
  const expected = crypto
    .createHmac("sha256", env.razorpayKeySecret)
    .update(rawBody)
    .digest("hex");
  return expected === signature;
}
