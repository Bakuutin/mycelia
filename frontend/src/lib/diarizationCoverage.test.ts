import { describe, expect, it } from "vitest";
import { coverageColor, dominantCoverageState } from "./diarizationCoverage";

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
});
