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
}

export interface DoctorSummary {
  id: string;
  fullName: string;
  specialization: string;
  consultationFee: number;
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
  gatewayRef: string | null;
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
}

export interface QueueStatus {
  status: AppointmentStatus;
  myToken: number | null;
  nowServing: number | null;
  /** Real patients still waiting before this one (tokens can have gaps). */
  patientsAhead: number | null;
  estimatedWaitMinutes: number | null;
}

export interface QueueEntry {
  appointmentId: string;
  token: number | null;
  patientName: string | null;
  status: AppointmentStatus;
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
