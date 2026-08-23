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
      id: "remote-diar",
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

  it("returns runtime provenance from a historical data snapshot", () => {
    expect(getDiarizationJobRoute({
      id: "job-runtime",
      type: "diarization",
      data: {
        diarizationServerUrl: "http://100.119.163.116:8085",
        routingContext: {
          modelId: "pyannote/speaker-diarization-community-1",
          modelVersion: "revision-1",
          embeddingSpaceId: "space-old",
          runtimeProvenanceSource: "historical_backfill_0069",
          resolvedAt: "2026-08-23T00:00:00.000Z",
        },
      },
      state: "completed",
      progress: {},
      timestamp: 1,
    })).toMatchObject({
      name: "Diarizator",
      modelId: "pyannote/speaker-diarization-community-1",
      modelVersion: "revision-1",
      embeddingSpaceId: "space-old",
      runtimeProvenanceSource: "historical_backfill_0069",
    });
  });
});
