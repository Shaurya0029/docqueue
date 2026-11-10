/**
 * All clinics run on India Standard Time. IST has no daylight saving, so a
 * fixed +05:30 offset is exact and needs no timezone database.
 *
 * A "date key" is the clinic-local calendar day as yyyy-mm-dd. Slots, queue
 * days and tokens are all grouped by it, so it must be computed in IST: in
 * UTC, anything booked between 00:00 and 05:30 IST lands on the wrong day.
 */
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

export function toDateKey(date: Date): string {
  return new Date(date.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

export function todayKey(): string {
  return toDateKey(new Date());
}

/** The instant at which the given IST wall-clock time ("HH:MM") occurs on dateKey. */
export function istDateTime(dateKey: string, time: string): Date {
  const [h, m] = time.split(":").map(Number);
  const midnightUtc = Date.parse(`${dateKey}T00:00:00.000Z`);
  return new Date(midnightUtc + (h * 60 + m) * 60_000 - IST_OFFSET_MS);
}

/** 0 = Sunday ... 6 = Saturday, for the IST calendar day. */
export function weekdayOf(dateKey: string): number {
  return new Date(`${dateKey}T00:00:00.000Z`).getUTCDay();
}

export function addDays(dateKey: string, days: number): string {
  const d = new Date(`${dateKey}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
