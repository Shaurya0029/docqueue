import crypto from "crypto";
import { env } from "./env";

/**
 * QR payload is a signed token: "<appointmentId>.<expiresAtMs>.<hmac>".
 * The HMAC prevents forging a token for an appointment that was never paid,
 * and the scan endpoint re-checks expiry and single-use (QrToken.usedAt).
 */
export function signQrToken(appointmentId: string, expiresAtMs: number): string {
  const payload = `${appointmentId}.${expiresAtMs}`;
  const hmac = crypto.createHmac("sha256", env.jwtSecret).update(payload).digest("hex");
  return `${payload}.${hmac}`;
}

// Crockford base32 without I, L, O, U: easy to read aloud and type.
const CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** An 8-character check-in code, e.g. "7F3K9QX2" (40 random bits). */
export function generateShortCode(): string {
  const bytes = crypto.randomBytes(8);
  return Array.from(bytes, (b) => CODE_ALPHABET[b % 32]).join("");
}

/** Accepts what a person types: any case, spaces or dashes. */
export function normalizeShortCode(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
}

export function verifyQrToken(token: string): { appointmentId: string; expiresAtMs: number } | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [appointmentId, expiresAtMsStr, hmac] = parts;
  const payload = `${appointmentId}.${expiresAtMsStr}`;
  const expected = crypto.createHmac("sha256", env.jwtSecret).update(payload).digest("hex");
  if (expected !== hmac) return null;
  return { appointmentId, expiresAtMs: Number(expiresAtMsStr) };
}
