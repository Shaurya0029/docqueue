import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../app";
import { prisma } from "../lib/prisma";
import { toDateKey } from "../lib/dates";
import { averageConsultMinutes } from "../lib/waitTime";
import { createClinicWithAdmin, createDoctor, createPatient, createSlotSoon } from "./factories";
import { bookAndPay } from "./paymentHelpers";

const app = createApp();
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
let slotOffset = 0;

/**
 * Past consultations for a doctor, oldest first: each `minutes` value is one
 * visit's called-to-completed time. Later entries finished more recently.
 */
async function history(doctorId: string, minutes: number[], status: "COMPLETED" | "NO_SHOW" = "COMPLETED") {
  const { patient } = await createPatient();
  const base = Date.now() - 30 * 86_400_000;
  for (const [i, m] of minutes.entries()) {
    const startsAt = new Date(base - 86_400_000 + (slotOffset += 1) * 60_000);
    const slot = await prisma.slot.create({
      data: { doctorId, startsAt, endsAt: new Date(startsAt.getTime() + 15 * 60_000), slotDate: toDateKey(startsAt), isBooked: true },
    });
    const calledAt = new Date(base + i * 3_600_000);
    await prisma.appointment.create({
      data: {
        patientId: patient.id,
        doctorId,
        slotId: slot.id,
        status,
        calledAt: status === "COMPLETED" ? calledAt : null,
        completedAt: status === "COMPLETED" ? new Date(calledAt.getTime() + m * 60_000) : null,
      },
    });
  }
}

async function doctor(configuredMinutes = 10) {
  const { clinic } = await createClinicWithAdmin();
  const { doctor, token } = await createDoctor(clinic.id);
  await prisma.doctor.update({ where: { id: doctor.id }, data: { avgConsultMinutes: configuredMinutes } });
  return { doctor, token };
}

describe("average consultation time", () => {
  it("falls back to the configured average with no history", async () => {
    const { doctor: d } = await doctor(12);
    expect(await averageConsultMinutes(d.id)).toEqual({ minutes: 12, basis: "configured", sampleSize: 0 });
  });

  it("falls back while there are fewer than 5 real consultations", async () => {
    const { doctor: d } = await doctor(12);
    await history(d.id, [4, 4, 4, 4]);
    expect(await averageConsultMinutes(d.id)).toEqual({ minutes: 12, basis: "configured", sampleSize: 4 });
  });

  it("uses the mean of the last 20 real consultations only", async () => {
    const { doctor: d } = await doctor(12);
    // 5 old 30-minute visits, then 20 recent 6-minute ones: only the recent 20 count.
    await history(d.id, [...Array(5).fill(30), ...Array(20).fill(6)]);
    expect(await averageConsultMinutes(d.id)).toEqual({ minutes: 6, basis: "history", sampleSize: 20 });
  });

  it("ignores mis-taps and consultations nobody closed, and still finds 20 real ones", async () => {
    const { doctor: d } = await doctor(12);
    await history(d.id, [...Array(20).fill(8), 0.2, 300, 0.5, 600]); // the 4 most recent are not real
    expect(await averageConsultMinutes(d.id)).toEqual({ minutes: 8, basis: "history", sampleSize: 20 });
  });

  it("averages varied durations, ignoring no-shows and other doctors", async () => {
    const { doctor: d } = await doctor(12);
    const { doctor: other } = await doctor(12);
    await history(d.id, [5, 7, 9, 11, 13]);
    await history(d.id, [0, 0, 0], "NO_SHOW");
    await history(other.id, Array(20).fill(40));
    expect(await averageConsultMinutes(d.id)).toEqual({ minutes: 9, basis: "history", sampleSize: 5 });
  });
});

describe("patient's estimated wait", () => {
  it("is patients ahead x the doctor's real average, and says what it is based on", async () => {
    const { doctor: d } = await doctor(10);
    await history(d.id, [7, 8, 9, 7, 8, 9]); // mean 8
    const patients = [];
    for (let i = 0; i < 4; i++) {
      const p = await createPatient();
      const { appointmentId } = await bookAndPay(app, p.token, (await createSlotSoon(d.id, 10 + i)).id);
      patients.push({ ...p, appointmentId });
    }
    const last = patients[3];
    const res = await request(app).get(`/appointments/${last.appointmentId}/queue-status`).set(auth(last.token));
    expect(res.body).toMatchObject({
      patientsAhead: 3,
      averageConsultMinutes: 8,
      estimateBasis: "history",
      estimateSampleSize: 6,
      estimatedWaitMinutes: 24,
    });

    // One patient ahead cancels: the estimate drops by one consultation.
    await request(app).post(`/appointments/${patients[1].appointmentId}/cancel`).set(auth(patients[1].token)).send({});
    const after = await request(app).get(`/appointments/${last.appointmentId}/queue-status`).set(auth(last.token));
    expect(after.body).toMatchObject({ patientsAhead: 2, estimatedWaitMinutes: 16 });
  });

  it("uses the configured average for a new doctor", async () => {
    const { doctor: d } = await doctor(15);
    const first = await createPatient();
    const second = await createPatient();
    await bookAndPay(app, first.token, (await createSlotSoon(d.id, 10)).id);
    const { appointmentId } = await bookAndPay(app, second.token, (await createSlotSoon(d.id, 11)).id);
    const res = await request(app).get(`/appointments/${appointmentId}/queue-status`).set(auth(second.token));
    expect(res.body).toMatchObject({ patientsAhead: 1, estimateBasis: "configured", estimatedWaitMinutes: 15 });
  });

  it("shows the doctor their own average, and no one else's", async () => {
    const { doctor: d, token } = await doctor(10);
    const { token: otherToken } = await doctor(10);
    await history(d.id, [10, 12, 14, 10, 12, 14]);
    const mine = await request(app).get(`/doctors/${d.id}/consult-average`).set(auth(token));
    expect(mine.body).toEqual({ minutes: 12, basis: "history", sampleSize: 6 });
    expect((await request(app).get(`/doctors/${d.id}/consult-average`).set(auth(otherToken))).status).toBe(403);
  });
});
