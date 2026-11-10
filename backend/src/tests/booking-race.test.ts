import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../app";
import { createClinicWithAdmin, createDoctor, createPatient, createFutureSlot } from "./factories";

const app = createApp();

describe("double-booking race", () => {
  it("lets only one of two concurrent bookings win the same slot", async () => {
    const { clinic } = await createClinicWithAdmin();
    const { doctor } = await createDoctor(clinic.id);
    const { token: patientAToken } = await createPatient();
    const { token: patientBToken } = await createPatient();
    const slot = await createFutureSlot(doctor.id);

    const [resA, resB] = await Promise.all([
      request(app).post("/appointments/book").set("Authorization", `Bearer ${patientAToken}`).send({ slotId: slot.id }),
      request(app).post("/appointments/book").set("Authorization", `Bearer ${patientBToken}`).send({ slotId: slot.id }),
    ]);

    const statuses = [resA.status, resB.status].sort();
    expect(statuses).toEqual([201, 409]);
  });
});
