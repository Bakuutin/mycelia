import { describe, expect, it } from "vitest";
import { coverageColor } from "./diarizationCoverage";
import {
  DIARIZATION_COVERAGE_LEGEND,
  SPEAKER_IDENTITY_LEGEND,
  speakerIdentityAppearance,
} from "./timelineDiarization";

describe("Timeline diarization colors", () => {
  it("keeps the speaker legend aligned with rendered segment colors", () => {
    for (const item of SPEAKER_IDENTITY_LEGEND) {
      expect(speakerIdentityAppearance(item.id)).toEqual(item);
    }
    expect(speakerIdentityAppearance("unknown").label).toBe("Unclassified");
  });

  it("keeps the coverage legend aligned with coverage colors", () => {
    for (
      const state of [
        "diarized",
        "processing",
        "pending",
        "needs_attention",
      ] as const
    ) {
      expect(
        DIARIZATION_COVERAGE_LEGEND.find((item) => item.id === state)?.color,
      ).toBe(coverageColor(state));
    }
  });
});
