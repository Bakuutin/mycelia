import { describe, expect, it } from "vitest";
import { getDiarizationJobRoute } from "./jobRouting";

describe("getDiarizationJobRoute", () => {
  it("returns the snapshotted diarizator name and URL", () => {
    expect(getDiarizationJobRoute({
      id: "job-1",
      type: "diarization",
      data: { diarizationServerUrl: "http://diarizer.example.test:8085" },
      state: "active",
      progress: {},
      timestamp: 1,
      routingContext: {
        providerProfileId: "remote-diar",
        providerProfileName: "RTX 4090",
        resolvedAt: "2026-08-10T00:00:00.000Z",
      },
    })).toEqual({
      name: "RTX 4090",
      url: "http://diarizer.example.test:8085",
    });
  });

  it("also labels enrollment jobs and ignores unrelated workers", () => {
    expect(getDiarizationJobRoute({
      id: "job-2",
      type: "profileReenrollment",
      data: { diarizationServerUrl: "http://diarizator:8085" },
      state: "completed",
      progress: {},
      timestamp: 1,
    })).toEqual({
      name: "Diarizator",
      url: "http://diarizator:8085",
    });
    expect(getDiarizationJobRoute({
      id: "job-3",
      type: "vad",
      data: { diarizationServerUrl: "http://diarizator:8085" },
      state: "completed",
      progress: {},
      timestamp: 1,
    })).toBeNull();
  });
});
