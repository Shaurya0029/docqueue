import { beforeEach } from "vitest";
import { prisma } from "../lib/prisma";

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
});
