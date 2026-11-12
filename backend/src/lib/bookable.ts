import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { HttpError } from "../middleware/errorHandler";

/**
 * Patients only see and book doctors who are active and whose medical
 * registration the clinic admin has approved.
 */
export const BOOKABLE_DOCTOR: Prisma.DoctorWhereInput = { isActive: true, verificationStatus: "APPROVED" };

export async function assertDoctorBookable(
  doctorId: string,
  db: Prisma.TransactionClient | typeof prisma = prisma
): Promise<void> {
  const ok = await db.doctor.count({ where: { id: doctorId, ...BOOKABLE_DOCTOR } });
  if (!ok) throw new HttpError(409, "This doctor is not taking bookings right now");
}
