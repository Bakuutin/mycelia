import { describe, expect, it } from "vitest";
import { buildFreshDiarizationGeneration } from "./diarizationRerun";

describe("buildFreshDiarizationGeneration", () => {
  it("replaces stale run and cursor with a new building generation", () => {
    const plan = buildFreshDiarizationGeneration({
      type: "diarization",
      mode: "build_generation",
      runId: "old-run",
      cursor: "2026-08-03T09:00:00Z",
      start: "2026-08-01T00:00:00Z",
      end: "2026-08-08T00:00:00Z",
      limit: 4,
    }, [
      { runId: "active-run", status: "active", generation: 5 },
      { runId: "old-run", status: "failed", generation: 6 },
    ], {
      embeddingSpaceId: "space-v2",
      diarizationFingerprint: "diar-v2",
    }, new Date("2026-08-10T04:05:06.000Z"));

    expect(plan.runId).toBe("diar-2026-08-10T04-05-06-000Z");
    expect(plan.createRun).toMatchObject({
      action: "create-run",
      generation: 7,
      replacesRunId: "active-run",
      embeddingSpaceId: "space-v2",
      diarizationFingerprint: "diar-v2",
    });
    expect(plan.jobData).toEqual({
      type: "diarization",
      mode: "build_generation",
      runId: plan.runId,
      start: "2026-08-01T00:00:00Z",
      end: "2026-08-08T00:00:00Z",
      limit: 4,
    });
  });

  it("requires live diarizator fingerprint metadata", () => {
    expect(() => buildFreshDiarizationGeneration({
      type: "diarization",
      mode: "build_generation",
    }, [], {}, new Date())).toThrow(/fingerprint/i);
  });
});
