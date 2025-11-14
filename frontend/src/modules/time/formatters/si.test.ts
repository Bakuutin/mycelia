import { describe, expect, it } from "vitest";
import { formatDuration } from "./si";

describe("formatDuration", () => {
  it("formats zero duration", () => {
    const result = formatDuration(0);
    expect(result).toEqual(["0"]);
  });

  it("formats milliseconds", () => {
    const result = formatDuration(500);
    expect(result).toContain("500ms");
  });

  it("formats seconds", () => {
    const result = formatDuration(5000);
    expect(result).toContain("5s");
  });

  it("formats kiloseconds", () => {
    const result = formatDuration(5000000);
    expect(result).toContain("5ks");
  });

  it("formats megaseconds", () => {
    const result = formatDuration(5000000000);
    expect(result).toContain("5Ms");
  });

  it("formats gigaseconds", () => {
    const result = formatDuration(5000000000000);
    expect(result).toContain("5Gs");
  });

  it("formats teraseconds", () => {
    const result = formatDuration(5000000000000000);
    expect(result).toContain("5Ts");
  });

  it("formats mixed units correctly", () => {
    const result = formatDuration(3661000);
    expect(result.length).toBeGreaterThan(0);
    const formatted = result.join(" ");
    expect(formatted).toContain("s");
  });

  it("formats large durations with multiple segments", () => {
    const result = formatDuration(1234567890);
    expect(result.length).toBeGreaterThan(1);
  });

  it("handles negative durations", () => {
    const result = formatDuration(-5000);
    const formatted = result.join(" ");
    expect(formatted).toContain("-");
  });

  it("handles very small durations", () => {
    const result = formatDuration(1);
    expect(result.length).toBeGreaterThan(0);
  });

  it("returns segments as array", () => {
    const result = formatDuration(1000);
    expect(Array.isArray(result)).toBe(true);
  });

  it("formats 1 hour (3600 seconds)", () => {
    const result = formatDuration(3600000);
    const formatted = result.join(" ");
    expect(formatted).toContain("s");
  });

  it("formats 1 day in seconds", () => {
    const result = formatDuration(86400000);
    expect(result.length).toBeGreaterThan(0);
  });

  it("formats 1 year in seconds", () => {
    const result = formatDuration(31536000000);
    expect(result.length).toBeGreaterThan(0);
  });

  it("does not include zero segments", () => {
    const result = formatDuration(1000);
    expect(result.every((seg) => seg !== "0ms" && seg !== "0s")).toBe(true);
  });
});
