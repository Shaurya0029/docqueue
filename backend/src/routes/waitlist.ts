import { Router } from "express";
import { asyncHandler } from "../middleware/errorHandler";
import { requireAuth, requireRole } from "../middleware/auth";
import { joinWaitlistSchema, waitlistCountQuerySchema } from "../schemas";
import { resolveDoctorScope } from "../lib/scope";
import { writeAuditLog } from "../lib/audit";
import { todayKey } from "../lib/dates";
import { claimOffer, declineOffer, fullyBookedDays, joinWaitlist, leaveWaitlist, myWaitlist, waitingCount } from "../lib/waitlist";

/**
 * Patient routes are scoped to the account holder in the token (their own
 * and their family's entries); another account's entry or offer is a 404.
 * Staff get only a count, never who is waiting.
 */
export const waitlistRouter = Router();

/** Days the doctor is fully booked, which can be waitlisted. */
waitlistRouter.get(
  "/waitlist/doctors/:doctorId/full-days",
  requireAuth,
  requireRole("PATIENT"),
  asyncHandler(async (req, res) => {
    res.json({ dates: await fullyBookedDays(req.params.doctorId) });
  })
);

waitlistRouter.get(
  "/waitlist/mine",
  requireAuth,
  requireRole("PATIENT"),
  asyncHandler(async (req, res) => {
    res.json({ entries: await myWaitlist(req.auth!.profileId) });
  })
);

waitlistRouter.post(
  "/waitlist",
  requireAuth,
  requireRole("PATIENT"),
  asyncHandler(async (req, res) => {
    const body = joinWaitlistSchema.parse(req.body);
    const entry = await joinWaitlist({ holderId: req.auth!.profileId, ...body });
    res.status(201).json({ entry: { id: entry.id, doctorId: entry.doctorId, date: entry.date, status: entry.status } });
  })
);

waitlistRouter.post(
  "/waitlist/:id/leave",
  requireAuth,
  requireRole("PATIENT"),
  asyncHandler(async (req, res) => {
    await leaveWaitlist(req.auth!.profileId, req.params.id);
    res.json({ ok: true });
  })
);

/** Claim an offered slot: creates a booking awaiting payment (pay as usual next). */
waitlistRouter.post(
  "/waitlist/offers/:id/claim",
  requireAuth,
  requireRole("PATIENT"),
  asyncHandler(async (req, res) => {
    const appointment = await claimOffer(req.auth!.profileId, req.auth!.userId, req.params.id);
    res.status(201).json({ appointment });
  })
);

waitlistRouter.post(
  "/waitlist/offers/:id/decline",
  requireAuth,
  requireRole("PATIENT"),
  asyncHandler(async (req, res) => {
    await declineOffer(req.auth!.profileId, req.params.id);
    res.json({ ok: true });
  })
);

/** Doctor and desk: how many are waiting for a day. Only a number; each view is audit-logged. */
waitlistRouter.get(
  "/doctors/:id/waitlist",
  requireAuth,
  requireRole("DOCTOR", "ASSOCIATE"),
  asyncHandler(async (req, res) => {
    const doctorId = await resolveDoctorScope(req.auth!, req.params.id);
    const { date = todayKey() } = waitlistCountQuerySchema.parse(req.query);
    const waiting = await waitingCount(doctorId, date);
    await writeAuditLog({
      actorUserId: req.auth!.userId,
      action: "STAFF_VIEWED_WAITLIST_COUNT",
      targetType: "DoctorDay",
      targetId: `${doctorId}:${date}`,
      metadata: { waiting },
    });
    res.json({ date, waiting });
  })
);
