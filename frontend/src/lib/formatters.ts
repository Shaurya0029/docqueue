import { intlLocale } from "./locale";

/**
 * Clinics run on IST. Times and calendar days are always shown in IST, so a
 * patient or a test browser in another timezone sees the clinic's schedule.
 */
export const CLINIC_TZ = "Asia/Kolkata";

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(intlLocale(), { hour: "2-digit", minute: "2-digit", timeZone: CLINIC_TZ });
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(intlLocale(), { weekday: "short", day: "numeric", month: "short", timeZone: CLINIC_TZ });
}

/** Formats a yyyy-mm-dd day key (a calendar day, no time) without shifting it. */
export function formatDayKey(key: string, options: Intl.DateTimeFormatOptions): string {
  return new Date(`${key}T00:00:00Z`).toLocaleDateString(intlLocale(), { ...options, timeZone: "UTC" });
}

/** Hour of day (0-23) of an instant, in IST. */
export function clinicHour(iso: string): number {
  return Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone: CLINIC_TZ }).format(new Date(iso)));
}

export function formatRupees(amount: number): string {
  return `₹${amount.toLocaleString("en-IN")}`;
}

/** Today's IST calendar day as yyyy-mm-dd. */
export function todayKey(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: CLINIC_TZ }).format(new Date());
}

export function addDaysKey(key: string, days: number): string {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
