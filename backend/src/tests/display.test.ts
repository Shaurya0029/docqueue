import http from "http";
import type { AddressInfo } from "net";
import { afterAll, beforeAll, describe, it, expect } from "vitest";
import request from "supertest";
import WebSocket from "ws";
import { createApp } from "../app";
import { prisma } from "../lib/prisma";
import { attachWebSocketServer } from "../ws";
import { BOARD_FIELDS, boardSnapshot } from "../lib/displayLinks";
import { pickBoard, DISPLAY_REQUESTS_PER_MINUTE } from "../routes/display";
import { createAssociate, createClinicWithAdmin, createDoctor, createPatient, createSlotSoon } from "./factories";
import { bookAndPay } from "./paymentHelpers";

const app = createApp();
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
let ipCounter = 0;
/** Each test gets its own client IP so the per-IP limit never leaks between tests. */
const freshIp = () => `10.9.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}`;
const board = (token: string, ip = freshIp()) => request(app).get(`/display/${token}`).set("X-Forwarded-For", ip);

async function world() {
  const { clinic, token: adminToken } = await createClinicWithAdmin();
  const { doctor: a, token: tokenA } = await createDoctor(clinic.id);
  const { doctor: b, token: tokenB } = await createDoctor(clinic.id);
  await prisma.doctor.update({ where: { id: a.id }, data: { fullName: "Dr. Alpha" } });
  await prisma.doctor.update({ where: { id: b.id }, data: { fullName: "Dr. Beta" } });
  const { token: associateToken } = await createAssociate(clinic.id, [a.id]);
  const { token: otherAdmin } = await createClinicWithAdmin();
  const link = async (doctorId = a.id, token = tokenA) =>
    (await request(app).post(`/doctors/${doctorId}/display-link`).set(auth(token))).body.link as { token: string; prefix: string };
  return { clinic, a, b, tokenA, tokenB, adminToken, associateToken, otherAdmin, link };
}

/** Puts three patients in doctor's queue today: one in consultation, two checked in. */
async function busyDay(doctorId: string, associateToken: string, doctorToken: string) {
  const patients = [await createPatient(), await createPatient(), await createPatient()];
  for (const [i, p] of patients.entries()) {
    await prisma.patient.update({ where: { id: p.patient.id }, data: { fullName: `Secret Person ${i}`, address: "Hidden Street" } });
    const { qrToken } = await bookAndPay(app, p.token, (await createSlotSoon(doctorId, 2 + i)).id);
    await request(app).post("/appointments/qr/scan").set(auth(associateToken)).send({ token: qrToken });
  }
  await request(app).post(`/appointments/doctor/${doctorId}/call-next`).set(auth(doctorToken));
  return patients;
}

describe("display links: who can manage them", () => {
  it("the doctor (own board) and their clinic's admin create, view, regenerate and revoke; nobody else", async () => {
    const w = await world();
    const created = await request(app).post(`/doctors/${w.a.id}/display-link`).set(auth(w.tokenA));
    expect(created.status).toBe(201);
    expect(created.body.link.token).toMatch(/^[A-Za-z0-9_-]{43}$/); // 256 bits
    expect((await request(app).post(`/doctors/${w.a.id}/display-link`).set(auth(w.tokenA))).status).toBe(409);
    expect((await request(app).get(`/doctors/${w.a.id}/display-link`).set(auth(w.adminToken))).body.link.token).toBe(created.body.link.token);

    const patient = await createPatient();
    for (const token of [w.tokenB, w.associateToken, w.otherAdmin, patient.token]) {
      expect((await request(app).get(`/doctors/${w.a.id}/display-link`).set(auth(token))).status).toBe(403);
      expect((await request(app).post(`/doctors/${w.a.id}/display-link`).set(auth(token))).status).toBe(403);
      expect((await request(app).post(`/doctors/${w.a.id}/display-link/regenerate`).set(auth(token))).status).toBe(403);
      expect((await request(app).delete(`/doctors/${w.a.id}/display-link`).set(auth(token))).status).toBe(403);
    }
    expect((await board(created.body.link.token)).status).toBe(200); // untouched

    const regenerated = await request(app).post(`/doctors/${w.a.id}/display-link/regenerate`).set(auth(w.adminToken));
    expect(regenerated.status).toBe(200);
    expect((await request(app).delete(`/doctors/${w.a.id}/display-link`).set(auth(w.tokenA))).status).toBe(200);

    const audit = await prisma.auditLog.findMany({ where: { action: { startsWith: "DISPLAY_LINK_" } }, orderBy: { createdAt: "asc" } });
    expect(audit.map((x) => x.action)).toEqual(["DISPLAY_LINK_CREATED", "DISPLAY_LINK_REGENERATED", "DISPLAY_LINK_REVOKED"]);
    // Only a short prefix is ever recorded, never a whole token.
    const logged = JSON.stringify(audit);
    expect(logged).not.toContain(created.body.link.token);
    expect(logged).not.toContain(regenerated.body.link.token);
    expect(logged).toContain(created.body.link.token.slice(0, 6));
    // Stored hashed and encrypted, not in the clear.
    expect(JSON.stringify(await prisma.displayLink.findMany())).not.toContain(regenerated.body.link.token);
  });
});

describe("the board", () => {
  it("shows only the six allowed fields, for its own doctor only", async () => {
    const w = await world();
    await busyDay(w.a.id, w.associateToken, w.tokenA);
    const res = await board((await w.link()).token);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body)).toEqual(["board"]);
    expect(Object.keys(res.body.board).sort()).toEqual([...BOARD_FIELDS].sort());
    expect(res.body.board).toMatchObject({ clinicName: "Test Clinic", doctorName: "Dr. Alpha", state: "SERVING", nowServing: 1, next: [2, 3] });
    for (const t of res.body.board.next) expect(typeof t).toBe("number");

    // Nothing about any patient: names, addresses, phones, ids, payment.
    const text = JSON.stringify(res.body);
    for (const secret of ["Secret Person", "Hidden Street", "+91", "PAID", "appointment", "patient", w.a.id]) expect(text).not.toContain(secret);
    const ids = await prisma.appointment.findMany({ select: { id: true, patientId: true } });
    for (const { id, patientId } of ids) {
      expect(text).not.toContain(id);
      expect(text).not.toContain(patientId);
    }
  });

  it("can never carry an extra field, whatever the snapshot holds", async () => {
    const w = await world();
    const snapshot = await boardSnapshot(w.a.id);
    const tainted = { ...snapshot, patientName: "Asha", phoneNumber: "+919800000001", appointmentId: "x", payment: "PAID" };
    expect(Object.keys(pickBoard(tainted)).sort()).toEqual([...BOARD_FIELDS].sort());
  });

  it("shows queue paused and doctor not in", async () => {
    const w = await world();
    const token = (await w.link()).token;
    expect((await board(token)).body.board).toMatchObject({ state: "NOT_IN", nowServing: null, next: [] }); // no clinic today
    await createSlotSoon(w.a.id, 30);
    expect((await board(token)).body.board.state).toBe("SERVING");
    await request(app).post(`/doctors/${w.a.id}/queue/pause`).set(auth(w.tokenA)).send({ status: "PAUSED" });
    expect((await board(token)).body.board.state).toBe("PAUSED");
    await prisma.doctor.update({ where: { id: w.a.id }, data: { isActive: false } });
    expect((await board(token)).body.board.state).toBe("NOT_IN");
  });

  it("answers invalid, unknown and revoked links identically, with noindex and no-referrer", async () => {
    const w = await world();
    const { token } = await w.link();
    const ok = await board(token);
    expect(ok.headers["x-robots-tag"]).toContain("noindex");
    expect(ok.headers["referrer-policy"]).toBe("no-referrer");
    expect(ok.headers["cache-control"]).toBe("no-store");

    await request(app).post(`/doctors/${w.a.id}/display-link/regenerate`).set(auth(w.tokenA));
    const answers = [await board("not-a-token"), await board("A".repeat(43)), await board(token)];
    for (const r of answers) {
      expect(r.status).toBe(404);
      expect(r.body).toEqual({ error: "Not found" });
      expect(r.headers["x-robots-tag"]).toContain("noindex");
      expect(r.headers["referrer-policy"]).toBe("no-referrer");
    }
    expect(answers[0].text).toBe(answers[2].text);
  });

  it("stops working the moment the link is regenerated or revoked", async () => {
    const w = await world();
    const first = (await w.link()).token;
    const second = (await request(app).post(`/doctors/${w.a.id}/display-link/regenerate`).set(auth(w.tokenA))).body.link.token;
    expect((await board(first)).status).toBe(404);
    expect((await board(second)).status).toBe(200);
    await request(app).delete(`/doctors/${w.a.id}/display-link`).set(auth(w.adminToken));
    expect((await board(second)).status).toBe(404);
    // A fresh link can be created after revoking.
    expect((await board((await w.link()).token)).status).toBe(200);
  });

  it(`is rate-limited to ${DISPLAY_REQUESTS_PER_MINUTE} requests a minute per IP`, async () => {
    const w = await world();
    const { token } = await w.link();
    const ip = freshIp();
    for (let i = 0; i < DISPLAY_REQUESTS_PER_MINUTE; i++) expect((await board(token, ip)).status).toBe(200);
    expect((await board(token, ip)).status).toBe(429);
    expect((await board("unknown", ip)).status).toBe(429); // guessing is limited too
    expect((await board(token, freshIp())).status).toBe(200); // other clinics are unaffected
  });
});

describe("the board's live socket", () => {
  let server: http.Server;
  let port: number;
  beforeAll(async () => {
    server = http.createServer(app);
    attachWebSocketServer(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  /** Opens a board socket and records everything it receives and how it closes. */
  async function connect(display: string) {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?display=${encodeURIComponent(display)}`);
    const messages: Record<string, unknown>[] = [];
    const closed = new Promise<number>((resolve) => ws.on("close", (code) => resolve(code)));
    ws.on("message", (raw) => messages.push(JSON.parse(String(raw))));
    return { ws, messages, closed };
  }
  const settle = (ms = 400) => new Promise((r) => setTimeout(r, ms));
  async function until(check: () => boolean, ms = 3000) {
    const start = Date.now();
    while (!check() && Date.now() - start < ms) await settle(50);
  }

  it("receives only its own doctor's boards, never raw queue events, and closes when revoked", async () => {
    const w = await world();
    const { token } = await w.link();
    const { token: assocB } = await createAssociate(w.clinic.id, [w.b.id]);
    const tv = await connect(token);
    await until(() => tv.messages.length >= 1);
    expect(tv.messages[0]).toMatchObject({ type: "BOARD", board: { doctorName: "Dr. Alpha" } });
    await settle(); // let the Redis subscription settle

    // Doctor B's queue moves: doctor A's board hears nothing.
    await busyDay(w.b.id, assocB, w.tokenB);
    await settle(800);
    expect(tv.messages).toHaveLength(1);

    // Doctor A's queue moves: whitelisted boards only, no appointment ids, no names.
    await busyDay(w.a.id, w.associateToken, w.tokenA);
    await until(() => tv.messages.some((m) => (m.board as { nowServing: number | null }).nowServing === 1));
    for (const m of tv.messages) {
      expect(Object.keys(m).sort()).toEqual(["board", "type"]);
      expect(m.type).toBe("BOARD");
      expect(Object.keys(m.board as object).sort()).toEqual([...BOARD_FIELDS].sort());
      expect((m.board as { doctorName: string }).doctorName).toBe("Dr. Alpha");
    }
    expect(JSON.stringify(tv.messages)).not.toMatch(/appointmentId|Secret Person|patient/i);

    // Revoked: the open board is closed at once.
    await request(app).delete(`/doctors/${w.a.id}/display-link`).set(auth(w.tokenA));
    expect(await tv.closed).toBe(4004);
  });

  it("refuses unknown and revoked links, and closes a board when its link is regenerated", async () => {
    const w = await world();
    expect(await (await connect("A".repeat(43))).closed).toBe(4004);
    expect(await (await connect("garbage")).closed).toBe(4004);
    const { token } = await w.link();
    const tv = await connect(token);
    await until(() => tv.messages.length >= 1);
    await request(app).post(`/doctors/${w.a.id}/display-link/regenerate`).set(auth(w.tokenA));
    expect(await tv.closed).toBe(4004);
    expect(await (await connect(token)).closed).toBe(4004);
  });
});
