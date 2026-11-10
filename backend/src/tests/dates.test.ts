import { describe, it, expect } from "vitest";
import { addDays, istDateTime, toDateKey, weekdayOf } from "../lib/dates";
import { generateSlots } from "../lib/slots";

describe("IST dates", () => {
  it("puts 00:00-05:30 IST on the IST day, not the previous UTC day", () => {
    // 2026-11-10 01:00 IST = 2026-11-09 19:30 UTC
    expect(toDateKey(new Date("2026-11-09T19:30:00.000Z"))).toBe("2026-11-10");
    expect(toDateKey(new Date("2026-11-09T18:29:59.000Z"))).toBe("2026-11-09");
  });

  it("converts an IST wall-clock time to the right instant", () => {
    expect(istDateTime("2026-11-10", "10:00").toISOString()).toBe("2026-11-10T04:30:00.000Z");
  });

  it("knows weekdays and month ends", () => {
    expect(weekdayOf("2026-11-10")).toBe(2); // Tuesday
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
  });
});

describe("generateSlots", () => {
  const weekdays = [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startTime: "10:00", endTime: "17:00", slotMinutes: 15 }));

  it("makes 28 fifteen-minute slots per weekday, 10:00 to 17:00 IST, and none at weekends", () => {
    // Mon 2026-11-09 .. Sun 2026-11-15
    const slots = generateSlots("doc", "2026-11-09", "2026-11-15", weekdays);
    expect(slots).toHaveLength(5 * 28);
    expect(slots[0].startsAt.toISOString()).toBe("2026-11-09T04:30:00.000Z");
    expect(slots.at(-1)!.endsAt.toISOString()).toBe("2026-11-13T11:30:00.000Z"); // 17:00 IST Friday
    expect(new Set(slots.map((s) => s.slotDate))).toEqual(
      new Set(["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13"])
    );
  });
});
