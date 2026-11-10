import { env } from "./env";
import { prisma } from "./prisma";

const otpStore = new Map<string, { code: string; expiresAt: number }>();
const otpAttempts = new Map<string, number[]>(); // phone -> request timestamps, for rate limiting

const OTP_TTL_MS = 5 * 60 * 1000;
const MAX_OTP_PER_HOUR = 5;

export function isOtpRateLimited(phoneNumber: string): boolean {
  const now = Date.now();
  const hourAgo = now - 60 * 60 * 1000;
  const attempts = (otpAttempts.get(phoneNumber) ?? []).filter((t) => t > hourAgo);
  otpAttempts.set(phoneNumber, attempts);
  return attempts.length >= MAX_OTP_PER_HOUR;
}

export function recordOtpAttempt(phoneNumber: string): void {
  const attempts = otpAttempts.get(phoneNumber) ?? [];
  attempts.push(Date.now());
  otpAttempts.set(phoneNumber, attempts);
}

export async function sendOtp(phoneNumber: string): Promise<{ devOtp?: string }> {
  const code = env.smsMode === "stub" ? "123456" : String(Math.floor(100000 + Math.random() * 900000));
  otpStore.set(phoneNumber, { code, expiresAt: Date.now() + OTP_TTL_MS });

  if (env.smsMode === "stub") {
    // eslint-disable-next-line no-console
    console.log(`[sms-stub] OTP for ${phoneNumber}: ${code}`);
    return { devOtp: code };
  }

  // live mode would call MSG91 / Twilio here using env.SMS_PROVIDER / SMS_API_KEY
  throw new Error("Live SMS provider not configured");
}

export function verifyOtp(phoneNumber: string, code: string): boolean {
  const entry = otpStore.get(phoneNumber);
  if (!entry) return false;
  if (Date.now() > entry.expiresAt) {
    otpStore.delete(phoneNumber);
    return false;
  }
  const ok = entry.code === code;
  if (ok) otpStore.delete(phoneNumber);
  return ok;
}

export async function sendNotification(params: {
  userId: string;
  type: "BOOKING_CONFIRMED" | "REMINDER" | "QUEUE_UPDATE" | "CANCELLED" | "REFUND_ISSUED";
  message: string;
}): Promise<void> {
  if (env.smsMode === "stub") {
    // eslint-disable-next-line no-console
    console.log(`[notification-stub] to user ${params.userId}: ${params.message}`);
  }
  await prisma.notification.create({
    data: {
      userId: params.userId,
      type: params.type,
      channel: "SMS",
      status: "SENT",
      payload: params.message,
    },
  });
}
