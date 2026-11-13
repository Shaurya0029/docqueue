import { describe, it, expect } from "vitest";
import { createApp } from "../app";
import { prisma } from "../lib/prisma";
import { redis, nowServingKey } from "../lib/redis";
import { addDays, todayKey } from "../lib/dates";
import { setNowServing } from "../lib/queueService";
import { releaseExpiredHolds } from "../jobs/releaseExpiredHolds";
import { closePastDays } from "../jobs/closePastDays";
import { createClinicWithAdmin, createDoctor, createPatient, createSlotAt, createFutureSlot } from "./factories";
import { book, bookAndPay } from "./paymentHelpers";

const app = createApp();

describe("slot hold expiry", () => {
  it("keeps an unpaid hold for 10 minutes and then frees the slot", async () => {
    const { clinic } = await createClinicWithAdmin();
    const { doctor } = await createDoctor(clinic.id);
    const patient = await createPatient();
    const slot = await createFutureSlot(doctor.id);
    const appointmentId = await book(app, patient.token, slot.id);

    await prisma.appointment.update({ where: { id: appointmentId }, data: { createdAt: new Date(Date.now() - 9 * 60_000) } });
    expect(await releaseExpiredHolds()).toBe(0);
    expect((await prisma.slot.findUniqueOrThrow({ where: { id: slot.id } })).isBooked).toBe(true);

    await prisma.appointment.update({ where: { id: appointmentId }, data: { createdAt: new Date(Date.now() - 11 * 60_000) } });
    expect(await releaseExpiredHolds()).toBe(1);
    expect((await prisma.slot.findUniqueOrThrow({ where: { id: slot.id } })).isBooked).toBe(false);
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } })).status).toBe("CANCELLED");
  });
});

describe("daily token reset", () => {
  it("starts every day's tokens at 1", async () => {
    const { clinic } = await createClinicWithAdmin();
    const { doctor } = await createDoctor(clinic.id);
    const day1 = addDays(todayKey(), 1);
    const day2 = addDays(todayKey(), 2);
    for (const day of [day1, day2]) {
      await createSlotAt(doctor.id, day, "10:00");
      await createSlotAt(doctor.id, day, "10:15");
    }
    const slots = await prisma.slot.findMany({ where: { doctorId: doctor.id }, orderBy: { startsAt: "asc" } });
    const tokens: number[] = [];
    for (const slot of slots) {
      const p = await createPatient();
      const { appointmentId } = await bookAndPay(app, p.token, slot.id);
      tokens.push((await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } })).queueToken!);
    }
    expect(tokens).toEqual([1, 2, 1, 2]);
  });

  it("closes past days: unattended bookings become no-shows and now-serving expires", async () => {
    const { clinic } = await createClinicWithAdmin();
    const { doctor } = await createDoctor(clinic.id);
    const patient = await createPatient();
    const slot = await createFutureSlot(doctor.id, 30);
    const { appointmentId } = await bookAndPay(app, patient.token, slot.id);
    const yesterday = addDays(todayKey(), -1);
    await prisma.appointment.update({ where: { id: appointmentId }, data: { queueDate: yesterday } });
    await prisma.clinicDay.create({ data: { doctorId: doctor.id, date: yesterday, status: "OPEN" } });
    const todays = await createFutureSlot(doctor.id, 1);
    const other = await createPatient();
    const { appointmentId: todayId } = await bookAndPay(app, other.token, todays.id);

    expect(await closePastDays()).toEqual({ noShows: 1, daysClosed: 1, waitlistsEnded: 0 });
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } })).status).toBe("NO_SHOW");
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: todayId } })).status).toBe("BOOKED"); // today untouched

    await setNowServing(doctor.id, todayKey(), 4);
    const ttl = await redis.ttl(nowServingKey(doctor.id, todayKey()));
    expect(ttl).toBeGreaterThan(24 * 3600);
    expect(ttl).toBeLessThanOrEqual(2 * 24 * 3600);
  });
});
