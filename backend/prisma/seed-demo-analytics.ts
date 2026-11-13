/**
 * DEMO DATA for admin analytics: about 3 months of synthetic history in a
 * separate clinic, "[DEMO DATA] Analytics Demo Clinic", owned by the dev admin
 * (+919800000001). Six doctors and 400 patients, all fake: doctor and patient
 * phone numbers start +917000 and nobody can log in as them.
 *
 *   npm run seed:demo           # add it (refuses if it is already there)
 *   npm run seed:demo:remove    # delete every row it created
 *
 * Never run against production: it refuses when NODE_ENV=production.
 */
import { randomUUID } from "crypto";
import type { AppointmentStatus, Prisma } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { addDays, istDateTime, todayKey, weekdayOf } from "../src/lib/dates";

export const DEMO_CLINIC_NAME = "[DEMO DATA] Analytics Demo Clinic";
const DEMO_PHONE_PREFIX = "+917000";
const HISTORY_DAYS = 92;
const FUTURE_DAYS = 7;
const SLOT_MINUTES = 10;
const OPEN = "09:00";
const SLOTS_PER_DAY = 66; // 09:00 to 19:50

const DOCTORS = [
  { name: "Demo Dr. Kiran Rao", specialization: "General Physician", fee: 400, consult: 9, noShow: 0.07 },
  { name: "Demo Dr. Farah Siddiqui", specialization: "Pediatrician", fee: 500, consult: 12, noShow: 0.1 },
  { name: "Demo Dr. Vikram Joshi", specialization: "Dermatologist", fee: 700, consult: 15, noShow: 0.14 },
  { name: "Demo Dr. Lakshmi Pillai", specialization: "Gynecologist", fee: 800, consult: 18, noShow: 0.06 },
  { name: "Demo Dr. Arjun Mehra", specialization: "Orthopedic", fee: 650, consult: 14, noShow: 0.12 },
  { name: "Demo Dr. Neel Banerjee", specialization: "ENT", fee: 450, consult: 8, noShow: 0.16 },
];

// A fixed seed, so every run creates the same history.
let state = 20261113;
const rand = () => ((state = (state * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
/** Roughly normal (sum of uniforms), clamped to stay positive. */
const around = (mean: number, spread: number) => Math.max(1.5, mean + (rand() + rand() + rand() - 1.5) * spread);

/** Chance a slot is booked, by IST hour: busy late mornings and evenings, quiet after lunch. */
function demand(hour: number, weekday: number): number {
  const base = hour >= 10 && hour < 12 ? 0.9 : hour >= 17 && hour < 20 ? 0.85 : hour >= 13 && hour < 15 ? 0.4 : 0.6;
  return weekday === 6 ? base * 0.6 : base; // Saturday is lighter; Sunday the clinic is closed
}

async function chunked<T>(rows: T[], insert: (batch: T[]) => Promise<unknown>, size = 5000) {
  for (let i = 0; i < rows.length; i += size) await insert(rows.slice(i, i + size));
}

async function add() {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to add demo data in production");
  const admin = await prisma.admin.findFirst({ where: { user: { phoneNumber: "+919800000001" } } });
  if (!admin) throw new Error("Dev admin +919800000001 not found: run `npm run seed` first");
  if (await prisma.clinic.findFirst({ where: { name: DEMO_CLINIC_NAME } })) {
    throw new Error("Demo data is already there. Remove it first: npm run seed:demo:remove");
  }
  const clinic = await prisma.clinic.create({ data: { name: DEMO_CLINIC_NAME, address: "Demo data: not a real clinic", adminId: admin.id } });

  const doctors = [];
  for (const [i, d] of DOCTORS.entries()) {
    const user = await prisma.user.create({
      data: {
        phoneNumber: `${DEMO_PHONE_PREFIX}00000${i + 1}`.padEnd(13, "0"),
        role: "DOCTOR",
        passwordHash: null, // nobody can log in as a demo doctor
        doctor: {
          create: {
            clinicId: clinic.id,
            fullName: d.name,
            specialization: d.specialization,
            consultationFee: d.fee,
            avgConsultMinutes: d.consult,
            registrationNumber: `DEMO-${i + 1}`,
            registrationCouncil: "Demo data",
            verificationStatus: "APPROVED",
          },
        },
      },
      include: { doctor: true },
    });
    doctors.push({ ...d, id: user.doctor!.id });
  }

  const users: Prisma.UserCreateManyInput[] = [];
  const patients: Prisma.PatientCreateManyInput[] = [];
  for (let i = 0; i < 400; i++) {
    const userId = randomUUID();
    users.push({ id: userId, phoneNumber: `${DEMO_PHONE_PREFIX}1${String(i).padStart(5, "0")}`, role: "PATIENT" });
    patients.push({ id: randomUUID(), userId, fullName: `Demo Patient ${i + 1}`, consentAt: new Date(), consentSource: "demo" });
  }
  await prisma.user.createMany({ data: users });
  await prisma.patient.createMany({ data: patients });

  const slots: Prisma.SlotCreateManyInput[] = [];
  const appointments: Prisma.AppointmentCreateManyInput[] = [];
  const payments: Prisma.PaymentCreateManyInput[] = [];
  const refunds: Prisma.RefundCreateManyInput[] = [];
  const today = todayKey();
  const now = Date.now();

  for (let offset = -HISTORY_DAYS; offset <= FUTURE_DAYS; offset++) {
    if (offset === 0) continue; // leave today alone
    const date = addDays(today, offset);
    const weekday = weekdayOf(date) === 0 ? 7 : weekdayOf(date); // ISO: 1 = Monday ... 7 = Sunday
    if (weekday === 7) continue;
    for (const d of doctors) {
      for (let n = 0; n < SLOTS_PER_DAY; n++) {
        const startsAt = new Date(istDateTime(date, OPEN).getTime() + n * SLOT_MINUTES * 60_000);
        const slotId = randomUUID();
        const hour = 9 + Math.floor((n * SLOT_MINUTES) / 60);
        const booked = rand() < demand(hour, weekday);
        slots.push({ id: slotId, doctorId: d.id, startsAt, endsAt: new Date(startsAt.getTime() + SLOT_MINUTES * 60_000), slotDate: date, isBooked: false });
        if (!booked) continue;

        const past = startsAt.getTime() < now;
        const r = rand();
        const status: AppointmentStatus = !past ? "BOOKED" : r < 0.1 ? "CANCELLED" : r < 0.1 + d.noShow ? "NO_SHOW" : "COMPLETED";
        if (status !== "CANCELLED") slots[slots.length - 1].isBooked = true;
        const bookedAt = new Date(startsAt.getTime() - Math.floor(rand() * 7 * 24 + 1) * 3_600_000);
        const walkIn = past && status !== "CANCELLED" && rand() < 0.15;
        let calledAt: Date | null = null;
        let completedAt: Date | null = null;
        if (status === "COMPLETED") {
          calledAt = new Date(startsAt.getTime() + Math.floor(rand() * 25) * 60_000);
          const outlier = rand();
          const minutes = outlier < 0.005 ? 0.3 : outlier < 0.01 ? 150 : around(d.consult, d.consult * 0.6);
          completedAt = new Date(calledAt.getTime() + minutes * 60_000);
        }
        const appointmentId = randomUUID();
        appointments.push({
          id: appointmentId,
          patientId: pick(patients).id!,
          doctorId: d.id,
          slotId,
          status,
          isWalkIn: walkIn,
          queueToken: status === "CANCELLED" ? null : n + 1,
          queueDate: date,
          createdAt: walkIn ? startsAt : bookedAt,
          checkedInAt: status === "COMPLETED" ? startsAt : null,
          calledAt,
          completedAt,
          cancelledAt: status === "CANCELLED" ? new Date(Math.min(startsAt.getTime() - 3_600_000, bookedAt.getTime() + 86_400_000)) : null,
          cancelReason: status === "CANCELLED" ? "Demo data" : null,
        });

        const paymentId = randomUUID();
        const paidAt = walkIn ? startsAt : new Date(bookedAt.getTime() + 2 * 60_000);
        const refunded = status === "CANCELLED" && rand() < 0.6; // the rest cancelled too late for a refund
        payments.push({
          id: paymentId,
          appointmentId,
          amount: d.fee,
          method: walkIn ? "DESK" : "ONLINE",
          status: refunded ? "REFUNDED" : "PAID",
          gatewayRef: walkIn ? null : `pay_demo_${paymentId.slice(0, 18)}`,
          gatewayOrderId: walkIn ? null : `order_demo_${paymentId.slice(0, 18)}`,
          paidAt,
          createdAt: paidAt,
        });
        if (refunded) refunds.push({ paymentId, amount: d.fee, status: "PROCESSED", gatewayRef: `rfnd_demo_${paymentId.slice(0, 18)}`, createdAt: new Date(paidAt.getTime() + 86_400_000) });
      }
    }
  }

  await chunked(slots, (b) => prisma.slot.createMany({ data: b }));
  await chunked(appointments, (b) => prisma.appointment.createMany({ data: b }));
  await chunked(payments, (b) => prisma.payment.createMany({ data: b }));
  await chunked(refunds, (b) => prisma.refund.createMany({ data: b }));
  console.log(`Demo data added to "${DEMO_CLINIC_NAME}": ${doctors.length} doctors, ${patients.length} patients, ${slots.length} slots, ${appointments.length} appointments, ${payments.length} payments, ${refunds.length} refunds.`);
  console.log("Remove it with: npm run seed:demo:remove");
}

async function remove() {
  const clinic = await prisma.clinic.findFirst({ where: { name: DEMO_CLINIC_NAME } });
  if (!clinic) {
    console.log("No demo data found.");
    return;
  }
  const doctorIds = (await prisma.doctor.findMany({ where: { clinicId: clinic.id }, select: { id: true } })).map((d) => d.id);
  const demoPatients = { user: { phoneNumber: { startsWith: DEMO_PHONE_PREFIX } } };
  const forDoctors = { appointment: { doctorId: { in: doctorIds } } };
  await prisma.$transaction(
    [
      prisma.refund.deleteMany({ where: { payment: forDoctors } }),
      prisma.payment.deleteMany({ where: forDoctors }),
      prisma.qrToken.deleteMany({ where: forDoctors }),
      prisma.waitlistOffer.deleteMany({ where: { entry: { doctorId: { in: doctorIds } } } }),
      prisma.waitlistEntry.deleteMany({ where: { doctorId: { in: doctorIds } } }),
      prisma.notification.deleteMany({ where: { OR: [{ patient: demoPatients }, { user: { phoneNumber: { startsWith: DEMO_PHONE_PREFIX } } }] } }),
      prisma.appointment.deleteMany({ where: { doctorId: { in: doctorIds } } }),
      prisma.slotAlert.deleteMany({ where: { doctorId: { in: doctorIds } } }),
      prisma.slot.deleteMany({ where: { doctorId: { in: doctorIds } } }),
      prisma.clinicDay.deleteMany({ where: { doctorId: { in: doctorIds } } }),
      prisma.displayLink.deleteMany({ where: { doctorId: { in: doctorIds } } }),
      prisma.associateDoctor.deleteMany({ where: { doctorId: { in: doctorIds } } }),
      prisma.doctor.deleteMany({ where: { id: { in: doctorIds } } }),
      prisma.patient.deleteMany({ where: demoPatients }),
      prisma.user.deleteMany({ where: { phoneNumber: { startsWith: DEMO_PHONE_PREFIX } } }),
      prisma.clinic.delete({ where: { id: clinic.id } }),
    ]
  );
  console.log(`Removed "${DEMO_CLINIC_NAME}" and all its demo doctors, patients, slots, appointments and payments.`);
}

(process.argv.includes("--remove") ? remove() : add())
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
