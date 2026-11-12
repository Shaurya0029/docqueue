import { Router } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma";
import { asyncHandler, HttpError } from "../middleware/errorHandler";
import { requireAuth } from "../middleware/auth";
import { rateLimitByBodyField } from "../middleware/rateLimit";
import {
  otpRequestSchema,
  otpVerifySchema,
  staffLoginSchema,
  refreshSchema,
} from "../schemas";
import { checkOtp, requestOtp } from "../lib/otp";
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "../lib/jwt";

export const authRouter = Router();

authRouter.post(
  "/otp/request",
  asyncHandler(async (req, res) => {
    const { phoneNumber } = otpRequestSchema.parse(req.body);
    const { devOtp } = await requestOtp(phoneNumber, req.ip ?? "unknown");
    res.json({ ok: true, ...(devOtp ? { devOtp } : {}) });
  })
);

authRouter.post(
  "/otp/verify",
  asyncHandler(async (req, res) => {
    const { phoneNumber, code, fullName, consent } = otpVerifySchema.parse(req.body);
    if (!(await checkOtp(phoneNumber, code, false))) throw new HttpError(401, "Invalid or expired OTP");

    let user = await prisma.user.findUnique({ where: { phoneNumber }, include: { patient: true } });
    if (!user && consent !== true) {
      // DPDP: a new account needs explicit consent. Asked only after the OTP
      // is proven, so this response does not reveal which numbers exist; the
      // code stays valid for the retry that carries consent.
      throw new HttpError(428, "Please accept the privacy notice to create your account", "CONSENT_REQUIRED");
    }
    if (!(await checkOtp(phoneNumber, code, true))) throw new HttpError(401, "Invalid or expired OTP");
    if (!user) {
      user = await prisma.user.create({
        data: {
          phoneNumber,
          role: "PATIENT",
          patient: {
            create: {
              fullName: fullName ?? null,
              consentAt: new Date(),
            },
          },
        },
        include: { patient: true },
      });
    }
    if (!user.isActive) throw new HttpError(403, "Account disabled");
    if (user.role !== "PATIENT") throw new HttpError(403, "Use staff login for this account");
    if (!user.patient) throw new HttpError(500, "Patient profile missing");

    const payload = { userId: user.id, role: user.role, profileId: user.patient.id };
    res.json({
      accessToken: signAccessToken(payload),
      refreshToken: signRefreshToken(payload),
      user: { id: user.id, role: user.role, phoneNumber: user.phoneNumber },
    });
  })
);

authRouter.post(
  "/staff/login",
  rateLimitByBodyField("phoneNumber", 10, 15 * 60 * 1000),
  asyncHandler(async (req, res) => {
    const { phoneNumber, password } = staffLoginSchema.parse(req.body);
    const user = await prisma.user.findUnique({
      where: { phoneNumber },
      include: { doctor: true, associate: true, admin: true },
    });
    if (!user || !user.passwordHash) throw new HttpError(401, "Invalid credentials");
    if (!user.isActive) throw new HttpError(403, "Account disabled");
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw new HttpError(401, "Invalid credentials");

    const profileId = user.doctor?.id ?? user.associate?.id ?? user.admin?.id;
    if (!profileId) throw new HttpError(500, "Staff profile missing");

    const payload = { userId: user.id, role: user.role, profileId };
    res.json({
      accessToken: signAccessToken(payload),
      refreshToken: signRefreshToken(payload),
      user: { id: user.id, role: user.role, phoneNumber: user.phoneNumber },
    });
  })
);

authRouter.post(
  "/refresh",
  asyncHandler(async (req, res) => {
    const { refreshToken } = refreshSchema.parse(req.body);
    let payload;
    try {
      payload = verifyRefreshToken(refreshToken);
    } catch {
      throw new HttpError(401, "Invalid or expired refresh token");
    }
    const user = await prisma.user.findUnique({ where: { id: payload.userId } });
    if (!user || !user.isActive) throw new HttpError(403, "Account disabled");
    res.json({ accessToken: signAccessToken(payload) });
  })
);

export const meRouter = Router();

meRouter.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const auth = req.auth!;
    const user = await prisma.user.findUnique({
      where: { id: auth.userId },
      include: { patient: true, doctor: true, associate: true, admin: true },
    });
    if (!user) throw new HttpError(404, "User not found");
    res.json({
      id: user.id,
      phoneNumber: user.phoneNumber,
      role: user.role,
      profile: user.patient ?? user.doctor ?? user.associate ?? user.admin,
    });
  })
);
