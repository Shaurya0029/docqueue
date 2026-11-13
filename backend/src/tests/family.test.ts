import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../app";
import { prisma } from "../lib/prisma";
import { isMinor } from "../lib/family";
import { notifyThirdInLine, sendDueReminders } from "../lib/notifications";
import { createAssociate, createClinicWithAdmin, createDoctor, createFutureSlot, createPatient, createSlotSoon } from "./factories";
import { book, bookAndPay } from "./paymentHelpers";

const app = createApp();
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function world() {
  const { clinic, token: adminToken } = await createClinicWithAdmin();
  await prisma.clinic.update({ where: { id: clinic.id }, data: { latitude: 12.9756, longitude: 77.605 } });
  const { doctor, token: doctorToken } = await createDoctor(clinic.id);
  const { token: associateToken } = await createAssociate(clinic.id, [doctor.id]);
  const holder = await createPatient(); // "Test Patient"
  return { clinic, adminToken, doctor, doctorToken, associateToken, holder };
}

async function addMember(token: string, body: Record<string, unknown>) {
  return request(app).post("/me/patient/family").set(auth(token)).send({ consent: true, ...body });
}

async function asha(token: string) {
  const res = await addMember(token, { fullName: "Asha", relationship: "CHILD", ageYears: 7 });
  expect(res.status).toBe(201);
  return res.body.member as { id: string; fullName: string; isMinor: boolean };
}

describe("family members", () => {
  it("adds, lists and edits members, recording guardian consent for under-18s", async () => {
    const { holder } = await world();
    const child = await asha(holder.token);
    expect(child).toMatchObject({ fullName: "Asha", relationship: "CHILD", isMinor: true, ageYears: 7, consent: { givenVia: "guardian" } });

    const parent = (await addMember(holder.token, { fullName: "Kamala Sharma", relationship: "PARENT", dateOfBirth: "1958-04-02" })).body.member;
    expect(parent).toMatchObject({ isMinor: false, consent: { givenVia: "account-holder" } });

    const list = await request(app).get("/me/patient/family").set(auth(holder.token));
    expect(list.body.members.map((m: { fullName: string }) => m.fullName)).toEqual(["Asha", "Kamala Sharma"]);

    // Asha's age was wrong: she is 19. The consent is re-recorded as an adult's.
    const edited = await request(app).put(`/me/patient/family/${child.id}`).set(auth(holder.token)).send({ fullName: "Asha", relationship: "CHILD", ageYears: 19, consent: true });
    expect(edited.body.member).toMatchObject({ isMinor: false, consent: { givenVia: "account-holder" } });
    expect(await prisma.auditLog.count({ where: { action: { in: ["FAMILY_MEMBER_ADDED", "FAMILY_MEMBER_UPDATED"] } } })).toBe(3);
  });

  it("requires consent and a sensible name, age and date of birth", async () => {
    const { holder } = await world();
    expect((await addMember(holder.token, { fullName: "Asha", relationship: "CHILD", consent: false })).status).toBe(400);
    expect((await addMember(holder.token, { fullName: "A", relationship: "CHILD" })).status).toBe(400);
    expect((await addMember(holder.token, { fullName: "Asha", relationship: "COUSIN" })).status).toBe(400);
    expect((await addMember(holder.token, { fullName: "Asha", relationship: "CHILD", dateOfBirth: "2999-01-01" })).status).toBe(400);
    expect((await addMember(holder.token, { fullName: "Asha", relationship: "CHILD", ageYears: -1 })).status).toBe(400);
    // Nothing about a child's behaviour can be sent along.
    expect((await addMember(holder.token, { fullName: "Asha", relationship: "CHILD", location: "home" })).status).toBe(400);
    expect(await prisma.patient.count({ where: { accountHolderId: holder.patient.id } })).toBe(0);
  });

  it("works out who is under 18, erring towards treating someone as a minor", () => {
    const member = { accountHolderId: "h", relationship: "OTHER" as const, dateOfBirth: null, ageYears: null, ageRecordedOn: null };
    expect(isMinor({ ...member, dateOfBirth: "2008-11-14" }, "2026-11-13")).toBe(true); // 18 tomorrow
    expect(isMinor({ ...member, dateOfBirth: "2008-11-13" }, "2026-11-13")).toBe(false); // 18 today
    expect(isMinor({ ...member, ageYears: 17, ageRecordedOn: "2026-01-01" }, "2026-12-31")).toBe(true);
    expect(isMinor({ ...member, ageYears: 17, ageRecordedOn: "2026-01-01" }, "2027-01-01")).toBe(false); // a year on
    expect(isMinor({ ...member, ageYears: 18, ageRecordedOn: "2026-11-13" }, "2026-11-13")).toBe(false);
    expect(isMinor({ ...member, relationship: "CHILD" })).toBe(true); // a child with no age given
    expect(isMinor({ ...member })).toBe(false);
    expect(isMinor({ ...member, accountHolderId: null, relationship: "CHILD" })).toBe(false); // account holders sign up themselves
  });
});

describe("booking for a family member", () => {
  it("books, pays and shows the ticket in the member's name, on the holder's account", async () => {
    const { doctor, holder } = await world();
    const child = await asha(holder.token);
    const { appointmentId } = await bookAndPay(app, holder.token, (await createFutureSlot(doctor.id, 30)).id, child.id);
    const own = await bookAndPay(app, holder.token, (await createFutureSlot(doctor.id, 31)).id);

    const a = await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } });
    expect(a).toMatchObject({ patientId: child.id, status: "BOOKED" });
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: own.appointmentId } })).patientId).toBe(holder.patient.id);

    const ticket = await request(app).get(`/appointments/${appointmentId}`).set(auth(holder.token));
    expect(ticket.status).toBe(200);
    expect(ticket.body.appointment.patient).toEqual({ id: child.id, fullName: "Asha", accountHolderId: holder.patient.id });
    expect(JSON.stringify(ticket.body)).not.toMatch(/ageYears|dateOfBirth/);

    const mine = await request(app).get("/appointments/mine").set(auth(holder.token));
    expect(mine.body.appointments.map((x: { patient: { fullName: string } }) => x.patient.fullName).sort()).toEqual(["Asha", "Test Patient"]);
    expect((await request(app).get(`/appointments/${appointmentId}/queue-status`).set(auth(holder.token))).status).toBe(200);

    // The holder manages the member's booking like their own.
    const cancel = await request(app).post(`/appointments/${appointmentId}/cancel`).set(auth(holder.token)).send({});
    expect(cancel.body).toMatchObject({ ok: true, refunded: true });
  });

  it("refuses to book for someone else's family member or a removed one", async () => {
    const { doctor, holder } = await world();
    const child = await asha(holder.token);
    const stranger = await createPatient();
    const slot = await createFutureSlot(doctor.id, 30);
    const res = await request(app).post("/appointments/book").set(auth(stranger.token)).send({ slotId: slot.id, patientId: child.id });
    expect(res.status).toBe(404);
    // Nor for another account holder directly.
    const res2 = await request(app).post("/appointments/book").set(auth(stranger.token)).send({ slotId: slot.id, patientId: holder.patient.id });
    expect(res2.status).toBe(404);
    expect((await prisma.slot.findUniqueOrThrow({ where: { id: slot.id } })).isBooked).toBe(false);

    await request(app).post(`/me/patient/family/${child.id}/delete`).set(auth(holder.token)).send({ confirm: "DELETE" });
    expect((await request(app).post("/appointments/book").set(auth(holder.token)).send({ slotId: slot.id, patientId: child.id })).status).toBe(404);
  });
});

describe("role isolation: family profiles", () => {
  it("an account holder sees and manages only the members they created", async () => {
    const { doctor, holder } = await world();
    const child = await asha(holder.token);
    const { appointmentId } = await bookAndPay(app, holder.token, (await createFutureSlot(doctor.id, 30)).id, child.id);
    const stranger = await createPatient();

    expect((await request(app).get("/me/patient/family").set(auth(stranger.token))).body.members).toEqual([]);
    const edit = { fullName: "Hacked", relationship: "CHILD", consent: true };
    expect((await request(app).put(`/me/patient/family/${child.id}`).set(auth(stranger.token)).send(edit)).status).toBe(404);
    expect((await request(app).post(`/me/patient/family/${child.id}/delete`).set(auth(stranger.token)).send({ confirm: "DELETE" })).status).toBe(404);
    for (const path of [`/appointments/${appointmentId}`, `/appointments/${appointmentId}/queue-status`]) {
      expect((await request(app).get(path).set(auth(stranger.token))).status).toBe(404);
    }
    expect((await request(app).post(`/appointments/${appointmentId}/cancel`).set(auth(stranger.token)).send({})).status).toBe(404);
    expect((await request(app).put(`/appointments/${appointmentId}/leave-alert`).set(auth(stranger.token)).send({ travelMinutes: 20 })).status).toBe(404);
    expect((await request(app).get("/appointments/mine").set(auth(stranger.token))).body.appointments).toEqual([]);
    expect((await request(app).get("/me/patient/export").set(auth(stranger.token))).body.familyMembers).toEqual([]);
    expect((await prisma.patient.findUniqueOrThrow({ where: { id: child.id } })).fullName).toBe("Asha");
  });

  it("staff cannot use family routes", async () => {
    const { holder, doctorToken, associateToken, adminToken } = await world();
    const child = await asha(holder.token);
    for (const token of [doctorToken, associateToken, adminToken]) {
      expect((await request(app).get("/me/patient/family").set(auth(token))).status).toBe(403);
      expect((await addMember(token, { fullName: "Asha", relationship: "CHILD" })).status).toBe(403);
      expect((await request(app).post(`/me/patient/family/${child.id}/delete`).set(auth(token)).send({ confirm: "DELETE" })).status).toBe(403);
    }
  });

  it("the doctor and desk see the member as the patient, with only a contact number for the account holder", async () => {
    const { doctor, doctorToken, associateToken, holder } = await world();
    await prisma.patient.update({ where: { id: holder.patient.id }, data: { fullName: "Rahul Sharma", address: "12 Secret Lane", idDocumentRef: "****1234" } });
    const child = await asha(holder.token);
    const { appointmentId, qrToken } = await bookAndPay(app, holder.token, (await createSlotSoon(doctor.id, 5)).id, child.id);

    const schedule = await request(app).get(`/doctors/${doctor.id}/appointments`).set(auth(doctorToken));
    const row = schedule.body.appointments.find((x: { id: string }) => x.id === appointmentId);
    expect(row.patient).toEqual({ fullName: "Asha" });
    expect(row.contactPhone).toBe(holder.user.phoneNumber);

    const queue = await request(app).get(`/doctors/${doctor.id}/queue`).set(auth(doctorToken));
    expect(queue.body.queue.map((q: { patientName: string }) => q.patientName)).toEqual(["Asha"]);

    const scan = await request(app).post("/appointments/qr/scan").set(auth(associateToken)).send({ token: qrToken });
    expect(scan.body.name).toBe("Asha");

    // Nothing else about the account holder reaches staff.
    for (const body of [schedule.body, queue.body, scan.body]) {
      const text = JSON.stringify(body);
      for (const secret of ["Rahul", "Secret Lane", "1234", holder.patient.id, holder.user.id]) expect(text).not.toContain(secret);
    }
  });
});

describe("messages about a family member", () => {
  it("go to the account holder's phone and name the member", async () => {
    const { doctor, doctorToken, associateToken, holder } = await world();
    const child = await asha(holder.token);
    // The day's slots: three other patients first, then Asha 50 minutes from now.
    const slots = await Promise.all([1, 2, 3].map((m) => createSlotSoon(doctor.id, m)));
    const soon = await createSlotSoon(doctor.id, 50);
    // Reminder: Asha's slot, booked hours ago.
    const { appointmentId } = await bookAndPay(app, holder.token, soon.id, child.id);
    await prisma.appointment.update({ where: { id: appointmentId }, data: { createdAt: new Date(Date.now() - 3 * 3_600_000) } });
    expect(await sendDueReminders()).toBe(1);

    const sms = await prisma.notification.findMany({ where: { userId: holder.user.id }, orderBy: { sentAt: "asc" } });
    expect(sms.every((n) => n.patientId === child.id)).toBe(true);
    expect(sms.map((n) => n.payload)).toEqual([
      expect.stringMatching(/^Payment received for Asha\. Asha's queue token is \d+\.$/),
      expect.stringMatching(/^Reminder for Asha: Asha's appointment with Dr\. Test is at .+ Show the QR on Asha's ticket at the desk\.$/),
    ]);

    // "3rd in line": two patients ahead of Asha, and the doctor has started.
    const others = [await createPatient(), await createPatient(), await createPatient()];
    for (let i = 0; i < 3; i++) await bookAndPay(app, others[i].token, slots[i].id);
    const first = await prisma.qrToken.findFirstOrThrow({ where: { appointment: { slotId: slots[0].id } } });
    await request(app).post("/appointments/qr/scan").set(auth(associateToken)).send({ token: first.token });
    await request(app).post(`/appointments/doctor/${doctor.id}/call-next`).set(auth(doctorToken));
    await notifyThirdInLine(doctor.id);
    const third = await prisma.notification.findFirstOrThrow({ where: { type: "QUEUE_UPDATE", userId: holder.user.id } });
    expect(third.payload).toMatch(/^Asha is 3rd in line \(token \d+\)\. Please be at the clinic; Asha's turn is coming up soon\.$/);

    // Cancelling names her too.
    await request(app).post(`/appointments/${appointmentId}/cancel`).set(auth(holder.token)).send({});
    const cancelled = await prisma.notification.findFirstOrThrow({ where: { type: "CANCELLED", userId: holder.user.id } });
    expect(cancelled.payload).toMatch(/^Asha's appointment on .+ is cancelled\./);
  });

  it("keep the usual wording for the account holder's own visits", async () => {
    const { doctor, holder } = await world();
    await bookAndPay(app, holder.token, (await createFutureSlot(doctor.id, 30)).id);
    const sms = await prisma.notification.findFirstOrThrow({ where: { userId: holder.user.id } });
    expect(sms).toMatchObject({ patientId: holder.patient.id });
    expect(sms.payload).toMatch(/^Payment received\. Your queue token is \d+\.$/);
  });
});

describe("walk-ins for a family member", () => {
  it("put the visit on the family member's record, so the desk and doctor see their name", async () => {
    const { doctor, doctorToken, associateToken, holder } = await world();
    await createSlotSoon(doctor.id, 5);
    await createSlotSoon(doctor.id, 20);
    const walkIn = (fullName: string) =>
      request(app).post(`/doctors/${doctor.id}/walk-ins`).set(auth(associateToken)).send({ fullName, phoneNumber: holder.user.phoneNumber, feeCollected: true, consent: true });

    const res = await walkIn("Asha  Sharma");
    expect(res.status).toBe(201);
    expect(res.body.patientName).toBe("Asha Sharma");
    const a = await prisma.appointment.findUniqueOrThrow({ where: { id: res.body.appointmentId }, include: { patient: true } });
    expect(a.patient).toMatchObject({ accountHolderId: holder.patient.id, userId: null, fullName: "Asha Sharma", consentSource: "desk" });
    const queue = await request(app).get(`/doctors/${doctor.id}/queue`).set(auth(doctorToken));
    expect(queue.body.queue[0].patientName).toBe("Asha Sharma");
    const sms = await prisma.notification.findFirstOrThrow({ where: { userId: holder.user.id } });
    expect(sms.payload).toMatch(/^Asha Sharma is checked in with Dr\. Test/);

    // She now shows up in the holder's family, and her next walk-in reuses her record.
    const family = await request(app).get("/me/patient/family").set(auth(holder.token));
    expect(family.body.members).toMatchObject([{ id: a.patientId, fullName: "Asha Sharma" }]);
    expect((await walkIn("asha sharma")).status).toBe(409); // already in today's queue, as herself
    expect(await prisma.patient.count({ where: { accountHolderId: holder.patient.id } })).toBe(1);
  });
});

describe("leave-now for a child's visit", () => {
  it("never reads a location: only typed travel minutes", async () => {
    const { doctor, holder } = await world();
    const child = await asha(holder.token);
    const { appointmentId } = await bookAndPay(app, holder.token, (await createFutureSlot(doctor.id, 30)).id, child.id);
    const ticket = await request(app).get(`/appointments/${appointmentId}`).set(auth(holder.token));
    expect(ticket.body.leaveAlert).toMatchObject({ available: true, locationAllowed: false });

    const byLocation = await request(app).put(`/appointments/${appointmentId}/leave-alert`).set(auth(holder.token)).send({ latitude: 13, longitude: 77.6 });
    expect(byLocation.status).toBe(409);
    const byMinutes = await request(app).put(`/appointments/${appointmentId}/leave-alert`).set(auth(holder.token)).send({ travelMinutes: 25 });
    expect(byMinutes.body.leaveAlert).toMatchObject({ enabled: true, travelMinutes: 25, source: "manual" });

    // An adult member may use location as usual.
    const parent = (await addMember(holder.token, { fullName: "Kamala", relationship: "PARENT", ageYears: 70 })).body.member;
    const p = await bookAndPay(app, holder.token, (await createFutureSlot(doctor.id, 31)).id, parent.id);
    const adult = await request(app).put(`/appointments/${p.appointmentId}/leave-alert`).set(auth(holder.token)).send({ latitude: 13, longitude: 77.6 });
    expect(adult.body.leaveAlert).toMatchObject({ locationAllowed: true, source: "estimate" });
  });
});

describe("DPDP with family members", () => {
  it("the export includes every family member and their visits", async () => {
    const { doctor, holder } = await world();
    const child = await asha(holder.token);
    await bookAndPay(app, holder.token, (await createFutureSlot(doctor.id, 30)).id, child.id);
    await bookAndPay(app, holder.token, (await createFutureSlot(doctor.id, 31)).id);

    const res = await request(app).get("/me/patient/export").set(auth(holder.token));
    expect(res.body.appointments).toHaveLength(1);
    expect(res.body.familyMembers).toMatchObject([{ id: child.id, fullName: "Asha", relationship: "CHILD", isMinor: true, consent: { givenVia: "guardian" } }]);
    expect(res.body.familyMembers[0].appointments).toHaveLength(1);
    expect(res.body.messagesSent.map((m: { about: string }) => m.about).sort()).toEqual(["Asha", "you"]);
  });

  it("removing a family member erases only their data", async () => {
    const { doctor, holder } = await world();
    const child = await asha(holder.token);
    const parent = (await addMember(holder.token, { fullName: "Kamala", relationship: "PARENT" })).body.member;
    const childVisit = await bookAndPay(app, holder.token, (await createFutureSlot(doctor.id, 30)).id, child.id);
    const parentVisit = await bookAndPay(app, holder.token, (await createFutureSlot(doctor.id, 31)).id, parent.id);
    const ownVisit = await bookAndPay(app, holder.token, (await createFutureSlot(doctor.id, 32)).id);

    expect((await request(app).post(`/me/patient/family/${child.id}/delete`).set(auth(holder.token)).send({})).status).toBe(400);
    const res = await request(app).post(`/me/patient/family/${child.id}/delete`).set(auth(holder.token)).send({ confirm: "DELETE" });
    expect(res.body).toMatchObject({ ok: true, cancelledBookings: 1 });

    const erased = await prisma.patient.findUniqueOrThrow({ where: { id: child.id } });
    expect(erased).toMatchObject({ fullName: null, relationship: null, ageYears: null, consentAt: null });
    expect(erased.deletedAt).toBeInstanceOf(Date);
    expect(await prisma.notification.count({ where: { patientId: child.id } })).toBe(0);
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: childVisit.appointmentId } })).status).toBe("CANCELLED");

    // Everyone else is untouched.
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: parentVisit.appointmentId } })).status).toBe("BOOKED");
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: ownVisit.appointmentId } })).status).toBe("BOOKED");
    expect(await prisma.notification.count({ where: { patientId: { in: [parent.id, holder.patient.id] } } })).toBe(2);
    expect((await request(app).get("/me/patient/family").set(auth(holder.token))).body.members).toMatchObject([{ fullName: "Kamala" }]);
    expect((await request(app).get("/me").set(auth(holder.token))).status).toBe(200);
  });

  it("deleting the account removes every family member", async () => {
    const { doctor, holder } = await world();
    const child = await asha(holder.token);
    const parent = (await addMember(holder.token, { fullName: "Kamala", relationship: "PARENT" })).body.member;
    await bookAndPay(app, holder.token, (await createFutureSlot(doctor.id, 30)).id, child.id);

    const res = await request(app).post("/me/patient/delete").set(auth(holder.token)).send({ confirm: "DELETE" });
    expect(res.body).toMatchObject({ ok: true, cancelledBookings: 1, deletedFamilyMembers: 2 });
    for (const id of [child.id, parent.id, holder.patient.id]) {
      const p = await prisma.patient.findUniqueOrThrow({ where: { id } });
      expect(p.fullName).toBeNull();
      expect(p.deletedAt).toBeInstanceOf(Date);
    }
    expect(await prisma.notification.count()).toBe(0);
  });

  it("will not delete while a family member is in the clinic", async () => {
    const { doctor, associateToken, holder } = await world();
    const child = await asha(holder.token);
    const visit = await bookAndPay(app, holder.token, (await createSlotSoon(doctor.id, 5)).id, child.id);
    await request(app).post("/appointments/qr/scan").set(auth(associateToken)).send({ token: visit.qrToken });

    expect((await request(app).post(`/me/patient/family/${child.id}/delete`).set(auth(holder.token)).send({ confirm: "DELETE" })).status).toBe(409);
    expect((await request(app).post("/me/patient/delete").set(auth(holder.token)).send({ confirm: "DELETE" })).status).toBe(409);
    expect((await prisma.patient.findUniqueOrThrow({ where: { id: child.id } })).fullName).toBe("Asha");
  });
});

// A booking hold for a family member uses the same slot rules as anyone's.
describe("booking holds", () => {
  it("a member's unpaid hold blocks the slot like any other", async () => {
    const { doctor, holder } = await world();
    const child = await asha(holder.token);
    const slot = await createFutureSlot(doctor.id, 30);
    await book(app, holder.token, slot.id, child.id);
    expect((await request(app).post("/appointments/book").set(auth(holder.token)).send({ slotId: slot.id })).status).toBe(409);
  });
});
