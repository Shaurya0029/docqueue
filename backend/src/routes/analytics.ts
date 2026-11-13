import { Router } from "express";
import { asyncHandler } from "../middleware/errorHandler";
import { requireAuth, requireRole } from "../middleware/auth";
import { analyticsQuerySchema } from "../schemas";
import { writeAuditLog } from "../lib/audit";
import { analyticsCsv, computeAnalytics } from "../lib/analytics";

/**
 * Admin analytics for the admin's own clinics only (aggregates, no patient
 * data). Every view and every export is audit-logged. Doctors keep their own
 * earnings page; they cannot reach these routes.
 */
export const analyticsRouter = Router();

analyticsRouter.get(
  "/admin/analytics",
  requireAuth,
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const filters = analyticsQuerySchema.parse(req.query);
    const analytics = await computeAnalytics(req.auth!.profileId, filters);
    await writeAuditLog({ actorUserId: req.auth!.userId, action: "ANALYTICS_VIEWED", targetType: "Analytics", targetId: req.auth!.profileId, metadata: { ...analytics.range, ...analytics.filters } });
    res.setHeader("Cache-Control", "no-store");
    res.json(analytics);
  })
);

analyticsRouter.get(
  "/admin/analytics/export.csv",
  requireAuth,
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const filters = analyticsQuerySchema.parse(req.query);
    const analytics = await computeAnalytics(req.auth!.profileId, filters);
    await writeAuditLog({ actorUserId: req.auth!.userId, action: "ANALYTICS_EXPORTED", targetType: "Analytics", targetId: req.auth!.profileId, metadata: { ...analytics.range, ...analytics.filters } });
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="medora-analytics-${analytics.range.from}-to-${analytics.range.to}.csv"`);
    res.setHeader("Cache-Control", "no-store");
    res.send(analyticsCsv(analytics));
  })
);
