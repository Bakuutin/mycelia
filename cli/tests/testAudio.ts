import { expect } from "@std/expect";
import { parseDateOrRelativeTime } from "../utils.ts";

Deno.test("parseDateOrRelativeTime should handle relative times", () => {
  const now = Date.now();

  // Test relative times
  const fiveMinutesAgo = parseDateOrRelativeTime("5m");
  expect(fiveMinutesAgo).toBeInstanceOf(Date);
  expect(fiveMinutesAgo!.getTime()).toBeLessThan(now);
  expect(fiveMinutesAgo!.getTime()).toBeGreaterThan(now - 6 * 60 * 1000);

  const twoDaysAgo = parseDateOrRelativeTime("2d");
  expect(twoDaysAgo).toBeInstanceOf(Date);
  expect(twoDaysAgo!.getTime()).toBeLessThan(now);
  expect(twoDaysAgo!.getTime()).toBeGreaterThan(now - 3 * 24 * 60 * 60 * 1000);
});

Deno.test("parseDateOrRelativeTime should handle absolute dates", () => {
  const isoDate = "2024-01-15T10:30:00.000Z";
  const result = parseDateOrRelativeTime(isoDate);

  expect(result).toBeInstanceOf(Date);
  expect(result!.toISOString()).toBe(isoDate);
});

Deno.test("parseDateOrRelativeTime should handle undefined", () => {
  const result = parseDateOrRelativeTime(undefined);
  expect(result).toBeUndefined();
});

Deno.test("parseDateOrRelativeTime should throw for invalid input", () => {
  expect(() => parseDateOrRelativeTime("invalid-time")).toThrow(
    "Invalid time expression",
  );
});

Deno.test("parseDateOrRelativeTime should handle various time formats", () => {
  const now = Date.now();

  // Test different time units
  const oneHour = parseDateOrRelativeTime("1h");
  expect(oneHour).toBeInstanceOf(Date);
  expect(oneHour!.getTime()).toBeLessThan(now);
  expect(oneHour!.getTime()).toBeGreaterThan(now - 2 * 60 * 60 * 1000);

  const oneWeek = parseDateOrRelativeTime("1w");
  expect(oneWeek).toBeInstanceOf(Date);
  expect(oneWeek!.getTime()).toBeLessThan(now);
  expect(oneWeek!.getTime()).toBeGreaterThan(now - 8 * 24 * 60 * 60 * 1000);

  const oneYear = parseDateOrRelativeTime("1y");
  expect(oneYear).toBeInstanceOf(Date);
  expect(oneYear!.getTime()).toBeLessThan(now);
  expect(oneYear!.getTime()).toBeGreaterThan(
    now - 2 * 365 * 24 * 60 * 60 * 1000,
  );
});

Deno.test("parseDateOrRelativeTime should handle edge cases", () => {
  // Test zero duration
  const zeroTime = parseDateOrRelativeTime("0s");
  expect(zeroTime).toBeInstanceOf(Date);

  // Test very short duration
  const shortTime = parseDateOrRelativeTime("1s");
  expect(shortTime).toBeInstanceOf(Date);

  // Test very long duration
  const longTime = parseDateOrRelativeTime("100y");
  expect(longTime).toBeInstanceOf(Date);
});

Deno.test("parseDateOrRelativeTime should handle different date formats", () => {
  // Test ISO date
  const isoResult = parseDateOrRelativeTime("2024-01-15T10:30:00.000Z");
  expect(isoResult).toBeInstanceOf(Date);
  expect(isoResult!.toISOString()).toBe("2024-01-15T10:30:00.000Z");

  // Test date string
  const dateResult = parseDateOrRelativeTime("2024-01-15");
  expect(dateResult).toBeInstanceOf(Date);

  // Test date with time
  const dateTimeResult = parseDateOrRelativeTime("2024-01-15 10:30:00");
  expect(dateTimeResult).toBeInstanceOf(Date);
});

Deno.test("parseDateOrRelativeTime should handle malformed inputs", () => {
  // Test empty string
  expect(() => parseDateOrRelativeTime("")).toBeUndefined();

  // Test invalid relative time
  expect(() => parseDateOrRelativeTime("5x")).toThrow(
    "Invalid time expression",
  );

  // Test invalid date
  expect(() => parseDateOrRelativeTime("not-a-date")).toThrow(
    "Invalid time expression",
  );

  // Test negative time
  expect(() => parseDateOrRelativeTime("-5m")).toThrow(
    "Invalid time expression",
  );
});
