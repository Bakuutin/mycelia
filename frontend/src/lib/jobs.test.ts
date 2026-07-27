// @vitest-environment node
import { describe, expect, it } from "vitest";
import { formatJobDuration } from "./jobDuration";

describe("formatJobDuration", () => {
  it("formats a completed job duration", () => {
    expect(formatJobDuration(1_000, 62_500)).toBe("1m 1s");
  });

  it("uses the current time for an active job", () => {
    expect(formatJobDuration(1_000, undefined, 3_500)).toBe("2.5s");
  });

  it("does not display negative duration from stale restart timestamps", () => {
    expect(formatJobDuration(5_000, 4_000)).toBe("Restarted");
  });
});
