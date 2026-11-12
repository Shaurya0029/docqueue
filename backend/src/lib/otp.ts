import crypto from "crypto";
import { env } from "./env";
import { redis } from "./redis";
import { getSmsProvider } from "./sms";
import { HttpError } from "../middleware/errorHandler";

/**
 * One-time passwords, kept in Redis so they survive API restarts and work
 * across several API instances. Only a keyed hash of the code is stored.
 *
 * Limits: 5 OTP requests per phone per hour, 100 per IP per hour (stops one
 * client texting many numbers), and 5 wrong guesses per code, after which the
 * code is burned and the patient must request a new one.
 */
export const OTP_TTL_SECONDS = 5 * 60;
export const MAX_REQUESTS_PER_PHONE_PER_HOUR = 5;
export const MAX_REQUESTS_PER_IP_PER_HOUR = 100; // generous: many patients may share a clinic's Wi-Fi
export const MAX_VERIFY_ATTEMPTS = 5;

/** The fixed code used by the console SMS provider outside production. */
export const DEV_OTP = "123456";

const otpKey = (phone: string) => `otp:${phone}`;
const attemptsKey = (phone: string) => `otp:${phone}:attempts`;

function hashCode(phone: string, code: string): string {
  return crypto.createHmac("sha256", env.jwtSecret).update(`${phone}:${code}`).digest("hex");
}

/** Fixed-window counter; returns false once `max` is exceeded in the window. */
async function withinLimit(key: string, max: number, windowSeconds: number): Promise<boolean> {
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, windowSeconds);
  return count <= max;
}

export async function requestOtp(phone: string, ip: string): Promise<{ devOtp?: string }> {
  if (!(await withinLimit(`otp:rate:phone:${phone}`, MAX_REQUESTS_PER_PHONE_PER_HOUR, 3600))) {
    throw new HttpError(429, "Too many OTP requests for this number. Try again in an hour.");
  }
  if (!(await withinLimit(`otp:rate:ip:${ip}`, MAX_REQUESTS_PER_IP_PER_HOUR, 3600))) {
    throw new HttpError(429, "Too many OTP requests. Try again later.");
  }

  const devMode = env.smsMode === "stub" && !env.isProduction;
  const code = devMode ? DEV_OTP : String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  await redis.multi().set(otpKey(phone), hashCode(phone, code), "EX", OTP_TTL_SECONDS).del(attemptsKey(phone)).exec();
  await getSmsProvider().send(phone, `${code} is your MEDORA verification code. It expires in 5 minutes. Do not share it.`);
  return devMode ? { devOtp: code } : {};
}

/**
 * Checks a code. A correct code is consumed only when `consume` is true, so
 * the caller can ask for consent first without making the patient request a
 * new code. Wrong guesses count toward the attempt limit.
 */
export async function checkOtp(phone: string, code: string, consume: boolean): Promise<boolean> {
  const stored = await redis.get(otpKey(phone));
  if (!stored) return false;
  const given = Buffer.from(hashCode(phone, code));
  const ok = given.length === stored.length && crypto.timingSafeEqual(given, Buffer.from(stored));
  if (!ok) {
    const attempts = await redis.incr(attemptsKey(phone));
    await redis.expire(attemptsKey(phone), OTP_TTL_SECONDS);
    if (attempts >= MAX_VERIFY_ATTEMPTS) await redis.del(otpKey(phone), attemptsKey(phone));
    return false;
  }
  if (consume) await redis.del(otpKey(phone), attemptsKey(phone));
  return true;
}
