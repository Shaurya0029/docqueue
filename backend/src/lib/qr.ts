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

export function verifyQrToken(token: string): { appointmentId: string; expiresAtMs: number } | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [appointmentId, expiresAtMsStr, hmac] = parts;
  const payload = `${appointmentId}.${expiresAtMsStr}`;
  const expected = crypto.createHmac("sha256", env.jwtSecret).update(payload).digest("hex");
  if (expected !== hmac) return null;
  return { appointmentId, expiresAtMs: Number(expiresAtMsStr) };
}
