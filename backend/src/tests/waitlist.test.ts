import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../app";
import { prisma } from "../lib/prisma";
import { addDays, todayKey } from "../lib/dates";
import { expireOffers, OFFER_MINUTES } from "../lib/waitlist";
import { releaseExpiredHolds } from "../jobs/releaseExpiredHolds";
import { closePastDays } from "../jobs/closePastDays";
import { createAssociate, createClinicWithAdmin, createDoctor, createPatient, createSlotAt, createSlotSoon } from "./factories";
import { bookAndPay, capturedEvent, createOrder, sendWebhook } from "./paymentHelpers";

const app = createApp();
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
type Patient = Awaited<ReturnType<typeof createPatient>>;

/** A doctor whose day two days from now has two slots, both booked. */
async function fullDay() {
  const { clinic, token: adminToken } = await createClinicWithAdmin();
  const { doctor, token: doctorToken } = await createDoctor(clinic.id);
  const { token: associateToken } = await createAssociate(clinic.id, [doctor.id]);
  const date = addDays(todayKey(), 2);
  const s1 = await createSlotAt(doctor.id, date, "10:00");
  const s2 = await createSlotAt(doctor.id, date, "10:15");
  const booker1 = await createPatient();
  const booker2 = await createPatient();
  const b1 = await bookAndPay(app, booker1.token, s1.id);
  const b2 = await bookAndPay(app, booker2.token, s2.id);
  return { clinic, adminToken, doctor, doctorToken, associateToken, date, s1, s2, booker1, booker2, b1, b2 };
}

const join = (p: Patient, doctorId: string, date: string, patientId?: string) =>
  request(app).post("/waitlist").set(auth(p.token)).send({ doctorId, date, patientId });
const mine = async (p: Patient) => (await request(app).get("/waitlist/mine").set(auth(p.token))).body.entries;
const offersSms = (userId: string) => prisma.notification.count({ where: { userId, type: "WAITLIST_OFFER" } });
const cancel = (p: Patient, appointmentId: string) => request(app).post(`/appointments/${appointmentId}/cancel`).set(auth(p.token)).send({});
const slotBooked = async (id: string) => (await prisma.slot.findUniqueOrThrow({ where: { id } })).isBooked;

async function waitingThree(doctorId: string, date: string) {
  const a = await createPatient();
  const b = await createPatient();
  const c = await createPatient();
  for (const p of [a, b, c]) expect((await join(p, doctorId, date)).status).toBe(201);
  return { a, b, c };
}

describe("joining a waitlist", () => {
  it("only for a fully booked day, once per doctor and day, with family members on their own entries", async () => {
    const { doctor, date, booker1, b1 } = await fullDay();
    const p = await createPatient();
    expect((await join(p, doctor.id, date)).status).toBe(201);
    expect((await join(p, doctor.id, date)).status).toBe(409); // already on it

    const child = (await request(app).post("/me/patient/family").set(auth(p.token)).send({ fullName: "Asha", relationship: "CHILD", ageYears: 6, consent: true })).body.member;
    expect((await join(p, doctor.id, date, child.id)).status).toBe(201);
    expect((await mine(p)).map((e: { patient: { fullName: string } }) => e.patient.fullName)).toEqual(["Test Patient", "Asha"]);

    // A day with a free slot: book it instead.
    await cancel(booker1, b1.appointmentId); // nobody else waiting... but p and Asha are: it is offered, not freed
    const other = addDays(todayKey(), 3);
    await createSlotAt(doctor.id, other, "10:00");
    expect((await join(p, doctor.id, other)).status).toBe(409);
    // Someone else's family member.
    const stranger = await createPatient();
    expect((await join(stranger, doctor.id, date, child.id)).status).toBe(404);
  });

  it("not for an unverified or deactivated doctor", async () => {
    const { doctor, date } = await fullDay();
    const p = await createPatient();
    await prisma.doctor.update({ where: { id: doctor.id }, data: { verificationStatus: "PENDING" } });
    expect((await join(p, doctor.id, date)).status).toBe(409);
    await prisma.doctor.update({ where: { id: doctor.id }, data: { verificationStatus: "APPROVED", isActive: false } });
    expect((await join(p, doctor.id, date)).status).toBe(409);
  });

  it("can be left at any time, and ends by itself when the day passes", async () => {
    const { doctor, date } = await fullDay();
    const p = await createPatient();
    const entry = (await join(p, doctor.id, date)).body.entry;
    expect((await request(app).post(`/waitlist/${entry.id}/leave`).set(auth(p.token))).status).toBe(200);
    expect(await mine(p)).toEqual([]);

    const old = await prisma.waitlistEntry.create({ data: { patientId: p.patient.id, doctorId: doctor.id, date: addDays(todayKey(), -1) } });
    await closePastDays();
    expect((await prisma.waitlistEntry.findUniqueOrThrow({ where: { id: old.id } })).status).toBe("EXPIRED");
  });
});

describe("offers", () => {
  it("go to the first person waiting (FIFO), held so nobody else can book the slot", async () => {
    const { doctor, date, s1, booker1, b1 } = await fullDay();
    const { a, b, c } = await waitingThree(doctor.id, date);
    await cancel(booker1, b1.appointmentId);

    const offerA = (await mine(a))[0];
    expect(offerA).toMatchObject({ status: "OFFERED", position: 1, offer: { id: expect.any(String) } });
    expect(new Date(offerA.offer.expiresAt).getTime() - Date.now()).toBeGreaterThan((OFFER_MINUTES - 1) * 60_000);
    expect((await mine(b))[0]).toMatchObject({ status: "WAITING", position: 2, offer: null });
    expect((await mine(c))[0]).toMatchObject({ position: 3 });
    expect(await offersSms(a.user.id)).toBe(1);
    const sms = await prisma.notification.findFirstOrThrow({ where: { userId: a.user.id, type: "WAITLIST_OFFER" } });
    expect(sms.payload).toMatch(/^A slot opened with Dr\. Test at .+ It is held for 10 minutes/);

    // The held slot cannot be booked or reached by anyone else.
    expect(await slotBooked(s1.id)).toBe(true);
    const outsider = await createPatient();
    expect((await request(app).post("/appointments/book").set(auth(outsider.token)).send({ slotId: s1.id })).status).toBe(409);
    expect(await prisma.waitlistOffer.count({ where: { slotId: s1.id, status: "PENDING" } })).toBe(1);
  });

  it("pass on when they expire, are declined or withdrawn; with nobody left the slot opens", async () => {
    const { doctor, date, s1, booker1, b1 } = await fullDay();
    const { a, b, c } = await waitingThree(doctor.id, date);
    await cancel(booker1, b1.appointmentId);

    // A lets it expire: B is next, and A is back in line for other slots.
    expect(await expireOffers(new Date(Date.now() + (OFFER_MINUTES + 1) * 60_000))).toBe(1);
    expect((await mine(a))[0]).toMatchObject({ status: "WAITING", offer: null });
    const offerB = (await mine(b))[0].offer;
    expect(offerB).not.toBeNull();
    // A's old offer can no longer be claimed.
    const aOffer = await prisma.waitlistOffer.findFirstOrThrow({ where: { entry: { patientId: a.patient.id } } });
    expect((await request(app).post(`/waitlist/offers/${aOffer.id}/claim`).set(auth(a.token))).status).toBe(409);

    // B declines: C is next.
    expect((await request(app).post(`/waitlist/offers/${offerB.id}/decline`).set(auth(b.token))).status).toBe(200);
    const offerC = (await mine(c))[0].offer;
    expect(offerC).not.toBeNull();

    // C leaves the waitlist: A and B already had this slot, so nobody is left and it opens.
    const cEntry = (await mine(c))[0].id;
    await request(app).post(`/waitlist/${cEntry}/leave`).set(auth(c.token));
    expect(await slotBooked(s1.id)).toBe(false);
    expect(await prisma.waitlistOffer.count({ where: { status: "PENDING" } })).toBe(0);

    // One offer SMS per person for this slot, each logged.
    for (const p of [a, b, c]) expect(await offersSms(p.user.id)).toBe(1);
  });

  it("are claimed once, atomically, and then paid through the normal flow", async () => {
    const { doctor, date, s1, booker1, b1 } = await fullDay();
    const { a } = await waitingThree(doctor.id, date);
    await cancel(booker1, b1.appointmentId);
    const offerId = (await mine(a))[0].offer.id;

    const stranger = await createPatient();
    expect((await request(app).post(`/waitlist/offers/${offerId}/claim`).set(auth(stranger.token))).status).toBe(404);

    const [r1, r2] = await Promise.all([
      request(app).post(`/waitlist/offers/${offerId}/claim`).set(auth(a.token)),
      request(app).post(`/waitlist/offers/${offerId}/claim`).set(auth(a.token)),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([201, 409]);
    const appointment = (r1.status === 201 ? r1 : r2).body.appointment;
    expect(appointment).toMatchObject({ slotId: s1.id, patientId: a.patient.id, status: "PENDING_PAYMENT" });
    expect(await prisma.appointment.count({ where: { slotId: s1.id, status: { not: "CANCELLED" } } })).toBe(1);

    // No free booking: it is a normal hold until the signed payment webhook arrives.
    const order = await createOrder(app, a.token, appointment.id);
    await sendWebhook(app, capturedEvent(order.orderId, order.amount));
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: appointment.id } })).status).toBe("BOOKED");
    expect(await mine(a)).toEqual([]); // claimed: off the waitlist
  });

  it("an unpaid claim's hold expires and the slot goes to the next person", async () => {
    const { doctor, date, booker1, b1 } = await fullDay();
    const { a, b } = await waitingThree(doctor.id, date);
    await cancel(booker1, b1.appointmentId);
    const claim = await request(app).post(`/waitlist/offers/${(await mine(a))[0].offer.id}/claim`).set(auth(a.token));
    await prisma.appointment.update({ where: { id: claim.body.appointment.id }, data: { createdAt: new Date(Date.now() - 11 * 60_000) } });
    expect(await releaseExpiredHolds()).toBe(1);
    expect((await mine(b))[0].offer).not.toBeNull();
  });

  it("two slots freed at once never give one person two offers", async () => {
    const { doctor, date, s1, s2, booker1, booker2, b1, b2 } = await fullDay();
    const only = await createPatient();
    await join(only, doctor.id, date);
    await Promise.all([cancel(booker1, b1.appointmentId), cancel(booker2, b2.appointmentId)]);
    expect(await prisma.waitlistOffer.count({ where: { status: "PENDING" } })).toBe(1);
    expect([await slotBooked(s1.id), await slotBooked(s2.id)].sort()).toEqual([false, true]); // one held, one open
  });

  it("are made when the clinic cancels too", async () => {
    const { doctor, doctorToken, date, b1 } = await fullDay();
    const { a } = await waitingThree(doctor.id, date);
    await request(app).post(`/appointments/${b1.appointmentId}/cancel-by-clinic`).set(auth(doctorToken)).send({});
    expect((await mine(a))[0].offer).not.toBeNull();
  });

  it("are never made for an unverified or deactivated doctor, or a slot starting within 30 minutes", async () => {
    const { doctor, date, s1, booker1, b1 } = await fullDay();
    const { a } = await waitingThree(doctor.id, date);
    await prisma.doctor.update({ where: { id: doctor.id }, data: { verificationStatus: "PENDING" } });
    await cancel(booker1, b1.appointmentId);
    expect(await slotBooked(s1.id)).toBe(false);
    expect((await mine(a))[0].offer).toBeNull();
    expect(await offersSms(a.user.id)).toBe(0);

    // Today: one slot in 20 minutes and one in 2 hours, both booked.
    const { clinic } = await createClinicWithAdmin();
    const { doctor: d2 } = await createDoctor(clinic.id);
    const soon = await createSlotSoon(d2.id, 20);
    const later = await createSlotSoon(d2.id, 120);
    const p1 = await createPatient();
    const soonBooking = await bookAndPay(app, p1.token, soon.id);
    await bookAndPay(app, (await createPatient()).token, later.id);
    const w = await createPatient();
    expect((await join(w, d2.id, todayKey())).status).toBe(201);
    await cancel(p1, soonBooking.appointmentId);
    expect(await slotBooked(soon.id)).toBe(false); // too close to offer: simply open
    expect((await mine(w))[0].offer).toBeNull();
  });

  it("a claim fails if the doctor was deactivated, and the slot opens", async () => {
    const { doctor, date, s1, booker1, b1 } = await fullDay();
    const { a } = await waitingThree(doctor.id, date);
    await cancel(booker1, b1.appointmentId);
    const offerId = (await mine(a))[0].offer.id;
    await prisma.doctor.update({ where: { id: doctor.id }, data: { isActive: false } });
    expect((await request(app).post(`/waitlist/offers/${offerId}/claim`).set(auth(a.token))).status).toBe(409);
    expect(await slotBooked(s1.id)).toBe(false);
  });
});

describe("role isolation: waitlist", () => {
  it("staff see only a count, for their own doctor, and every view is logged", async () => {
    const { clinic, doctor, doctorToken, associateToken, adminToken, date } = await fullDay();
    const { a } = await waitingThree(doctor.id, date);
    await prisma.patient.update({ where: { id: a.patient.id }, data: { fullName: "Secret Name" } });

    const res = await request(app).get(`/doctors/${doctor.id}/waitlist?date=${date}`).set(auth(doctorToken));
    expect(res.body).toEqual({ date, waiting: 3 });
    const viaDesk = await request(app).get(`/doctors/${doctor.id}/waitlist?date=${date}`).set(auth(associateToken));
    expect(viaDesk.body).toEqual({ date, waiting: 3 });
    expect(JSON.stringify([res.body, viaDesk.body])).not.toMatch(/Secret|\+91/);
    expect(await prisma.auditLog.count({ where: { action: "STAFF_VIEWED_WAITLIST_COUNT" } })).toBe(2);

    // Doctor B, an unassigned associate, a patient and an admin are all refused.
    const { token: otherDoctor } = await createDoctor(clinic.id);
    expect((await request(app).get(`/doctors/${doctor.id}/waitlist?date=${date}`).set(auth(otherDoctor))).status).toBe(403);
    const { doctor: d3 } = await createDoctor(clinic.id);
    const { token: outsider } = await createAssociate(clinic.id, [d3.id]);
    expect((await request(app).get(`/doctors/${doctor.id}/waitlist?date=${date}`).set(auth(outsider))).status).toBe(403);
    expect((await request(app).get(`/doctors/${doctor.id}/waitlist?date=${date}`).set(auth(a.token))).status).toBe(403);
    expect((await request(app).get(`/doctors/${doctor.id}/waitlist?date=${date}`).set(auth(adminToken))).status).toBe(403);
  });

  it("patients reach only their own entries and offers; staff cannot use patient routes", async () => {
    const { doctor, doctorToken, associateToken, date, booker1, b1 } = await fullDay();
    const { a } = await waitingThree(doctor.id, date);
    await cancel(booker1, b1.appointmentId);
    const entry = (await mine(a))[0];
    const stranger = await createPatient();
    expect(await mine(stranger)).toEqual([]);
    expect((await request(app).post(`/waitlist/${entry.id}/leave`).set(auth(stranger.token))).status).toBe(404);
    expect((await request(app).post(`/waitlist/offers/${entry.offer.id}/decline`).set(auth(stranger.token))).status).toBe(404);
    for (const token of [doctorToken, associateToken]) {
      expect((await request(app).get("/waitlist/mine").set(auth(token))).status).toBe(403);
      expect((await request(app).post("/waitlist").set(auth(token)).send({ doctorId: doctor.id, date })).status).toBe(403);
      expect((await request(app).post(`/waitlist/offers/${entry.offer.id}/claim`).set(auth(token))).status).toBe(403);
    }
    expect((await mine(a))[0].offer).not.toBeNull(); // untouched
  });
});

describe("DPDP and the waitlist", () => {
  it("export includes the holder's and family members' entries and offers", async () => {
    const { doctor, date, booker1, b1 } = await fullDay();
    const p = await createPatient();
    const child = (await request(app).post("/me/patient/family").set(auth(p.token)).send({ fullName: "Asha", relationship: "CHILD", consent: true })).body.member;
    await join(p, doctor.id, date, child.id);
    await join(p, doctor.id, date);
    await cancel(booker1, b1.appointmentId);
    const res = await request(app).get("/me/patient/export").set(auth(p.token));
    expect(res.body.waitlist).toMatchObject([{ doctor: "Dr. Test", date, status: "WAITING", offers: [] }]);
    expect(res.body.familyMembers[0].waitlist).toMatchObject([{ date, status: "OFFERED", offers: [{ status: "PENDING" }] }]);
  });

  it("deleting a family member removes their entries and passes their offer to the next person", async () => {
    const { doctor, date, booker1, b1 } = await fullDay();
    const p = await createPatient();
    const child = (await request(app).post("/me/patient/family").set(auth(p.token)).send({ fullName: "Asha", relationship: "CHILD", consent: true })).body.member;
    await join(p, doctor.id, date, child.id);
    const next = await createPatient();
    await join(next, doctor.id, date);
    await cancel(booker1, b1.appointmentId);
    expect((await mine(p))[0].offer).not.toBeNull();

    await request(app).post(`/me/patient/family/${child.id}/delete`).set(auth(p.token)).send({ confirm: "DELETE" });
    expect(await prisma.waitlistEntry.count({ where: { patientId: child.id } })).toBe(0);
    expect((await mine(next))[0].offer).not.toBeNull();

    await request(app).post("/me/patient/delete").set(auth(next.token)).send({ confirm: "DELETE" });
    expect(await prisma.waitlistEntry.count()).toBe(0);
    expect(await prisma.waitlistOffer.count()).toBe(0);
  });
});
