import type { AppointmentStatus } from "@prisma/client";
import { HttpError } from "../middleware/errorHandler";

/**
 * The only allowed appointment status transitions (PRD section 7). Anything
 * not listed here is a 409, including re-entering the same state.
 */
const ALLOWED_TRANSITIONS: Record<AppointmentStatus, AppointmentStatus[]> = {
  PENDING_PAYMENT: ["BOOKED", "CANCELLED"],
  BOOKED: ["CHECKED_IN", "CANCELLED", "NO_SHOW"],
  CHECKED_IN: ["IN_CONSULTATION", "NO_SHOW"],
  IN_CONSULTATION: ["COMPLETED"],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
};

export function assertTransition(from: AppointmentStatus, to: AppointmentStatus): void {
  if (!ALLOWED_TRANSITIONS[from]?.includes(to)) {
    throw new HttpError(409, `Cannot move appointment from ${from} to ${to}`);
  }
}
