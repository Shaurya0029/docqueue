import { addDays, istDateTime, weekdayOf } from "./dates";

export interface SlotPattern {
  weekday: number; // 0 = Sunday ... 6 = Saturday
  startTime: string; // "HH:MM", IST
  endTime: string; // "HH:MM", IST
  slotMinutes: number;
}

export interface SlotInput {
  doctorId: string;
  startsAt: Date;
  endsAt: Date;
  slotDate: string;
}

/**
 * Expands a weekly pattern into concrete slots for every IST day from
 * fromDate to toDate inclusive. Times in the pattern are IST wall-clock
 * times; a slot that would run past endTime is not created.
 */
export function generateSlots(doctorId: string, fromDate: string, toDate: string, pattern: SlotPattern[]): SlotInput[] {
  const slots: SlotInput[] = [];
  for (let day = fromDate; day <= toDate; day = addDays(day, 1)) {
    for (const p of pattern.filter((x) => x.weekday === weekdayOf(day))) {
      const dayEnd = istDateTime(day, p.endTime).getTime();
      let cursor = istDateTime(day, p.startTime).getTime();
      const step = p.slotMinutes * 60_000;
      while (cursor + step <= dayEnd) {
        slots.push({ doctorId, startsAt: new Date(cursor), endsAt: new Date(cursor + step), slotDate: day });
        cursor += step;
      }
    }
  }
  return slots;
}
