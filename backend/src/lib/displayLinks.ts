import crypto from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { env } from "./env";
import { redisPub } from "./redis";
import { HttpError } from "../middleware/errorHandler";
import { todayKey } from "./dates";
import { getNowServing } from "./queueService";
import { writeAuditLog } from "./audit";

/**
 * Waiting-room TV links: a read-only "now serving" board for one doctor,
 * opened with no login. The link's token is 256 random bits; only its
 * SHA-256 and an AES-256-GCM-encrypted copy are stored, and logs and the
 * audit trail only ever see its first 6 characters.
 */
export const TOKEN_BYTES = 32;
/** base64url of 32 bytes: 43 characters. Anything else is rejected before a lookup. */
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
/** Redis channel: a link id published here has just been revoked; every instance closes its board sockets. */
export const DISPLAY_REVOKED_CHANNEL = "display:revoked";

const hashToken = (token: string) => crypto.createHash("sha256").update(token).digest("hex");
const prefixOf = (token: string) => token.slice(0, 6);
/** Short, safe form for logs: never the whole token. */
export const logSafe = (token: string) => `${prefixOf(token)}…`;

// Its own key (BOARD_LINK_KEY), so rotating the JWT secret never touches board links.
const key = env.boardLinkKey;

function encrypt(token: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}

function decrypt(stored: string): string {
  const raw = Buffer.from(stored, "base64url");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
}

/** The live link for a token, or null for anything invalid, unknown or revoked (callers answer all three the same way). */
export async function findLiveLink(token: string): Promise<{ id: string; doctorId: string } | null> {
  if (!TOKEN_PATTERN.test(token)) return null;
  return prisma.displayLink.findFirst({ where: { tokenHash: hashToken(token), revokedAt: null }, select: { id: true, doctorId: true } });
}

export interface DisplayLinkView {
  /** null when the link was saved under an earlier BOARD_LINK_KEY: it still works on the TV, but regenerate it to see it. */
  token: string | null;
  prefix: string;
  createdAt: Date;
}

export async function getDisplayLink(doctorId: string): Promise<DisplayLinkView | null> {
  const link = await prisma.displayLink.findFirst({ where: { doctorId, revokedAt: null } });
  if (!link) return null;
  let token: string | null = null;
  try {
    token = decrypt(link.tokenEncrypted);
  } catch {
    token = null; // saved under another key
  }
  return { token, prefix: link.tokenPrefix, createdAt: link.createdAt };
}

async function insertLink(tx: Prisma.TransactionClient, doctorId: string, actorUserId: string) {
  const token = crypto.randomBytes(TOKEN_BYTES).toString("base64url");
  const link = await tx.displayLink.create({
    data: { doctorId, tokenHash: hashToken(token), tokenEncrypted: encrypt(token), tokenPrefix: prefixOf(token), createdByUserId: actorUserId },
  });
  return { link, view: { token, prefix: link.tokenPrefix, createdAt: link.createdAt } };
}

export async function createDisplayLink(doctorId: string, actorUserId: string): Promise<DisplayLinkView> {
  try {
    const { link, view } = await prisma.$transaction((tx) => insertLink(tx, doctorId, actorUserId));
    await writeAuditLog({ actorUserId, action: "DISPLAY_LINK_CREATED", targetType: "Doctor", targetId: doctorId, metadata: { linkId: link.id, prefix: link.tokenPrefix } });
    return view;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new HttpError(409, "A display link already exists. Regenerate it to get a new one.");
    }
    throw err;
  }
}

/** Revokes the current link at once and issues a new one. */
export async function regenerateDisplayLink(doctorId: string, actorUserId: string): Promise<DisplayLinkView> {
  const { old, link, view } = await prisma.$transaction(async (tx) => {
    const current = await tx.displayLink.findFirst({ where: { doctorId, revokedAt: null } });
    if (!current) throw new HttpError(404, "There is no display link to regenerate");
    await tx.displayLink.update({ where: { id: current.id }, data: { revokedAt: new Date() } });
    return { old: current, ...(await insertLink(tx, doctorId, actorUserId)) };
  });
  await redisPub.publish(DISPLAY_REVOKED_CHANNEL, old.id);
  await writeAuditLog({
    actorUserId,
    action: "DISPLAY_LINK_REGENERATED",
    targetType: "Doctor",
    targetId: doctorId,
    metadata: { revokedLinkId: old.id, revokedPrefix: old.tokenPrefix, linkId: link.id, prefix: link.tokenPrefix },
  });
  return view;
}

export async function revokeDisplayLink(doctorId: string, actorUserId: string): Promise<void> {
  const current = await prisma.displayLink.findFirst({ where: { doctorId, revokedAt: null } });
  if (!current) throw new HttpError(404, "There is no display link to revoke");
  const done = await prisma.displayLink.updateMany({ where: { id: current.id, revokedAt: null }, data: { revokedAt: new Date() } });
  if (done.count === 0) throw new HttpError(404, "There is no display link to revoke");
  await redisPub.publish(DISPLAY_REVOKED_CHANNEL, current.id);
  await writeAuditLog({ actorUserId, action: "DISPLAY_LINK_REVOKED", targetType: "Doctor", targetId: doctorId, metadata: { linkId: current.id, prefix: current.tokenPrefix } });
}

/**
 * Everything the board may ever show. Nothing about any patient: no names,
 * numbers, family members, appointment details or payment status.
 */
export interface BoardPayload {
  clinicName: string;
  doctorName: string;
  /** SERVING: running; PAUSED: the desk paused the queue; NOT_IN: no clinic today or the doctor is unavailable. */
  state: "SERVING" | "PAUSED" | "NOT_IN";
  /** The token being seen now; null before the first patient is called. */
  nowServing: number | null;
  /** Up to 3 tokens of checked-in patients waiting, in calling order. */
  next: number[];
  updatedAt: string;
}
export const BOARD_FIELDS = ["clinicName", "doctorName", "state", "nowServing", "next", "updatedAt"] as const;

/** Builds the board for a doctor, copying only the whitelisted fields (never spread a database row in here). */
export async function boardSnapshot(doctorId: string): Promise<BoardPayload> {
  const date = todayKey();
  const doctor = await prisma.doctor.findUniqueOrThrow({
    where: { id: doctorId },
    select: { fullName: true, isActive: true, verificationStatus: true, clinic: { select: { name: true } } },
  });
  const [day, waiting, slotsToday, serving] = await Promise.all([
    prisma.clinicDay.findUnique({ where: { doctorId_date: { doctorId, date } }, select: { status: true } }),
    prisma.appointment.findMany({
      where: { doctorId, queueDate: date, status: "CHECKED_IN", queueToken: { not: null } },
      orderBy: { queueToken: "asc" },
      take: 3,
      select: { queueToken: true },
    }),
    prisma.slot.count({ where: { doctorId, slotDate: date } }),
    getNowServing(doctorId, date),
  ]);
  const available = doctor.isActive && doctor.verificationStatus === "APPROVED";
  const state: BoardPayload["state"] =
    !available || day?.status === "CLOSED" || slotsToday === 0 ? "NOT_IN" : day?.status === "PAUSED" ? "PAUSED" : "SERVING";
  return {
    clinicName: String(doctor.clinic.name),
    doctorName: String(doctor.fullName),
    state,
    nowServing: state === "NOT_IN" || serving <= 0 ? null : Number(serving),
    next: state === "NOT_IN" ? [] : waiting.map((a) => Number(a.queueToken)),
    updatedAt: new Date().toISOString(),
  };
}
