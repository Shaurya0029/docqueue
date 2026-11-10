import { prisma } from "./prisma";
import { HttpError } from "../middleware/errorHandler";
import type { JwtPayload } from "./jwt";

/**
 * Every clinic-floor and doctor-settings route takes the doctorId scope from
 * the JWT's role + profileId, never trusting the :id in the URL beyond using
 * it as a lookup key. This is the single place that enforces "doctor A can
 * never read doctor B's data".
 */
export async function assertDoctorAccess(auth: JwtPayload, doctorId: string): Promise<void> {
  if (auth.role === "DOCTOR") {
    if (auth.profileId !== doctorId) throw new HttpError(403, "Not your doctor profile");
    return;
  }
  if (auth.role === "ASSOCIATE") {
    const link = await prisma.associateDoctor.findFirst({
      where: { associateId: auth.profileId, doctorId },
    });
    if (!link) throw new HttpError(403, "Doctor not assigned to this associate");
    return;
  }
  if (auth.role === "ADMIN") {
    const doctor = await prisma.doctor.findUnique({ where: { id: doctorId } });
    if (!doctor) throw new HttpError(404, "Doctor not found");
    const clinic = await prisma.clinic.findUnique({ where: { id: doctor.clinicId } });
    if (!clinic || clinic.adminId !== auth.profileId) throw new HttpError(403, "Doctor not in your clinics");
    return;
  }
  throw new HttpError(403, "Forbidden for this role");
}

export async function assertClinicAccess(auth: JwtPayload, clinicId: string): Promise<void> {
  if (auth.role !== "ADMIN") throw new HttpError(403, "Forbidden for this role");
  const clinic = await prisma.clinic.findUnique({ where: { id: clinicId } });
  if (!clinic) throw new HttpError(404, "Clinic not found");
  if (clinic.adminId !== auth.profileId) throw new HttpError(403, "Not your clinic");
}
