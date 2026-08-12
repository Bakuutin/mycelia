import { describe, expect, it } from "vitest";
import {
  coverageBucketMs,
  coverageColor,
  dominantCoverageState,
  hasActiveDiarizationCoverage,
} from "./diarizationCoverage";

describe("diarization coverage", () => {
  it("prioritizes attention errors over pending and completed chunks", () => {
    expect(dominantCoverageState({
      diarized: 20,
      pending: 3,
      needs_attention: 1,
    })).toBe("needs_attention");
  });

  it("uses separate colors for coverage and speaker identity", () => {
    expect(coverageColor("diarized")).toBe("#2563eb");
    expect(coverageColor("processing")).toBe("#38bdf8");
    expect(coverageColor("pending")).toBe("#94a3b8");
  });

  it("keeps month-scale coverage requests on a stable bucket size", () => {
    const month = 30 * 86_400_000;

    expect(coverageBucketMs(month, 1_000)).toBe(3 * 60 * 60 * 1_000);
    expect(coverageBucketMs(month, 980)).toBe(3 * 60 * 60 * 1_000);
  });

  it("polls only while coverage has active work", () => {
    expect(hasActiveDiarizationCoverage({
      buckets: [{ counts: { processing: 1 } }],
      buildingRuns: [],
    })).toBe(true);
    expect(hasActiveDiarizationCoverage({
      buckets: [{ counts: { diarized: 20, pending: 2 } }],
      buildingRuns: [],
    })).toBe(false);
    expect(hasActiveDiarizationCoverage({
      buckets: [],
      buildingRuns: [{ runId: "building" }],
    })).toBe(true);
  });
});
