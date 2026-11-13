export type Role = "PATIENT" | "DOCTOR" | "ASSOCIATE" | "ADMIN";

export type AppointmentStatus =
  | "PENDING_PAYMENT"
  | "BOOKED"
  | "CHECKED_IN"
  | "IN_CONSULTATION"
  | "COMPLETED"
  | "CANCELLED"
  | "NO_SHOW";

export interface AuthUser {
  id: string;
  role: Role;
  phoneNumber: string;
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
}

export interface Clinic {
  id: string;
  name: string;
  address: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

export interface DoctorSummary {
  id: string;
  fullName: string;
  specialization: string;
  consultationFee: number;
  isVerified?: boolean;
  clinic: Clinic;
  nextSlot: Slot | null;
}

export interface DoctorBasic {
  id: string;
  fullName: string;
  specialization: string;
  consultationFee: number;
  avgConsultMinutes: number;
  isActive: boolean;
}

export interface DoctorProfile {
  id: string;
  fullName: string;
  specialization: string;
  consultationFee: number;
  avgConsultMinutes: number;
  bio: string | null;
  clinic: Clinic;
  slots: Slot[];
  isActive?: boolean;
  isVerified?: boolean;
  registration?: { number: string | null; council: string | null } | null;
}

export type VerificationStatus = "PENDING" | "APPROVED" | "REJECTED";

/** The doctor's own record (from /me), including verification details. */
export interface MyDoctorRecord {
  id: string;
  registrationNumber: string | null;
  registrationCouncil: string | null;
  verificationStatus: VerificationStatus;
  rejectionReason: string | null;
}

export interface Slot {
  id: string;
  doctorId: string;
  startsAt: string;
  endsAt: string;
  slotDate: string;
  isBooked: boolean;
}

export interface Payment {
  id: string;
  amount: number;
  status: "CREATED" | "PAID" | "FAILED" | "REFUNDED";
  gatewayRef?: string | null;
  refund?: { status: "PENDING" | "PROCESSED" | "FAILED"; amount: number } | null;
}

export interface Appointment {
  id: string;
  patientId: string;
  doctorId: string;
  slotId: string;
  status: AppointmentStatus;
  queueToken: number | null;
  queueDate: string | null;
  createdAt: string;
  doctor?: DoctorProfile;
  slot?: Slot;
  payment?: Payment | null;
  qrToken?: { token: string; shortCode: string | null; expiresAt: string; usedAt: string | null } | null;
  cancelReason?: string | null;
  /** Who the visit is for: the account holder, or a family member (accountHolderId set). */
  patient?: { id?: string; fullName: string | null; accountHolderId?: string | null };
  /** On the doctor's schedule: a number the clinic can call (a family member's account holder's). */
  contactPhone?: string | null;
  leaveAlert?: LeaveAlertState;
}

export type FamilyRelationship = "PARENT" | "CHILD" | "SPOUSE" | "OTHER";

export interface FamilyMember {
  id: string;
  fullName: string;
  relationship: FamilyRelationship;
  dateOfBirth: string | null;
  ageYears: number | null;
  ageRecordedOn: string | null;
  /** Under 18: the account holder consented as their guardian. */
  isMinor: boolean;
  consent: { givenAt: string | null; givenVia: "guardian" | "account-holder" | "desk" | null };
  addedAt: string;
}

export interface FamilyMemberInput {
  fullName: string;
  relationship: FamilyRelationship;
  dateOfBirth?: string | null;
  ageYears?: number | null;
  consent: true;
}

export interface LeaveAlertState {
  /** The clinic has a location, so the feature is offered. */
  available: boolean;
  /** False for a child's visit: no location is used, the travel time is typed. */
  locationAllowed: boolean;
  enabled: boolean;
  travelMinutes: number | null;
  source: "estimate" | "manual" | null;
  sentAt: string | null;
}

export interface QueueStatus {
  status: AppointmentStatus;
  myToken: number | null;
  nowServing: number | null;
  /** Real patients still waiting before this one (tokens can have gaps). */
  patientsAhead: number | null;
  estimatedWaitMinutes: number | null;
  /** The per-patient minutes used: the doctor's recent real average, or their configured one. */
  averageConsultMinutes?: number | null;
  estimateBasis?: "history" | "configured" | null;
  estimateSampleSize?: number | null;
}

export interface QueueEntry {
  appointmentId: string;
  token: number | null;
  patientName: string | null;
  status: AppointmentStatus;
  isWalkIn?: boolean;
}

export interface DoctorQueue {
  date: string;
  status: "OPEN" | "PAUSED" | "CLOSED";
  nowServing: number;
  queue: QueueEntry[];
}

export interface AuditLogEntry {
  id: string;
  actorUserId: string;
  action: string;
  targetType: string;
  targetId: string;
  createdAt: string;
}

export interface AdminOverviewRow {
  clinicId: string;
  clinicName: string;
  bookings: number;
  noShowRate: number;
  revenue: number;
}
