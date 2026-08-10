import { describe, expect, it } from "vitest";
import {
  buildDiarizationLaunchData,
  findOverlappingCampaign,
} from "./diarizationLaunch";

describe("diarization launch", () => {
  it("builds a safe missing-work payload without routing internals", () => {
    expect(buildDiarizationLaunchData({
      start: new Date("2026-08-03T00:00:00Z"),
      end: new Date("2026-08-10T00:00:00Z"),
      batchSequences: 4,
    })).toEqual({
      type: "diarization",
      mode: "missing",
      start: new Date("2026-08-03T00:00:00Z"),
      end: new Date("2026-08-10T00:00:00Z"),
      limit: 4,
      batchSize: 4,
    });
  });

  it("finds a live campaign overlapping the requested range", () => {
    const campaigns = [{
      campaignId: "campaign-1",
      status: "running",
      range: {
        start: "2026-08-05T00:00:00Z",
        end: "2026-08-09T00:00:00Z",
      },
    }];
    expect(
      findOverlappingCampaign(
        campaigns,
        new Date("2026-08-03T00:00:00Z"),
        new Date("2026-08-10T00:00:00Z"),
      )?.campaignId,
    ).toBe("campaign-1");
  });
});
