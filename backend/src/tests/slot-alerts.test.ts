import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../app";
import { prisma } from "../lib/prisma";
import { addDays, todayKey } from "../lib/dates";
import { createClinicWithAdmin, createDoctor, createPatient, createFutureSlot } from "./factories";

const app = createApp();
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

describe("notify me when slots open", () => {
  it("texts each subscriber once when the doctor publishes slots, and can be re-armed", async () => {
    const { clinic } = await createClinicWithAdmin();
    const { doctor, token: doctorToken } = await createDoctor(clinic.id);
    const a = await createPatient();
    const b = await createPatient();

    expect((await request(app).get(`/doctors/${doctor.id}/slot-alert`).set(auth(a.token))).body.subscribed).toBe(false);
    await request(app).put(`/doctors/${doctor.id}/slot-alert`).set(auth(a.token));
    await request(app).put(`/doctors/${doctor.id}/slot-alert`).set(auth(a.token)); // idempotent
    await request(app).put(`/doctors/${doctor.id}/slot-alert`).set(auth(b.token));
    await request(app).delete(`/doctors/${doctor.id}/slot-alert`).set(auth(b.token)); // b changes their mind
    expect((await request(app).get(`/doctors/${doctor.id}/slot-alert`).set(auth(a.token))).body.subscribed).toBe(true);

    const day = addDays(todayKey(), 3);
    const pattern = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startTime: "10:00", endTime: "11:00", slotMinutes: 15 }));
    const created = await request(app).post(`/doctors/${doctor.id}/slots`).set(auth(doctorToken)).send({ pattern, fromDate: day, toDate: day });
    expect(created.status).toBe(201);

    const sent = await prisma.notification.findMany({ where: { type: "SLOTS_AVAILABLE" } });
    expect(sent.map((n) => n.userId)).toEqual([a.user.id]);
    expect((await request(app).get(`/doctors/${doctor.id}/slot-alert`).set(auth(a.token))).body.subscribed).toBe(false);

    // More slots: no second text unless the patient asks again.
    await createFutureSlot(doctor.id, 100);
    await request(app).post(`/doctors/${doctor.id}/slots`).set(auth(doctorToken)).send({ pattern, fromDate: addDays(day, 1), toDate: addDays(day, 1) });
    expect(await prisma.notification.count({ where: { type: "SLOTS_AVAILABLE" } })).toBe(1);
  });

  it("is for patients only", async () => {
    const { clinic } = await createClinicWithAdmin();
    const { doctor, token: doctorToken } = await createDoctor(clinic.id);
    expect((await request(app).put(`/doctors/${doctor.id}/slot-alert`).set(auth(doctorToken))).status).toBe(403);
    expect((await request(app).put(`/doctors/${doctor.id}/slot-alert`)).status).toBe(401);
  });
});

describe("next available doctor", () => {
  it("lists other doctors with free slots, same specialization first, soonest first", async () => {
    const { clinic } = await createClinicWithAdmin();
    const { doctor: full } = await createDoctor(clinic.id);
    const { doctor: sameLater } = await createDoctor(clinic.id);
    const { doctor: sameSooner } = await createDoctor(clinic.id);
    const { doctor: otherSpec } = await createDoctor(clinic.id);
    const { doctor: noSlots } = await createDoctor(clinic.id);
    await prisma.doctor.update({ where: { id: otherSpec.id }, data: { specialization: "Dermatologist" } });
    await createFutureSlot(sameLater.id, 30);
    await createFutureSlot(sameSooner.id, 5);
    await createFutureSlot(otherSpec.id, 1);
    void noSlots;

    const res = await request(app).get(`/doctors/${full.id}/alternatives`);
    expect(res.status).toBe(200);
    expect(res.body.doctors.map((d: { id: string }) => d.id)).toEqual([sameSooner.id, sameLater.id, otherSpec.id]);
    expect(res.body.doctors[0].nextSlot).toBeTruthy();
  });
});
