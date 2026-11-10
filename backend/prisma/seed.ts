import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { addDays, todayKey } from "../src/lib/dates";
import { generateSlots } from "../src/lib/slots";

/**
 * Demo seed. Safe to run repeatedly: every record is upserted and slots are
 * created with skipDuplicates against the (doctorId, startsAt) unique index.
 */
const prisma = new PrismaClient();

const SLOT_DAYS = 14;
const WEEKDAY_PATTERN = [1, 2, 3, 4, 5].map((weekday) => ({
  weekday,
  startTime: "10:00",
  endTime: "17:00",
  slotMinutes: 15,
}));

const DOCTORS = [
  {
    phone: "+919800000002",
    fullName: "Dr. Asha Mehta",
    specialization: "General Physician",
    consultationFee: 500,
    avgConsultMinutes: 12,
    bio: "15 years of general practice.",
  },
  {
    phone: "+919800000005",
    fullName: "Dr. Rohan Iyer",
    specialization: "Pediatrician",
    consultationFee: 700,
    avgConsultMinutes: 15,
    bio: "Child health and vaccinations, 10 years in practice.",
  },
  {
    phone: "+919800000006",
    fullName: "Dr. Neha Rao",
    specialization: "Dermatologist",
    consultationFee: 800,
    avgConsultMinutes: 10,
    bio: "Skin, hair and nail care, 8 years in practice.",
  },
];

const PATIENTS = [
  { phone: "+919800000004", fullName: "Rahul Sharma" },
  { phone: "+919800000007", fullName: "Priya Nair" },
];

/**
 * Removes the "Dr. Test / Test Clinic" rows an early test run left in the
 * dev database. Test-factory users have 11-digit numbers starting +91989,
 * which no real Indian mobile number has, so real data is never touched.
 */
async function removeLeftoverTestData(): Promise<void> {
  const testUsers = await prisma.user.findMany({
    where: { phoneNumber: { startsWith: "+91989" } },
    select: { id: true, phoneNumber: true },
  });
  const testUserIds = testUsers.filter((u) => u.phoneNumber.length === 12).map((u) => u.id);
  const testClinics = await prisma.clinic.findMany({ where: { name: "Test Clinic" }, select: { id: true } });
  const clinicIds = testClinics.map((c) => c.id);
  if (testUserIds.length === 0 && clinicIds.length === 0) return;

  const doctors = await prisma.doctor.findMany({
    where: { OR: [{ clinicId: { in: clinicIds } }, { userId: { in: testUserIds } }] },
    select: { id: true },
  });
  const doctorIds = doctors.map((d) => d.id);
  const patients = await prisma.patient.findMany({ where: { userId: { in: testUserIds } }, select: { id: true } });
  const patientIds = patients.map((p) => p.id);

  const appointmentWhere = { OR: [{ doctorId: { in: doctorIds } }, { patientId: { in: patientIds } }] };
  const appointmentIds = (await prisma.appointment.findMany({ where: appointmentWhere, select: { id: true } })).map((a) => a.id);
  const paymentIds = (await prisma.payment.findMany({ where: { appointmentId: { in: appointmentIds } }, select: { id: true } })).map((p) => p.id);

  await prisma.$transaction([
    prisma.refund.deleteMany({ where: { paymentId: { in: paymentIds } } }),
    prisma.payment.deleteMany({ where: { id: { in: paymentIds } } }),
    prisma.qrToken.deleteMany({ where: { appointmentId: { in: appointmentIds } } }),
    prisma.appointment.deleteMany({ where: { id: { in: appointmentIds } } }),
    prisma.slot.deleteMany({ where: { doctorId: { in: doctorIds } } }),
    prisma.clinicDay.deleteMany({ where: { doctorId: { in: doctorIds } } }),
    prisma.associateDoctor.deleteMany({ where: { doctorId: { in: doctorIds } } }),
    prisma.doctor.deleteMany({ where: { id: { in: doctorIds } } }),
    prisma.associateDoctor.deleteMany({ where: { associate: { clinicId: { in: clinicIds } } } }),
    prisma.associate.deleteMany({ where: { OR: [{ clinicId: { in: clinicIds } }, { userId: { in: testUserIds } }] } }),
    prisma.clinic.deleteMany({ where: { id: { in: clinicIds } } }),
    prisma.admin.deleteMany({ where: { userId: { in: testUserIds } } }),
    prisma.patient.deleteMany({ where: { id: { in: patientIds } } }),
    prisma.auditLog.deleteMany({ where: { actorUserId: { in: testUserIds } } }),
    prisma.notification.deleteMany({ where: { userId: { in: testUserIds } } }),
    prisma.user.deleteMany({ where: { id: { in: testUserIds } } }),
  ]);
  console.log(`Removed leftover test data: ${clinicIds.length} clinic(s), ${doctorIds.length} doctor(s), ${testUserIds.length} user(s)`);
}

async function main() {
  await removeLeftoverTestData();
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
      data: { name: "Peppermint Family Clinic", address: "MG Road, Bengaluru", adminId: adminUser.admin!.id },
    });
  }

  const doctorIds: string[] = [];
  for (const d of DOCTORS) {
    const profile = {
      fullName: d.fullName,
      specialization: d.specialization,
      consultationFee: d.consultationFee,
      avgConsultMinutes: d.avgConsultMinutes,
      bio: d.bio,
    };
    const user = await prisma.user.upsert({
      where: { phoneNumber: d.phone },
      update: {},
      create: { phoneNumber: d.phone, passwordHash: password, role: "DOCTOR", doctor: { create: { clinicId: clinic.id, ...profile } } },
      include: { doctor: true },
    });
    doctorIds.push(user.doctor!.id);
  }

  const associateUser = await prisma.user.upsert({
    where: { phoneNumber: "+919800000003" },
    update: {},
    create: { phoneNumber: "+919800000003", passwordHash: password, role: "ASSOCIATE", associate: { create: { clinicId: clinic.id } } },
    include: { associate: true },
  });
  for (const doctorId of doctorIds) {
    await prisma.associateDoctor.upsert({
      where: { associateId_doctorId: { associateId: associateUser.associate!.id, doctorId } },
      update: {},
      create: { associateId: associateUser.associate!.id, doctorId },
    });
  }

  for (const p of PATIENTS) {
    await prisma.user.upsert({
      where: { phoneNumber: p.phone },
      update: {},
      create: { phoneNumber: p.phone, role: "PATIENT", patient: { create: { fullName: p.fullName, consentAt: new Date() } } },
    });
  }

  const from = todayKey();
  const to = addDays(from, SLOT_DAYS - 1);
  let created = 0;
  for (const doctorId of doctorIds) {
    const slots = generateSlots(doctorId, from, to, WEEKDAY_PATTERN);
    created += (await prisma.slot.createMany({ data: slots, skipDuplicates: true })).count;
  }

  console.log(`Seed complete (${created} new slots, ${from} to ${to}, Mon-Fri 10:00-17:00 IST, 15 min):`);
  console.log("  Admin login:     +919800000001 / password123");
  console.log("  Doctor logins:   +919800000002 (General Physician), +919800000005 (Pediatrician),");
  console.log("                   +919800000006 (Dermatologist) / password123");
  console.log("  Associate login: +919800000003 / password123 (assigned to all three doctors)");
  console.log("  Patient phones:  +919800000004, +919800000007 (OTP is 123456 in stub mode)");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
