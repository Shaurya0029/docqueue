import { afterEach, describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../app";
import { prisma } from "../lib/prisma";
import { setSmsProviderForTests } from "../lib/sms";
import { createAssociate, createClinicWithAdmin, createDoctor, createPatient, createSlotSoon } from "./factories";

const app = createApp();
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

/** Captures every SMS instead of printing it. */
function captureSms() {
  const sent: { to: string; text: string }[] = [];
  setSmsProviderForTests({
    name: "capture",
    send: async (to: string, text: string) => {
      sent.push({ to, text });
    },
  });
  return sent;
}
afterEach(() => setSmsProviderForTests(null));

async function world() {
  const { clinic } = await createClinicWithAdmin();
  const { doctor, token: doctorToken } = await createDoctor(clinic.id);
  const { token: associateToken } = await createAssociate(clinic.id, [doctor.id]);
  const holder = await createPatient(); // "Test Patient"
  await createSlotSoon(doctor.id, 5);
  await createSlotSoon(doctor.id, 20);
  const walkIn = (body: Record<string, unknown>) =>
    request(app)
      .post(`/doctors/${doctor.id}/walk-ins`)
      .set(auth(associateToken))
      .send({ fullName: "Asha Sharma", phoneNumber: holder.user.phoneNumber, feeCollected: true, consent: true, ...body });
  const askCode = (token = associateToken, body: Record<string, unknown> = {}) =>
    request(app).post(`/doctors/${doctor.id}/walk-ins/family-code`).set(auth(token)).send({ fullName: "Asha Sharma", phoneNumber: holder.user.phoneNumber, ...body });
  return { clinic, doctor, doctorToken, associateToken, holder, walkIn, askCode };
}

describe("walk-in on someone else's number, not confirmed", () => {
  it("is a separate record with the name and number given, never attached to the account", async () => {
    const { doctor, doctorToken, holder, walkIn } = await world();
    const sent = captureSms();
    const res = await walkIn({});
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ linkedTo: "standalone", patientName: "Asha Sharma" });

    const a = await prisma.appointment.findUniqueOrThrow({ where: { id: res.body.appointmentId }, include: { patient: true } });
    expect(a.patient).toMatchObject({ fullName: "Asha Sharma", walkInPhone: holder.user.phoneNumber, userId: null, accountHolderId: null, consentSource: "desk" });

    // Nothing reaches the account: no family member, no message, nothing in their export.
    expect(await prisma.patient.count({ where: { accountHolderId: holder.patient.id } })).toBe(0);
    expect(sent).toEqual([]);
    expect(await prisma.notification.count()).toBe(0);
    expect((await request(app).get("/me/patient/family").set(auth(holder.token))).body.members).toEqual([]);
    const exported = await request(app).get("/me/patient/export").set(auth(holder.token));
    expect(JSON.stringify(exported.body)).not.toContain("Asha");

    // The desk and doctor see her name; the clinic can still call the number given.
    const queue = await request(app).get(`/doctors/${doctor.id}/queue`).set(auth(doctorToken));
    expect(queue.body.queue[0].patientName).toBe("Asha Sharma");
    const schedule = await request(app).get(`/doctors/${doctor.id}/appointments`).set(auth(doctorToken));
    expect(schedule.body.appointments[0]).toMatchObject({ patient: { fullName: "Asha Sharma" }, contactPhone: holder.user.phoneNumber });

    expect(await prisma.auditLog.count({ where: { action: "WALK_IN_STANDALONE", targetId: a.patientId } })).toBe(1);
    // Her next unconfirmed visit reuses the same separate record.
    expect((await walkIn({ fullName: "asha  sharma" })).status).toBe(409); // already in today's queue
    expect(await prisma.patient.count({ where: { walkInPhone: holder.user.phoneNumber } })).toBe(1);
  });

  it("still reuses the account holder's own record when the name is theirs", async () => {
    const { holder, walkIn } = await world();
    const res = await walkIn({ fullName: "TEST patient" });
    expect(res.body.linkedTo).toBe("account-holder");
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: res.body.appointmentId } })).patientId).toBe(holder.patient.id);
  });
});

describe("walk-in confirmed by the account holder", () => {
  it("texts the holder a code; with it the walk-in joins their family", async () => {
    const { doctor, doctorToken, holder, walkIn, askCode } = await world();
    const sent = captureSms();
    const asked = await askCode();
    expect(asked.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(holder.user.phoneNumber);
    expect(sent[0].text).toMatch(/^\d{6} is the code to add Asha Sharma to your MEDORA family at the Test Clinic front desk/);
    expect(await prisma.patient.count({ where: { accountHolderId: holder.patient.id } })).toBe(0); // nothing linked yet
    const code = sent[0].text.slice(0, 6);

    expect((await walkIn({ familyCode: code === "000000" ? "111111" : "000000" })).status).toBe(400); // wrong code: no walk-in
    expect(await prisma.appointment.count()).toBe(0);

    const res = await walkIn({ familyCode: code });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ linkedTo: "family-member", patientName: "Asha Sharma" });
    const a = await prisma.appointment.findUniqueOrThrow({ where: { id: res.body.appointmentId }, include: { patient: true } });
    expect(a.patient).toMatchObject({ accountHolderId: holder.patient.id, userId: null, walkInPhone: null, fullName: "Asha Sharma" });
    expect((await request(app).get("/me/patient/family").set(auth(holder.token))).body.members).toMatchObject([{ fullName: "Asha Sharma" }]);
    expect(sent.at(-1)!.text).toMatch(/^Asha Sharma is checked in with Dr\. Test/);
    expect((await request(app).get(`/doctors/${doctor.id}/queue`).set(auth(doctorToken))).body.queue[0].patientName).toBe("Asha Sharma");

    // The code is single-use.
    expect((await walkIn({ familyCode: code })).status).toBe(400);
    for (const action of ["WALK_IN_FAMILY_CODE_SENT", "WALK_IN_FAMILY_CONFIRMED"]) {
      expect(await prisma.auditLog.count({ where: { action } })).toBe(1);
    }
  });

  it("matches an existing family member by name once confirmed, instead of adding a duplicate", async () => {
    const { holder, walkIn, askCode } = await world();
    const sent = captureSms();
    const existing = await prisma.patient.create({ data: { accountHolderId: holder.patient.id, fullName: "Asha Sharma", relationship: "CHILD", consentAt: new Date(), consentSource: "guardian" } });
    await askCode();
    const res = await walkIn({ familyCode: sent[0].text.slice(0, 6) });
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: res.body.appointmentId } })).patientId).toBe(existing.id);
    expect(await prisma.patient.count({ where: { accountHolderId: holder.patient.id } })).toBe(1);
  });

  it("burns the code after 5 wrong guesses and limits requests to 3 an hour", async () => {
    const { walkIn, askCode } = await world();
    const sent = captureSms();
    await askCode();
    const code = sent[0].text.slice(0, 6);
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) expect((await walkIn({ familyCode: wrong })).status).toBe(400);
    expect((await walkIn({ familyCode: code })).status).toBe(400); // burned
    expect((await askCode()).status).toBe(200);
    expect((await askCode()).status).toBe(200);
    expect((await askCode()).status).toBe(429);
  });

  it("is only for a different name on an existing patient account", async () => {
    const { askCode } = await world();
    expect((await askCode(undefined, { phoneNumber: "+919845099999" })).status).toBe(404); // no account
    expect((await askCode(undefined, { fullName: "Test Patient" })).status).toBe(409); // that is the holder
  });

  it("only the doctor's associates and the doctor can ask for a code", async () => {
    const { clinic, doctorToken, holder, askCode } = await world();
    const { doctor: other } = await createDoctor(clinic.id);
    const { token: outsider } = await createAssociate(clinic.id, [other.id]);
    captureSms();
    expect((await askCode(outsider)).status).toBe(403);
    expect((await askCode(holder.token)).status).toBe(403);
    const stranger = await createPatient();
    expect((await askCode(stranger.token)).status).toBe(403);
    expect((await askCode(doctorToken)).status).toBe(200);
  });
});

describe("contact numbers shown to staff", () => {
  it("logs every view, not throttled", async () => {
    const { doctor, doctorToken, associateToken, walkIn } = await world();
    await walkIn({ fullName: "Test Patient" });
    for (const token of [doctorToken, doctorToken, associateToken]) {
      expect((await request(app).get(`/doctors/${doctor.id}/appointments`).set(auth(token))).status).toBe(200);
    }
    const logs = await prisma.auditLog.findMany({ where: { action: "STAFF_VIEWED_CONTACT_NUMBERS" } });
    expect(logs).toHaveLength(3);
    expect(JSON.parse(logs[0].metadata!).patientIds).toHaveLength(1);
  });
});
