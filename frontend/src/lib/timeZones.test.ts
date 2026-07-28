import { describe, expect, it } from "vitest";
import {
  findTimeZonePeriod,
  getTimelinePresetRange,
  getZonedDateParts,
  isValidTimeZone,
  type TimelineTimeZonePeriod,
  zonedDateTimeToUtc,
} from "./timeZones";

function period(
  id: string,
  start: string,
  end: string,
  timeZone: string,
): TimelineTimeZonePeriod {
  return {
    _id: id,
    start: new Date(start),
    end: new Date(end),
    timeZone,
    source: "manual",
  };
}

describe("timeline time zones", () => {
  it("validates IANA time-zone identifiers", () => {
    expect(isValidTimeZone("Europe/Paris")).toBe(true);
    expect(isValidTimeZone("Asia/Tbilisi")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus_Mons")).toBe(false);
  });

  it("uses the newest overlapping period", () => {
    const periods = [
      period("old", "2026-07-01T00:00:00Z", "2026-08-01T00:00:00Z", "UTC"),
      period(
        "new",
        "2026-07-20T00:00:00Z",
        "2026-07-30T00:00:00Z",
        "Europe/Paris",
      ),
    ];
    expect(
      findTimeZonePeriod(periods, new Date("2026-07-28T12:00:00Z"))?.timeZone,
    )
      .toBe("Europe/Paris");
  });

  it("converts a wall-clock midnight across daylight-saving time", () => {
    expect(
      zonedDateTimeToUtc(
        { year: 2026, month: 7, day: 28 },
        "Europe/Paris",
      ).toISOString(),
    ).toBe("2026-07-27T22:00:00.000Z");
    expect(
      zonedDateTimeToUtc(
        { year: 2026, month: 1, day: 28 },
        "Europe/Paris",
      ).toISOString(),
    ).toBe("2026-01-27T23:00:00.000Z");
  });

  it("builds Today from the selected time zone rather than the device zone", () => {
    const range = getTimelinePresetRange(
      "today",
      new Date("2026-07-28T00:30:00.000Z"),
      "Asia/Tokyo",
    );
    expect(range.start.toISOString()).toBe("2026-07-27T15:00:00.000Z");
    expect(range.end.toISOString()).toBe("2026-07-28T00:30:00.000Z");
  });

  it("formats the same instant as different local calendar values", () => {
    const instant = new Date("2026-07-28T22:30:00.000Z");
    expect(getZonedDateParts(instant, "UTC")).toMatchObject({
      year: 2026,
      month: 7,
      day: 28,
      hour: 22,
    });
    expect(getZonedDateParts(instant, "Asia/Tbilisi")).toMatchObject({
      year: 2026,
      month: 7,
      day: 29,
      hour: 2,
    });
  });
});
