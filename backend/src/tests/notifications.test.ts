import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../app";
import { prisma } from "../lib/prisma";
import { sendDueReminders, sendNotification } from "../lib/notifications";
import { getSmsProvider, ConsoleSmsProvider } from "../lib/sms";
import { createClinicWithAdmin, createDoctor, createAssociate, createPatient, createSlotSoon } from "./factories";
import { bookAndPay } from "./paymentHelpers";

const app = createApp();
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

describe("1-hour reminder", () => {
  it("is sent once for bookings whose slot starts within the hour", async () => {
    const { clinic } = await createClinicWithAdmin();
    const { doctor } = await createDoctor(clinic.id);
    const early = await createPatient();
    const late = await createPatient();
    const future = await createPatient();
    const a = await bookAndPay(app, early.token, (await createSlotSoon(doctor.id, 50)).id);
    const b = await bookAndPay(app, late.token, (await createSlotSoon(doctor.id, 40)).id);
    await bookAndPay(app, future.token, (await createSlotSoon(doctor.id, 120)).id);
    // `early` booked yesterday; `late` booked 40 minutes before the slot.
    await prisma.appointment.update({ where: { id: a.appointmentId }, data: { createdAt: new Date(Date.now() - 86_400_000) } });
    void b;

    expect(await sendDueReminders()).toBe(1);
    expect(await sendDueReminders()).toBe(0); // never twice

    const reminders = await prisma.notification.findMany({ where: { type: "REMINDER" } });
    expect(reminders).toHaveLength(1);
    expect(reminders[0]).toMatchObject({ userId: early.user.id, status: "SENT" });
    expect(reminders[0].payload).toContain("Reminder: your appointment");
  });
});

describe("3rd in line", () => {
  it("texts the patient with two ahead once the doctor has started, once each", async () => {
    const { clinic } = await createClinicWithAdmin();
    const { doctor, token: doctorToken } = await createDoctor(clinic.id);
    const { token: associateToken } = await createAssociate(clinic.id, [doctor.id]);
    const patients = [];
    for (let i = 0; i < 5; i++) {
      const p = await createPatient();
      const paid = await bookAndPay(app, p.token, (await createSlotSoon(doctor.id, 5 + i)).id);
      await request(app).post("/appointments/qr/scan").set(auth(associateToken)).send({ token: paid.qrToken });
      patients.push({ ...p, appointmentId: paid.appointmentId });
    }
    // Nobody is texted before the doctor starts.
    expect(await prisma.notification.count({ where: { type: "QUEUE_UPDATE" } })).toBe(0);

    await request(app).post(`/appointments/doctor/${doctor.id}/call-next`).set(auth(doctorToken)); // serving #1
    let messages = await prisma.notification.findMany({ where: { type: "QUEUE_UPDATE" } });
    expect(messages.map((m) => m.userId)).toEqual([patients[3].user.id]); // #2 and #3 ahead of #4
    expect(messages[0].payload).toContain("3rd in line");

    await request(app).post(`/appointments/${patients[0].appointmentId}/complete`).set(auth(doctorToken));
    await request(app).post(`/appointments/doctor/${doctor.id}/call-next`).set(auth(doctorToken)); // serving #2
    messages = await prisma.notification.findMany({ where: { type: "QUEUE_UPDATE" }, orderBy: { sentAt: "asc" } });
    expect(messages.map((m) => m.userId)).toEqual([patients[3].user.id, patients[4].user.id]);
  });
});

describe("notification log", () => {
  it("logs each message and sends a deduplicated one only once, even in parallel", async () => {
    const { user } = await createPatient();
    const results = await Promise.all(
      Array.from({ length: 5 }, () => sendNotification({ userId: user.id, type: "REMINDER", message: "hi", dedupeKey: "k1" }))
    );
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await prisma.notification.count({ where: { dedupeKey: "k1" } })).toBe(1);
    const sms = (getSmsProvider() as ConsoleSmsProvider).sent.filter((m) => m.to === user.phoneNumber);
    expect(sms).toHaveLength(1);
  });

  it("logs a failed SMS as FAILED without failing the caller", async () => {
    const { user } = await createPatient();
    const provider = getSmsProvider();
    const original = provider.send.bind(provider);
    provider.send = async () => {
      throw new Error("provider down");
    };
    try {
      await sendNotification({ userId: user.id, type: "CANCELLED", message: "x" });
    } finally {
      provider.send = original;
    }
    const row = await prisma.notification.findFirstOrThrow({ where: { userId: user.id } });
    expect(row.status).toBe("FAILED");
  });
});
