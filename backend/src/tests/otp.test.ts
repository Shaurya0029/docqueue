import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../app";
import { prisma } from "../lib/prisma";
import { getSmsProvider, ConsoleSmsProvider } from "../lib/sms";

const app = createApp();
let n = 0;
const newPhone = () => `+9197${String(10000000 + ++n).slice(-8)}`;

function requestOtp(phoneNumber: string, ip = "10.0.0.1") {
  return request(app).post("/auth/otp/request").set("X-Forwarded-For", ip).send({ phoneNumber });
}
function verify(body: Record<string, unknown>) {
  return request(app).post("/auth/otp/verify").send(body);
}

describe("OTP login", () => {
  it("texts the code through the SMS provider and logs a new patient in only with consent", async () => {
    const phoneNumber = newPhone();
    const sent = await requestOtp(phoneNumber);
    expect(sent.status).toBe(200);
    expect(sent.body.devOtp).toBe("123456"); // console provider outside production
    const sms = (getSmsProvider() as ConsoleSmsProvider).sent.at(-1)!;
    expect(sms.to).toBe(phoneNumber);
    expect(sms.message).toContain("123456");

    const noConsent = await verify({ phoneNumber, code: "123456", fullName: "Asha" });
    expect(noConsent.status).toBe(428);
    expect(noConsent.body.code).toBe("CONSENT_REQUIRED");
    expect(await prisma.user.count({ where: { phoneNumber } })).toBe(0);

    // The same code still works for the retry that carries consent.
    const ok = await verify({ phoneNumber, code: "123456", fullName: "Asha", consent: true });
    expect(ok.status).toBe(200);
    expect(ok.body.accessToken).toBeTruthy();
    const patient = await prisma.patient.findFirstOrThrow({ where: { user: { phoneNumber } } });
    expect(patient.consentAt).toBeInstanceOf(Date);

    // Consumed: the code cannot be replayed.
    expect((await verify({ phoneNumber, code: "123456" })).status).toBe(401);
  });

  it("lets an existing patient in without asking for consent again", async () => {
    const phoneNumber = newPhone();
    await requestOtp(phoneNumber);
    await verify({ phoneNumber, code: "123456", consent: true });
    await requestOtp(phoneNumber);
    expect((await verify({ phoneNumber, code: "123456" })).status).toBe(200);
  });

  it("allows 5 OTP requests per phone per hour", async () => {
    const phoneNumber = newPhone();
    for (let i = 0; i < 5; i++) expect((await requestOtp(phoneNumber, `10.0.1.${i}`)).status).toBe(200);
    expect((await requestOtp(phoneNumber, "10.0.1.99")).status).toBe(429);
    expect((await requestOtp(newPhone(), "10.0.1.99")).status).toBe(200); // other numbers unaffected
  });

  it("limits one IP to 100 OTP requests per hour across numbers", async () => {
    for (let i = 0; i < 100; i++) expect((await requestOtp(newPhone(), "10.0.2.1")).status).toBe(200);
    expect((await requestOtp(newPhone(), "10.0.2.1")).status).toBe(429);
  });

  it("burns the code after 5 wrong guesses", async () => {
    const phoneNumber = newPhone();
    await requestOtp(phoneNumber);
    for (let i = 0; i < 5; i++) expect((await verify({ phoneNumber, code: "000000", consent: true })).status).toBe(401);
    expect((await verify({ phoneNumber, code: "123456", consent: true })).status).toBe(401);
  });

  it("rejects a code that was never requested", async () => {
    expect((await verify({ phoneNumber: newPhone(), code: "123456", consent: true })).status).toBe(401);
  });
});
