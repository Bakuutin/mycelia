import { describe, expect, it } from "vitest";
import {
  calendarDateInTimeZone,
  formatPickerDuration,
  replaceZonedCalendarDate,
  replaceZonedTime,
  zonedTimeInputValue,
} from "./datePicker";

describe("shared date picker timezone behavior", () => {
  const yerevan = "Asia/Yerevan";
  const instant = new Date("2026-08-25T00:41:38.000Z");

  it("shows the calendar date and clock in the same configured timezone", () => {
    const calendarDate = calendarDateInTimeZone(instant, yerevan);

    expect(calendarDate.getFullYear()).toBe(2026);
    expect(calendarDate.getMonth()).toBe(7);
    expect(calendarDate.getDate()).toBe(25);
    expect(zonedTimeInputValue(instant, yerevan, "minute")).toBe("04:41");
    expect(zonedTimeInputValue(instant, yerevan, "second")).toBe("04:41:38");
  });

  it("preserves the configured-zone clock when a calendar day changes", () => {
    const previousDay = new Date(2026, 7, 24);
    const changed = replaceZonedCalendarDate(
      instant,
      previousDay,
      yerevan,
      "second",
    );

    expect(changed.toISOString()).toBe("2026-08-24T00:41:38.000Z");
  });

  it("updates wall-clock time without mixing UTC and local fields", () => {
    const changed = replaceZonedTime(instant, "05:15", yerevan, "minute");

    expect(changed?.toISOString()).toBe("2026-08-25T01:15:00.000Z");
  });

  it("counts a same-day date-only range as one day", () => {
    expect(formatPickerDuration({ start: instant, end: instant }, "date"))
      .toBe("1 day");
  });
});
