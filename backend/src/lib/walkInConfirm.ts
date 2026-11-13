import crypto from "crypto";
import { env } from "./env";
import { redis } from "./redis";
import { getSmsProvider } from "./sms";
import { DEV_OTP, withinLimit } from "./otp";
import { HttpError } from "../middleware/errorHandler";

/**
 * The account holder's confirmation that a walk-in is their family member.
 *
 * A phone number alone never links a walk-in to someone's account. The desk
 * asks for a code to be texted to the account holder; only if the desk then
 * enters that code is the walk-in added to (or matched in) their family.
 * Codes are hashed in Redis, last 10 minutes, burn after 5 wrong guesses,
 * and at most 3 can be requested per number per hour.
 */
export const FAMILY_CODE_TTL_SECONDS = 10 * 60;
export const MAX_FAMILY_CODES_PER_HOUR = 3;
const MAX_ATTEMPTS = 5;

export const normalizeName = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();

const codeKey = (userId: string, name: string) => `walkin-family:${userId}:${normalizeName(name)}`;
const attemptsKey = (userId: string, name: string) => `${codeKey(userId, name)}:attempts`;
const hash = (userId: string, name: string, code: string) =>
  crypto.createHmac("sha256", env.jwtSecret).update(`walkin-family:${userId}:${normalizeName(name)}:${code}`).digest("hex");

export async function sendFamilyCode(params: { holderUserId: string; phoneNumber: string; memberName: string; clinicName: string }): Promise<void> {
  if (!(await withinLimit(`walkin-family:rate:${params.holderUserId}`, MAX_FAMILY_CODES_PER_HOUR, 3600))) {
    throw new HttpError(429, "Too many confirmation codes for this number. Add the patient as a separate walk-in.");
  }
  const devMode = env.smsMode === "stub" && !env.isProduction;
  const code = devMode ? DEV_OTP : String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  await redis
    .multi()
    .set(codeKey(params.holderUserId, params.memberName), hash(params.holderUserId, params.memberName, code), "EX", FAMILY_CODE_TTL_SECONDS)
    .del(attemptsKey(params.holderUserId, params.memberName))
    .exec();
  await getSmsProvider().send(
    params.phoneNumber,
    `${code} is the code to add ${params.memberName.trim()} to your MEDORA family at the ${params.clinicName} front desk. Share it only if you are there with them. It expires in 10 minutes.`
  );
}

/** Checks and consumes the code; wrong guesses count toward the limit. */
export async function checkFamilyCode(holderUserId: string, memberName: string, code: string): Promise<boolean> {
  const stored = await redis.get(codeKey(holderUserId, memberName));
  if (!stored) return false;
  const given = Buffer.from(hash(holderUserId, memberName, code));
  const ok = given.length === stored.length && crypto.timingSafeEqual(given, Buffer.from(stored));
  if (!ok) {
    const attempts = await redis.incr(attemptsKey(holderUserId, memberName));
    await redis.expire(attemptsKey(holderUserId, memberName), FAMILY_CODE_TTL_SECONDS);
    if (attempts >= MAX_ATTEMPTS) await redis.del(codeKey(holderUserId, memberName), attemptsKey(holderUserId, memberName));
    return false;
  }
  await redis.del(codeKey(holderUserId, memberName), attemptsKey(holderUserId, memberName));
  return true;
}
