import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../app";
import { createClinicWithAdmin, createDoctor, createAssociate } from "./factories";

const app = createApp();

describe("role isolation", () => {
  it("doctor A can never read doctor B's queue, schedule, or earnings", async () => {
    const { clinic } = await createClinicWithAdmin();
    const { doctor: doctorA, token: tokenA } = await createDoctor(clinic.id);
    const { doctor: doctorB } = await createDoctor(clinic.id);
    void doctorA;

    const queue = await request(app).get(`/doctors/${doctorB.id}/queue`).set("Authorization", `Bearer ${tokenA}`);
    expect(queue.status).toBe(403);

    const schedule = await request(app).get(`/doctors/${doctorB.id}/appointments`).set("Authorization", `Bearer ${tokenA}`);
    expect(schedule.status).toBe(403);

    const earnings = await request(app).get(`/doctors/${doctorB.id}/earnings`).set("Authorization", `Bearer ${tokenA}`);
    expect(earnings.status).toBe(403);

    const settings = await request(app).patch(`/doctors/${doctorB.id}`).set("Authorization", `Bearer ${tokenA}`).send({ bio: "hacked" });
    expect(settings.status).toBe(403);
  });

  it("an associate not assigned to a doctor cannot scan or call next for them", async () => {
    const { clinic } = await createClinicWithAdmin();
    const { doctor } = await createDoctor(clinic.id);
    const { token: unassignedAssociateToken } = await createAssociate(clinic.id, []);

    const callNext = await request(app)
      .post(`/appointments/doctor/${doctor.id}/call-next`)
      .set("Authorization", `Bearer ${unassignedAssociateToken}`);
    expect(callNext.status).toBe(403);
  });

  it("an admin cannot manage a clinic they do not own", async () => {
    const { clinic: clinicA } = await createClinicWithAdmin();
    const { token: tokenB } = await createClinicWithAdmin();

    const res = await request(app)
      .patch(`/clinics/${clinicA.id}`)
      .set("Authorization", `Bearer ${tokenB}`)
      .send({ name: "Hostile takeover" });
    expect(res.status).toBe(403);
  });

  it("rejects requests with no token", async () => {
    const res = await request(app).get("/appointments/mine");
    expect(res.status).toBe(401);
  });
});
