import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma";
import { signAccessToken } from "../lib/jwt";

let counter = 0;
function uniquePhone(): string {
  counter += 1;
  return `+9198${String(9000000 + counter).padStart(7, "0")}`;
}

export async function createClinicWithAdmin() {
  const phone = uniquePhone();
  const user = await prisma.user.create({
    data: {
      phoneNumber: phone,
      passwordHash: await bcrypt.hash("password123", 10),
      role: "ADMIN",
      admin: { create: { fullName: "Test Admin" } },
    },
    include: { admin: true },
  });
  const clinic = await prisma.clinic.create({
    data: { name: "Test Clinic", address: "Test Address", adminId: user.admin!.id },
  });
  const token = signAccessToken({ userId: user.id, role: "ADMIN", profileId: user.admin!.id });
  return { user, clinic, token };
}

export async function createDoctor(clinicId: string, overrides: Partial<{ consultationFee: number }> = {}) {
  const phone = uniquePhone();
  const user = await prisma.user.create({
    data: {
      phoneNumber: phone,
      passwordHash: await bcrypt.hash("password123", 10),
      role: "DOCTOR",
      doctor: {
        create: {
          clinicId,
          fullName: "Dr. Test",
          specialization: "General",
          consultationFee: overrides.consultationFee ?? 500,
          avgConsultMinutes: 10,
        },
      },
    },
    include: { doctor: true },
  });
  const token = signAccessToken({ userId: user.id, role: "DOCTOR", profileId: user.doctor!.id });
  return { user, doctor: user.doctor!, token };
}

export async function createAssociate(clinicId: string, doctorIds: string[]) {
  const phone = uniquePhone();
  const user = await prisma.user.create({
    data: {
      phoneNumber: phone,
      passwordHash: await bcrypt.hash("password123", 10),
      role: "ASSOCIATE",
      associate: {
        create: { clinicId, assignedDoctors: { create: doctorIds.map((doctorId) => ({ doctorId })) } },
      },
    },
    include: { associate: true },
  });
  const token = signAccessToken({ userId: user.id, role: "ASSOCIATE", profileId: user.associate!.id });
  return { user, associate: user.associate!, token };
}

export async function createPatient() {
  const phone = uniquePhone();
  const user = await prisma.user.create({
    data: { phoneNumber: phone, role: "PATIENT", patient: { create: { fullName: "Test Patient", consentAt: new Date() } } },
    include: { patient: true },
  });
  const token = signAccessToken({ userId: user.id, role: "PATIENT", profileId: user.patient!.id });
  return { user, patient: user.patient!, token };
}

export async function createFutureSlot(doctorId: string, hoursFromNow = 2) {
  const startsAt = new Date(Date.now() + hoursFromNow * 3_600_000);
  const endsAt = new Date(startsAt.getTime() + 15 * 60_000);
  return prisma.slot.create({
    data: { doctorId, startsAt, endsAt, slotDate: startsAt.toISOString().slice(0, 10) },
  });
}
