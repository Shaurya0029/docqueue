import { z } from "zod";

export const phoneSchema = z.string().regex(/^\+?[0-9]{10,15}$/, "Invalid phone number");

export const otpRequestSchema = z.object({ phoneNumber: phoneSchema });
export const otpVerifySchema = z.object({
  phoneNumber: phoneSchema,
  code: z.string().length(6),
  fullName: z.string().min(1).optional(),
  consent: z.boolean().optional(),
});

export const staffLoginSchema = z.object({
  phoneNumber: phoneSchema,
  password: z.string().min(6),
});

export const refreshSchema = z.object({ refreshToken: z.string() });

export const doctorSearchSchema = z.object({
  name: z.string().optional(),
  specialization: z.string().optional(),
  city: z.string().optional(),
  date: z.string().optional(),
});

export const patientUpdateSchema = z.object({
  fullName: z.string().min(1).optional(),
  address: z.string().optional(),
});

export const bookAppointmentSchema = z.object({
  slotId: z.string().uuid(),
});

export const createOrderSchema = z.object({
  appointmentId: z.string().uuid(),
});

export const cancelAppointmentSchema = z.object({
  reason: z.string().max(300).optional(),
});

export const walkInSchema = z.object({
  fullName: z.string().trim().min(2).max(100),
  phoneNumber: z.string().regex(/^\+91[6-9]\d{9}$/, "Enter a valid Indian mobile number"),
  feeCollected: z.boolean(),
  // The associate confirms the patient agreed, in person, to MEDORA storing their details.
  consent: z.literal(true, { errorMap: () => ({ message: "The patient's consent is required" }) }),
});

export const rescheduleSchema = z.object({
  slotId: z.string().uuid(),
});

export const qrScanSchema = z
  .object({
    token: z.string().min(1).optional(), // the scanned QR value
    code: z.string().min(1).max(20).optional(), // the short code typed at the desk
  })
  .refine((v) => Boolean(v.token) !== Boolean(v.code), { message: "Send either token or code" });

export const slotCreateSchema = z.object({
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
});

export const slotBulkCreateSchema = z.object({
  pattern: z.array(
    z.object({
      weekday: z.number().min(0).max(6),
      startTime: z.string().regex(/^\d{2}:\d{2}$/),
      endTime: z.string().regex(/^\d{2}:\d{2}$/),
      slotMinutes: z.number().min(5).max(120),
    })
  ),
  fromDate: z.string(),
  toDate: z.string(),
});

export const slotUpdateSchema = z.object({
  startsAt: z.string().datetime().optional(),
  endsAt: z.string().datetime().optional(),
});

export const doctorUpdateSchema = z.object({
  consultationFee: z.number().int().positive().optional(),
  avgConsultMinutes: z.number().int().positive().optional(),
  bio: z.string().optional(),
  isActive: z.boolean().optional(),
});

export const clinicCreateSchema = z.object({
  name: z.string().min(1),
  address: z.string().optional(),
});

export const clinicUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  address: z.string().optional(),
});

export const createDoctorSchema = z.object({
  phoneNumber: phoneSchema,
  fullName: z.string().min(1),
  specialization: z.string().min(1),
  consultationFee: z.number().int().positive(),
  avgConsultMinutes: z.number().int().positive().default(15),
});

export const createAssociateSchema = z.object({
  phoneNumber: phoneSchema,
  fullName: z.string().min(1),
  doctorIds: z.array(z.string().uuid()).default([]),
});

export const pauseQueueSchema = z.object({
  status: z.enum(["OPEN", "PAUSED", "CLOSED"]),
});

export const auditLogQuerySchema = z.object({
  actorUserId: z.string().uuid().optional(),
  action: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});
