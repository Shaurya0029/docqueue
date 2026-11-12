import bcrypt from "bcryptjs";
import Redis from "ioredis";
import { seed, seedPrisma as prisma } from "./seed";
import { toDateKey } from "../src/lib/dates";

/**
 * Seed for the Playwright journey (e2e/), run against the throwaway
 * docqueue_e2e database. On top of the demo seed it adds a doctor with a
 * single slot starting a few minutes from now, so the journey can run on
 * today's queue at any hour and on any day of the week.
 */
export const E2E_DOCTOR = { phone: "+919800000008", fullName: "Dr. Kavya Menon", specialization: "ENT Specialist" };

async function main() {
  if (!process.env.DATABASE_URL?.includes("docqueue_e2e")) {
    throw new Error("e2e-seed only runs against the docqueue_e2e database");
  }
  // Start from an empty Redis database too: OTP rate limits and queue state
  // from earlier runs would otherwise leak in (5 OTPs per phone per hour).
  const redisUrl = process.env.REDIS_URL ?? "";
  if (!redisUrl.endsWith("/1")) throw new Error("e2e-seed expects its own Redis database (redis://.../1)");
  const redis = new Redis(redisUrl);
  await redis.flushdb();
  await redis.quit();

  await seed();

  const clinic = await prisma.clinic.findFirstOrThrow({ where: { name: "Peppermint Family Clinic" } });
  const user = await prisma.user.create({
    data: {
      phoneNumber: E2E_DOCTOR.phone,
      passwordHash: await bcrypt.hash("password123", 10),
      role: "DOCTOR",
      doctor: {
        create: {
          clinicId: clinic.id,
          fullName: E2E_DOCTOR.fullName,
          specialization: E2E_DOCTOR.specialization,
          consultationFee: 600,
          avgConsultMinutes: 10,
          registrationNumber: "KMC-90001",
          registrationCouncil: "Karnataka Medical Council",
          verificationStatus: "APPROVED",
        },
      },
    },
    include: { doctor: true },
  });
  const associate = await prisma.associate.findFirstOrThrow({ where: { user: { phoneNumber: "+919800000003" } } });
  await prisma.associateDoctor.create({ data: { associateId: associate.id, doctorId: user.doctor!.id } });

  const startsAt = new Date(Date.now() + 5 * 60_000);
  startsAt.setSeconds(0, 0);
  await prisma.slot.create({
    data: { doctorId: user.doctor!.id, startsAt, endsAt: new Date(startsAt.getTime() + 15 * 60_000), slotDate: toDateKey(startsAt) },
  });
  console.log(`e2e seed: ${E2E_DOCTOR.fullName} has one slot at ${startsAt.toISOString()}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
