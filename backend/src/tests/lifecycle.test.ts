import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../app";
import { prisma } from "../lib/prisma";
import { addDays, todayKey } from "../lib/dates";
import {
  createClinicWithAdmin,
  createDoctor,
  createAssociate,
  createPatient,
  createFutureSlot,
  createSlotAt,
  createSlotSoon,
} from "./factories";
import { book, bookAndPay } from "./paymentHelpers";

const app = createApp();

describe("appointment lifecycle", () => {
  it("runs book -> pay -> QR check-in -> call next -> complete for today's queue", async () => {
    const { clinic } = await createClinicWithAdmin();
    const { doctor, token: doctorToken } = await createDoctor(clinic.id);
    const { token: associateToken } = await createAssociate(clinic.id, [doctor.id]);
    const { token: patientToken } = await createPatient();
    const slot = await createSlotSoon(doctor.id);

    const { appointmentId, webhook, qrToken } = await bookAndPay(app, patientToken, slot.id);
    expect(webhook.status).toBe(200);
    expect(webhook.body.outcome).toBe("confirmed");
    expect(qrToken).toBeTruthy();

    const ticket = await request(app).get(`/appointments/${appointmentId}`).set("Authorization", `Bearer ${patientToken}`);
    expect(ticket.body.appointment.status).toBe("BOOKED");
    expect(ticket.body.appointment.qrToken.token).toBe(qrToken);

    const tooEarly = await request(app).post(`/appointments/doctor/${doctor.id}/call-next`).set("Authorization", `Bearer ${doctorToken}`);
    expect(tooEarly.status).toBe(409); // nobody checked in yet

    const scan = await request(app).post("/appointments/qr/scan").set("Authorization", `Bearer ${associateToken}`).send({ token: qrToken });
    expect(scan.status).toBe(200);
    expect(scan.body.queueToken).toBe(ticket.body.appointment.queueToken);

    const called = await request(app).post(`/appointments/doctor/${doctor.id}/call-next`).set("Authorization", `Bearer ${associateToken}`);
    expect(called.status).toBe(200);
    expect(called.body.appointmentId).toBe(appointmentId);

    const status = await request(app).get(`/appointments/${appointmentId}/queue-status`).set("Authorization", `Bearer ${patientToken}`);
    expect(status.body.status).toBe("IN_CONSULTATION");
    expect(status.body.nowServing).toBe(status.body.myToken);

    const done = await request(app).post(`/appointments/${appointmentId}/complete`).set("Authorization", `Bearer ${doctorToken}`);
    expect(done.status).toBe(200);
    const final = await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } });
    expect(final.status).toBe("COMPLETED");
  });

  it("rejects an invalid transition with 409", async () => {
    const { clinic } = await createClinicWithAdmin();
    const { doctor, token: doctorToken } = await createDoctor(clinic.id);
    const { token: patientToken } = await createPatient();
    const slot = await createFutureSlot(doctor.id);
    const appointmentId = await book(app, patientToken, slot.id);

    // Still PENDING_PAYMENT: completing should 409, not 500.
    const complete = await request(app).post(`/appointments/${appointmentId}/complete`).set("Authorization", `Bearer ${doctorToken}`);
    expect(complete.status).toBe(409);
  });
});

describe("queue tokens", () => {
  it("follow slot time, not payment order, and count only real patients ahead", async () => {
    const { clinic } = await createClinicWithAdmin();
    const { doctor } = await createDoctor(clinic.id);
    const day = addDays(todayKey(), 2);
    const s1000 = await createSlotAt(doctor.id, day, "10:00");
    await createSlotAt(doctor.id, day, "10:15"); // stays empty
    const s1030 = await createSlotAt(doctor.id, day, "10:30");

    const late = await createPatient();
    const early = await createPatient();
    // The 10:30 patient pays first.
    const a1030 = await bookAndPay(app, late.token, s1030.id);
    const a1000 = await bookAndPay(app, early.token, s1000.id);

    const appt1030 = await prisma.appointment.findUniqueOrThrow({ where: { id: a1030.appointmentId } });
    const appt1000 = await prisma.appointment.findUniqueOrThrow({ where: { id: a1000.appointmentId } });
    expect(appt1000.queueToken).toBe(1);
    expect(appt1030.queueToken).toBe(3);
    expect(appt1030.queueDate).toBe(day);

    const status = await request(app).get(`/appointments/${a1030.appointmentId}/queue-status`).set("Authorization", `Bearer ${late.token}`);
    expect(status.body.myToken).toBe(3);
    expect(status.body.patientsAhead).toBe(1);
    expect(status.body.estimatedWaitMinutes).toBe(10); // one real patient ahead x 10 min, not two
  });

  it("refuses slot changes that would renumber issued tokens", async () => {
    const { clinic } = await createClinicWithAdmin();
    const { doctor, token: doctorToken } = await createDoctor(clinic.id);
    const day = addDays(todayKey(), 2);
    const s0930 = await createSlotAt(doctor.id, day, "09:30");
    const s1000 = await createSlotAt(doctor.id, day, "10:00");
    const { token: patientToken } = await createPatient();
    await bookAndPay(app, patientToken, s1000.id);

    const del = await request(app).delete(`/slots/${s0930.id}`).set("Authorization", `Bearer ${doctorToken}`);
    expect(del.status).toBe(409);
    const later = await request(app)
      .post(`/doctors/${doctor.id}/slots`)
      .set("Authorization", `Bearer ${doctorToken}`)
      .send({ startsAt: new Date(s1000.startsAt.getTime() + 3_600_000).toISOString(), endsAt: new Date(s1000.startsAt.getTime() + 4_500_000).toISOString() });
    expect(later.status).toBe(201); // after the last token is fine
  });

  it("lets a released slot be booked again", async () => {
    const { clinic } = await createClinicWithAdmin();
    const { doctor } = await createDoctor(clinic.id);
    const slot = await createFutureSlot(doctor.id, 5);
    const first = await createPatient();
    const appointmentId = await book(app, first.token, slot.id);
    const cancel = await request(app).post(`/appointments/${appointmentId}/cancel`).set("Authorization", `Bearer ${first.token}`).send({});
    expect(cancel.status).toBe(200);

    const second = await createPatient();
    const { webhook } = await bookAndPay(app, second.token, slot.id);
    expect(webhook.body.outcome).toBe("confirmed");
  });
});

describe("patient appointment views", () => {
  it("include the doctor's clinic, which the ticket and bookings pages render", async () => {
    const { clinic } = await createClinicWithAdmin();
    const { doctor } = await createDoctor(clinic.id);
    const { token: patientToken } = await createPatient();
    const slot = await createFutureSlot(doctor.id);
    const { appointmentId } = await bookAndPay(app, patientToken, slot.id);

    const one = await request(app).get(`/appointments/${appointmentId}`).set("Authorization", `Bearer ${patientToken}`);
    expect(one.body.appointment.doctor.clinic).toMatchObject({ name: clinic.name, address: clinic.address });
    const mine = await request(app).get("/appointments/mine").set("Authorization", `Bearer ${patientToken}`);
    expect(mine.body.appointments[0].doctor.clinic.name).toBe(clinic.name);
  });
});
