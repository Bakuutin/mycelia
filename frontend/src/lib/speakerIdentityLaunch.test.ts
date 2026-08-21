import { describe, expect, it } from "vitest";
import {
  buildSpeakerIdentityLaunchData,
  compatibleSpeakerIdentityRuns,
} from "./speakerIdentityLaunch";

describe("speaker identity launch snapshot", () => {
  it("uses only an active compatible generation and preserves the validated snapshot", () => {
    const compatible = compatibleSpeakerIdentityRuns([
      {
        runId: "stale-run",
        status: "superseded",
        embeddingSpaceId: "space-current",
      },
      {
        runId: "wrong-space",
        status: "active",
        embeddingSpaceId: "space-old",
      },
      {
        runId: "active-current",
        status: "active",
        embeddingSpaceId: "space-current",
      },
    ], "space-current");

    expect(compatible.map((run) => run.runId)).toEqual(["active-current"]);

    const start = new Date("2026-08-20T12:00:00.000Z");
    const end = new Date("2026-08-21T12:00:00.000Z");
    expect(buildSpeakerIdentityLaunchData({
      profileId: "sky-id",
      profileRevision: 4,
      calibrationId: "sky-r4-validated",
      embeddingSpaceId: "space-current",
      runId: compatible[0].runId,
      start,
      end,
    })).toEqual({
      type: "speakerIdentity",
      runId: "active-current",
      profileId: "sky-id",
      profileRevision: 4,
      calibrationId: "sky-r4-validated",
      start,
      end,
      limit: 1000,
    });
  });
});
