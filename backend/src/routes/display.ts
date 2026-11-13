import crypto from "crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import { asyncHandler } from "../middleware/errorHandler";
import { requireAuth, requireRole } from "../middleware/auth";
import { assertDoctorAccess } from "../lib/scope";
import { withinLimit } from "../lib/otp";
import {
  BOARD_FIELDS,
  boardSnapshot,
  createDisplayLink,
  findLiveLink,
  getDisplayLink,
  logSafe,
  regenerateDisplayLink,
  revokeDisplayLink,
  type BoardPayload,
} from "../lib/displayLinks";

export const displayRouter = Router();

/**
 * Requests per minute per link and IP: several TVs behind one clinic IP each
 * have their own allowance (boards poll only as a fallback, so this is ample).
 */
export const BOARD_REQUESTS_PER_MINUTE = 240;
/** Requests per minute per IP for links that do not exist: guessing never gets a fresh allowance per guess. */
export const UNKNOWN_LINK_REQUESTS_PER_MINUTE = 30;

/** Rate-limit key for a link: a hash prefix, never the token itself. */
export const linkRateKey = (token: string, ip: string) =>
  `display:rate:${crypto.createHash("sha256").update(token).digest("hex").slice(0, 16)}:${ip}`;

type LiveLink = NonNullable<Awaited<ReturnType<typeof findLiveLink>>>;

/** Rate limits (per link + IP, then per IP for unknown links) and the lookup, for the board API and its socket. */
export async function boardAccess(token: string, ip: string): Promise<{ status: "limited" | "missing" } | { status: "ok"; link: LiveLink }> {
  if (!(await withinLimit(linkRateKey(token, ip), BOARD_REQUESTS_PER_MINUTE, 60))) return { status: "limited" };
  const link = await findLiveLink(token);
  if (link) return { status: "ok", link };
  if (!(await withinLimit(`display:miss:${ip}`, UNKNOWN_LINK_REQUESTS_PER_MINUTE, 60))) return { status: "limited" };
  return { status: "missing" };
}

/** Same body as any unknown URL: invalid, unknown and revoked links are indistinguishable. */
const notFound = (res: Response) => res.status(404).json({ error: "Not found" });

function boardHeaders(_req: Request, res: Response, next: NextFunction) {
  res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cache-Control", "no-store");
  next();
}

/** Copies only the whitelisted fields, so nothing else can ever reach the TV. */
export function pickBoard(board: BoardPayload): BoardPayload {
  return Object.fromEntries(BOARD_FIELDS.map((k) => [k, board[k]])) as unknown as BoardPayload;
}

/** Public, no login: the waiting-room board for the link's doctor. */
displayRouter.get(
  "/display/:token",
  boardHeaders,
  asyncHandler(async (req, res) => {
    const token = String(req.params.token);
    const access = await boardAccess(token, req.ip ?? "unknown");
    if (access.status !== "ok") {
      if (access.status === "limited") res.status(429).json({ error: "Too many requests, try again later" });
      else notFound(res);
      return;
    }
    const { link } = access;
    try {
      res.json({ board: pickBoard(await boardSnapshot(link.doctorId)) });
    } catch (err) {
      console.error(`display board ${logSafe(token)} failed`, err instanceof Error ? err.message : err);
      notFound(res);
    }
  })
);

/** Doctor (own board) and clinic admin (their clinics' doctors) manage the TV link. */
const manage = [requireAuth, requireRole("DOCTOR", "ADMIN")];

displayRouter.get(
  "/doctors/:id/display-link",
  ...manage,
  asyncHandler(async (req, res) => {
    await assertDoctorAccess(req.auth!, req.params.id);
    res.setHeader("Cache-Control", "no-store");
    res.json({ link: await getDisplayLink(req.params.id) });
  })
);

displayRouter.post(
  "/doctors/:id/display-link",
  ...manage,
  asyncHandler(async (req, res) => {
    await assertDoctorAccess(req.auth!, req.params.id);
    res.status(201).json({ link: await createDisplayLink(req.params.id, req.auth!.userId) });
  })
);

displayRouter.post(
  "/doctors/:id/display-link/regenerate",
  ...manage,
  asyncHandler(async (req, res) => {
    await assertDoctorAccess(req.auth!, req.params.id);
    res.json({ link: await regenerateDisplayLink(req.params.id, req.auth!.userId) });
  })
);

displayRouter.delete(
  "/doctors/:id/display-link",
  ...manage,
  asyncHandler(async (req, res) => {
    await assertDoctorAccess(req.auth!, req.params.id);
    await revokeDisplayLink(req.params.id, req.auth!.userId);
    res.json({ ok: true });
  })
);
