import { beforeEach } from "vitest";
import { prisma } from "../lib/prisma";
import { redis } from "../lib/redis";

// Order matters: children before parents, respecting FK constraints.
const TABLES = [
  "AuditLog",
  "Notification",
  "Refund",
  "QrToken",
  "Payment",
  "Appointment",
  "ClinicDay",
  "Slot",
  "AssociateDoctor",
  "Associate",
  "Doctor",
  "Clinic",
  "Admin",
  "Patient",
  "User",
];

export async function resetDb(): Promise<void> {
  for (const table of TABLES) {
    await prisma.$executeRawUnsafe(`DELETE FROM "${table}"`);
  }
}

beforeEach(async () => {
  await resetDb();
  if (!/\/2$/.test(process.env.REDIS_URL ?? "")) throw new Error("Tests must use Redis database 2");
  await redis.flushdb();
});
