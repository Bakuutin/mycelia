import { beforeEach, describe, expect, it } from "vitest";
import {
  formatTime,
  formatTimeRangeCount,
  formatTimeRangeDuration,
} from "./formatTime";
import { useSettingsStore } from "@/stores/settingsStore";

describe("formatTime", () => {
  const testDate = new Date("2024-01-15T14:30:45.000Z");

  beforeEach(() => {
    useSettingsStore.setState({ timeFormat: "gregorian-utc-iso" });
  });

  it("formats date as ISO string by default", () => {
    const result = formatTime(testDate);
    expect(result).toBe("2024-01-15T14:30:45.000Z");
  });

  it("formats date as ISO string when gregorian-utc-iso is specified", () => {
    const result = formatTime(testDate, "gregorian-utc-iso");
    expect(result).toBe("2024-01-15T14:30:45.000Z");
  });

  it("formats date as local ISO string when gregorian-local-iso is specified", () => {
    const result = formatTime(testDate, "gregorian-local-iso");
    expect(result).toContain("T");
    expect(result).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it("formats date as verbose format when gregorian-local-verbose is specified", () => {
    const result = formatTime(testDate, "gregorian-local-verbose");
    expect(result).toContain("January");
    expect(result).toContain("2024");
  });

  it("formats date as European format when gregorian-local-european is specified", () => {
    const result = formatTime(testDate, "gregorian-local-european");
    expect(result).toMatch(/\d{2}\/\d{2}\/\d{4}/);
  });

  it("formats date as American format when gregorian-local-american is specified", () => {
    const result = formatTime(testDate, "gregorian-local-american");
    expect(result).toMatch(/\d{2}\/\d{2}\/\d{4}/);
  });

  it("formats date as UTC verbose format when gregorian-utc-verbose is specified", () => {
    const result = formatTime(testDate, "gregorian-utc-verbose");
    expect(result).toContain("January");
    expect(result).toContain("UTC");
  });

  it("formats date as UTC European format when gregorian-utc-european is specified", () => {
    const result = formatTime(testDate, "gregorian-utc-european");
    expect(result).toContain("UTC");
    expect(result).toMatch(/\d{2}\/\d{2}\/\d{4}/);
  });

  it("formats date as UTC American format when gregorian-utc-american is specified", () => {
    const result = formatTime(testDate, "gregorian-utc-american");
    expect(result).toContain("UTC");
  });

  it("formats date as SI integer when si-int is specified", () => {
    const result = formatTime(testDate, "si-int");
    expect(result).toMatch(/^[\d,]+$/);
  });

  it("formats date as SI formatted when si-formatted is specified", () => {
    const result = formatTime(testDate, "si-formatted");
    expect(result).toBeTruthy();
    expect(typeof result).toBe("string");
  });
});

describe("formatTimeRangeCount", () => {
  it("formats singular count correctly", () => {
    expect(formatTimeRangeCount(1)).toBe("1 time range");
  });

  it("formats plural count correctly", () => {
    expect(formatTimeRangeCount(0)).toBe("0 time ranges");
    expect(formatTimeRangeCount(2)).toBe("2 time ranges");
    expect(formatTimeRangeCount(10)).toBe("10 time ranges");
  });
});

describe("formatTimeRangeDuration", () => {
  beforeEach(() => {
    useSettingsStore.setState({ timeFormat: "gregorian-utc-iso" });
  });

  it("formats duration in seconds", () => {
    const start = new Date("2024-01-15T14:30:00.000Z");
    const end = new Date("2024-01-15T14:30:30.000Z");
    expect(formatTimeRangeDuration(start, end)).toBe("30s");
  });

  it("formats duration in minutes", () => {
    const start = new Date("2024-01-15T14:30:00.000Z");
    const end = new Date("2024-01-15T14:35:00.000Z");
    expect(formatTimeRangeDuration(start, end)).toBe("5m");
  });

  it("formats duration in hours", () => {
    const start = new Date("2024-01-15T14:00:00.000Z");
    const end = new Date("2024-01-15T17:00:00.000Z");
    expect(formatTimeRangeDuration(start, end)).toBe("3h");
  });

  it("formats duration in days", () => {
    const start = new Date("2024-01-15T00:00:00.000Z");
    const end = new Date("2024-01-20T00:00:00.000Z");
    expect(formatTimeRangeDuration(start, end)).toBe("5d");
  });

  it("formats duration in weeks", () => {
    const start = new Date("2024-01-01T00:00:00.000Z");
    const end = new Date("2024-01-22T00:00:00.000Z");
    expect(formatTimeRangeDuration(start, end)).toBe("3w");
  });

  it("formats duration in months", () => {
    const start = new Date("2024-01-01T00:00:00.000Z");
    const end = new Date("2024-03-15T00:00:00.000Z");
    expect(formatTimeRangeDuration(start, end)).toBe("2mo");
  });

  it("formats duration in years", () => {
    const start = new Date("2020-01-01T00:00:00.000Z");
    const end = new Date("2024-01-01T00:00:00.000Z");
    expect(formatTimeRangeDuration(start, end)).toBe("4y");
  });

  it("formats zero duration", () => {
    const start = new Date("2024-01-15T14:30:00.000Z");
    const end = new Date("2024-01-15T14:30:00.000Z");
    expect(formatTimeRangeDuration(start, end)).toBe("0s");
  });
});
