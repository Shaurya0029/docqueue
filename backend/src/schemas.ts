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
  /** A family member's patient id; omitted (or the holder's own id) books for the account holder. */
  patientId: z.string().uuid().optional(),
});

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use the format yyyy-mm-dd")
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && v <= new Date().toISOString().slice(0, 10) && v >= "1900-01-01", {
    message: "Enter a real date of birth, not in the future",
  });

/** A family member, added or changed by the account holder, who consents each time. */
export const familyMemberSchema = z
  .object({
    fullName: z.string().trim().min(2, "Enter the family member's name").max(80),
    relationship: z.enum(["PARENT", "CHILD", "SPOUSE", "OTHER"]),
    dateOfBirth: isoDate.nullable().optional(),
    ageYears: z.number().int().min(0).max(120).nullable().optional(),
    consent: z.literal(true, { errorMap: () => ({ message: "Consent is required to add a family member" }) }),
  })
  .strict();

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
  /** The code texted to the number's account holder, confirming the walk-in is their family member. */
  familyCode: z.string().regex(/^\d{6}$/, "Enter the 6-digit code").optional(),
});

export const walkInFamilyCodeSchema = z.object({
  fullName: z.string().trim().min(2).max(100),
  phoneNumber: z.string().regex(/^\+91[6-9]\d{9}$/, "Enter a valid Indian mobile number"),
});

export const leaveAlertSchema = z.union([
  // Read once in the browser, used to compute travel minutes, never stored.
  z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) }).strict(),
  z.object({ travelMinutes: z.number().int().min(1).max(300) }).strict(),
]);

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

/** NMC / state council registration numbers: letters, digits, / - . and spaces. */
const registrationNumberSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9][A-Za-z0-9/.\- ]{2,29}$/, "Enter the registration number as it appears on the certificate");
const registrationCouncilSchema = z.string().trim().min(2).max(100);

export const doctorUpdateSchema = z.object({
  registrationNumber: registrationNumberSchema.optional(),
  registrationCouncil: registrationCouncilSchema.optional(),
  consultationFee: z.number().int().positive().optional(),
  avgConsultMinutes: z.number().int().positive().optional(),
  bio: z.string().optional(),
  isActive: z.boolean().optional(),
});

/** Clinic location for "Leave now": both coordinates or neither (null clears them). */
const clinicLocation = {
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
};
const bothOrNeither = (v: { latitude?: number | null; longitude?: number | null }) =>
  (v.latitude == null) === (v.longitude == null);
const bothOrNeitherMessage = { message: "Enter both latitude and longitude, or neither", path: ["latitude"] };

export const clinicCreateSchema = z
  .object({ name: z.string().min(1), address: z.string().optional(), ...clinicLocation })
  .refine(bothOrNeither, bothOrNeitherMessage);

export const clinicUpdateSchema = z
  .object({ name: z.string().min(1).optional(), address: z.string().optional(), ...clinicLocation })
  .refine(bothOrNeither, bothOrNeitherMessage);

export const createDoctorSchema = z.object({
  phoneNumber: phoneSchema,
  fullName: z.string().min(1),
  specialization: z.string().min(1),
  consultationFee: z.number().int().positive(),
  avgConsultMinutes: z.number().int().positive().default(15),
  registrationNumber: registrationNumberSchema.optional(),
  registrationCouncil: registrationCouncilSchema.optional(),
});

export const verifyDoctorSchema = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("APPROVE") }),
  z.object({ decision: z.literal("REJECT"), reason: z.string().trim().min(3).max(300) }),
]);

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
