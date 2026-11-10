import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

function toDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function main() {
  const password = await bcrypt.hash("password123", 10);

  const adminUser = await prisma.user.upsert({
    where: { phoneNumber: "+919800000001" },
    update: {},
    create: {
      phoneNumber: "+919800000001",
      passwordHash: password,
      role: "ADMIN",
      admin: { create: { fullName: "Pilot Clinic Admin" } },
    },
    include: { admin: true },
  });

  let clinic = await prisma.clinic.findFirst({ where: { adminId: adminUser.admin!.id } });
  if (!clinic) {
    clinic = await prisma.clinic.create({
      data: {
        name: "Peppermint Family Clinic",
        address: "MG Road, Bengaluru",
        adminId: adminUser.admin!.id,
      },
    });
  }

  const doctorUser = await prisma.user.upsert({
    where: { phoneNumber: "+919800000002" },
    update: {},
    create: {
      phoneNumber: "+919800000002",
      passwordHash: password,
      role: "DOCTOR",
      doctor: {
        create: {
          clinicId: clinic.id,
          fullName: "Dr. Asha Mehta",
          specialization: "General Physician",
          consultationFee: 500,
          avgConsultMinutes: 12,
          bio: "15 years of general practice.",
        },
      },
    },
    include: { doctor: true },
  });

  const associateUser = await prisma.user.upsert({
    where: { phoneNumber: "+919800000003" },
    update: {},
    create: {
      phoneNumber: "+919800000003",
      passwordHash: password,
      role: "ASSOCIATE",
      associate: {
        create: {
          clinicId: clinic.id,
          assignedDoctors: { create: [{ doctorId: doctorUser.doctor!.id }] },
        },
      },
    },
    include: { associate: true },
  });

  await prisma.user.upsert({
    where: { phoneNumber: "+919800000004" },
    update: {},
    create: {
      phoneNumber: "+919800000004",
      role: "PATIENT",
      patient: { create: { fullName: "Rahul Sharma", consentAt: new Date() } },
    },
  });

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const slotDate = toDateKey(today);

  for (let hour = 10; hour < 18; hour++) {
    const startsAt = new Date(today);
    startsAt.setUTCHours(hour, 0, 0, 0);
    const endsAt = new Date(startsAt.getTime() + 15 * 60 * 1000);
    const exists = await prisma.slot.findFirst({ where: { doctorId: doctorUser.doctor!.id, startsAt } });
    if (!exists) {
      await prisma.slot.create({ data: { doctorId: doctorUser.doctor!.id, startsAt, endsAt, slotDate } });
    }
  }

  console.log("Seed complete:");
  console.log("  Admin login:     +919800000001 / password123");
  console.log("  Doctor login:    +919800000002 / password123");
  console.log("  Associate login: +919800000003 / password123");
  console.log("  Patient phone:   +919800000004 (OTP is 123456 in stub mode)");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
