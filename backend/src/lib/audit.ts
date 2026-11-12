import { prisma } from "./prisma";

export async function writeAuditLog(params: {
  actorUserId: string;
  action: string;
  targetType: string;
  targetId: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await prisma.auditLog.create({
    data: {
      actorUserId: params.actorUserId,
      action: params.action,
      targetType: params.targetType,
      targetId: params.targetId,
      metadata: params.metadata ? JSON.stringify(params.metadata) : null,
    },
  });
}

/** How often one staff member's repeated views of the same data are logged. */
export const STAFF_READ_AUDIT_WINDOW_SECONDS = 15 * 60;

/**
 * Records that a staff member viewed patient data (a queue, a schedule).
 * Those screens refresh on every queue event, so each actor's view of the
 * same resource is logged at most once per 15 minutes, with the patients
 * shown. The throttle lives in Redis so it holds across API instances.
 */
export async function auditStaffRead(params: {
  actorUserId: string;
  action: string;
  targetType: string;
  targetId: string;
  patientIds: string[];
  metadata?: Record<string, unknown>;
}): Promise<void> {
  if (params.patientIds.length === 0) return; // nothing personal was shown
  const { redis } = await import("./redis");
  const key = `audit:read:${params.actorUserId}:${params.action}:${params.targetId}`;
  const first = await redis.set(key, "1", "EX", STAFF_READ_AUDIT_WINDOW_SECONDS, "NX");
  if (first !== "OK") return;
  await writeAuditLog({
    actorUserId: params.actorUserId,
    action: params.action,
    targetType: params.targetType,
    targetId: params.targetId,
    metadata: { ...params.metadata, patientIds: [...new Set(params.patientIds)] },
  });
}
