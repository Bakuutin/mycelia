import { describe, expect, it } from "vitest";
import { getSpeakerIdentityProgressView } from "./speakerIdentityProgress";

describe("speaker identity progress", () => {
  it("renders completed 0/0 as an empty compatible set", () => {
    expect(getSpeakerIdentityProgressView({
      status: "completed",
      processed: 0,
      total: 0,
      remaining: 0,
      etaSeconds: null,
    })).toMatchObject({
      progressLabel: "No compatible segments",
      etaLabel: "Nothing to classify",
      remainingLabel: null,
      noCompatibleSegments: true,
    });
  });

  it("never estimates ETA for a completed campaign", () => {
    expect(
      getSpeakerIdentityProgressView({
        status: "completed",
        processed: 12,
        total: 12,
        etaSeconds: null,
      }).etaLabel,
    ).toBe("Complete");
  });
});
