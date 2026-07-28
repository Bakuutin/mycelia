import { describe, expect, it } from "vitest";
import { formatLabel } from "./gregorian";

describe("Gregorian timeline labels", () => {
  it("formats a tick in the requested IANA time zone", () => {
    const labels = formatLabel(
      new Date("2026-07-28T12:00:00.000Z"),
      { hasSeconds: false },
      "Asia/Tbilisi",
    ).map(String);

    expect(labels[0]).toMatch(/16:00/);
    expect(labels).toContain("GMT+4");
    expect(labels).toContain("Jul 28");
  });
});
