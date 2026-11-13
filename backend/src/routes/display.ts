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

/** Per-IP requests per minute to the public board API (a clinic's TVs share an IP; boards poll only as a fallback). */
export const DISPLAY_REQUESTS_PER_MINUTE = 120;

/** Same body as any unknown URL: invalid, unknown and revoked links are indistinguishable. */
const notFound = (res: Response) => res.status(404).json({ error: "Not found" });

function boardHeaders(_req: Request, res: Response, next: NextFunction) {
  res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cache-Control", "no-store");
  next();
}

async function limitPerIp(req: Request, res: Response, next: NextFunction) {
  try {
    if (!(await withinLimit(`display:rate:${req.ip}`, DISPLAY_REQUESTS_PER_MINUTE, 60))) {
      res.status(429).json({ error: "Too many requests, try again later" });
      return;
    }
    next();
  } catch (err) {
    next(err);
  }
}

/** Copies only the whitelisted fields, so nothing else can ever reach the TV. */
export function pickBoard(board: BoardPayload): BoardPayload {
  return Object.fromEntries(BOARD_FIELDS.map((k) => [k, board[k]])) as unknown as BoardPayload;
}

/** Public, no login: the waiting-room board for the link's doctor. */
displayRouter.get(
  "/display/:token",
  boardHeaders,
  limitPerIp,
  asyncHandler(async (req, res) => {
    const token = String(req.params.token);
    const link = await findLiveLink(token);
    if (!link) {
      notFound(res);
      return;
    }
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
