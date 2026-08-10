import { describe, expect, it } from "vitest";
import {
  getRunComparison,
  validateOperationRange,
} from "./voiceIdentityOperations";

describe("diarization run comparison readiness", () => {
  const legacy = {
    runId: "legacy-v0",
    status: "active" as const,
    generation: 0,
  };

  it("disables compare when only one run exists", () => {
    expect(getRunComparison(legacy, [legacy])).toMatchObject({
      enabled: false,
      reason: expect.stringContaining("Build a new"),
    });
  });

  it("names the active baseline for a ready replacement", () => {
    const next = {
      runId: "diar-1",
      status: "ready" as const,
      generation: 1,
      replacesRunId: "legacy-v0",
    };
    expect(getRunComparison(next, [legacy, next])).toMatchObject({
      enabled: true,
      baseline: legacy,
      reason: expect.stringContaining("legacy-v0"),
    });
  });

  it("keeps a building run disabled and explains why", () => {
    const next = {
      runId: "diar-1",
      status: "building" as const,
      generation: 1,
      replacesRunId: "legacy-v0",
    };
    expect(getRunComparison(next, [legacy, next])).toMatchObject({
      enabled: false,
      baseline: legacy,
      reason: expect.stringContaining("ready"),
    });
  });

  it("explains that an interrupted run must be replaced", () => {
    const next = {
      runId: "diar-6",
      status: "interrupted" as const,
      generation: 6,
      replacesRunId: "legacy-v0",
    };
    expect(getRunComparison(next, [legacy, next])).toMatchObject({
      enabled: false,
      reason: expect.stringContaining("interrupted"),
    });
  });
});

describe("custom diarization range", () => {
  it("rejects reversed ranges", () => {
    expect(validateOperationRange(new Date(20), new Date(10))).toContain(
      "after",
    );
  });

  it("accepts a bounded range", () => {
    expect(validateOperationRange(new Date(10), new Date(20))).toBeNull();
  });
});
