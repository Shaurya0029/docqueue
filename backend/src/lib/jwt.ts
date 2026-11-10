import jwt from "jsonwebtoken";
import { env } from "./env";
import type { Role } from "@prisma/client";

export interface JwtPayload {
  userId: string;
  role: Role;
  // profile id (Patient.id / Doctor.id / Associate.id / Admin.id), lets the
  // service layer scope every query without trusting request params
  profileId: string;
}

// Copy only our claims: a payload decoded by jwt.verify() also carries
// iat/exp, and re-signing it with `expiresIn` makes jsonwebtoken throw.
function claims({ userId, role, profileId }: JwtPayload): JwtPayload {
  return { userId, role, profileId };
}

export function signAccessToken(payload: JwtPayload): string {
  return jwt.sign(claims(payload), env.jwtSecret, { expiresIn: "2h" });
}

export function signRefreshToken(payload: JwtPayload): string {
  return jwt.sign(claims(payload), env.jwtRefreshSecret, { expiresIn: "30d" });
}

export function verifyAccessToken(token: string): JwtPayload {
  return jwt.verify(token, env.jwtSecret) as JwtPayload;
}

export function verifyRefreshToken(token: string): JwtPayload {
  return jwt.verify(token, env.jwtRefreshSecret) as JwtPayload;
}
