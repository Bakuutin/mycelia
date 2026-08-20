import { expect } from "@std/expect";
import {
  apiAudioPipelineLiveHandler,
  applyActiveDiarizationRate,
} from "@/routes/api.audio.pipeline.live.ts";
import type { DiarizationCampaignSummary } from "@/routes/api.audio.pipeline.ts";
import { withFixtures } from "@/tests/fixtures.server.ts";
import { callExpressHandler } from "@/tests/express-helpers.ts";

function campaignSummary(
  overrides: Partial<DiarizationCampaignSummary> = {},
): DiarizationCampaignSummary {
  return {
    campaignId: "live-campaign",
    status: "running",
    processedChunks: 100,
    totalChunks: 1_000,
    pendingChunks: 900,
    processedSequences: 10,
    segmentsCreated: 20,
    errorCount: 0,
    chunksPerSecond: 0.25,
    rateStatus: "legacy",
    rateSampleCount: 0,
    sampledLanes: 0,
    activeRateJobCount: 0,
    activeRateReportingJobCount: 0,
    activeRateLaneCount: 0,
    usefulAudioRealtimeMultiple: null,
    rateWindowSeconds: null,
    successfulSequences: 0,
    skippedSequences: 0,
    recordingLeaseBusyOriginals: 0,
    recordingLeaseSkippedSequences: 0,
    chunkClaimSkips: 0,
    skipRatio: null,
    leaseSkipRatio: null,
    claimSkipRatio: null,
    stageTimingsMs: {},
    etaSeconds: 3_600,
    batchNumber: 1,
    estimatedBatches: 10,
    totalEstimated: false,
    ...overrides,
  };
}

Deno.test("audio pipeline live status: sums active task average rates", () => {
  const checkedAt = new Date("2026-08-21T12:02:00Z");
  const result = applyActiveDiarizationRate(
    campaignSummary(),
    [
      {
        id: "job-a",
        state: "active",
        campaignId: "live-campaign",
        providerProfileId: "gpu-1",
        processedOn: checkedAt.getTime() - 120_000,
        progress: {
          campaignId: "live-campaign",
          batch_chunks_processed: 60,
          elapsed_seconds: 90,
        },
      },
      {
        id: "job-b",
        state: "active",
        campaignId: "live-campaign",
        providerProfileId: "gpu-2",
        processedOn: checkedAt.getTime() - 60_000,
        progress: {
          campaignId: "live-campaign",
          batch_chunks_processed: 30,
          elapsed_seconds: 55,
        },
      },
      {
        id: "other-campaign",
        state: "active",
        campaignId: "another-campaign",
        providerProfileId: "gpu-3",
        processedOn: checkedAt.getTime() - 60_000,
        progress: {
          campaignId: "another-campaign",
          batch_chunks_processed: 600,
        },
      },
    ],
    checkedAt,
  );

  expect(result).toMatchObject({
    chunksPerSecond: 1,
    etaSeconds: 810,
    rateStatus: "live",
    activeRateJobCount: 2,
    activeRateReportingJobCount: 2,
    activeRateLaneCount: 2,
  });
});

Deno.test(
  "audio pipeline live status: reports warming active tasks without replacing fallback rate",
  () => {
    const result = applyActiveDiarizationRate(
      campaignSummary(),
      [{
        id: "warming-job",
        state: "active",
        campaignId: "live-campaign",
        providerProfileId: "gpu-1",
        processedOn: Date.now() - 30_000,
        progress: {
          campaignId: "live-campaign",
          batch_chunks_processed: 0,
        },
      }],
      new Date(),
    );

    expect(result).toMatchObject({
      chunksPerSecond: 0.25,
      rateStatus: "legacy",
      activeRateJobCount: 1,
      activeRateReportingJobCount: 0,
      activeRateLaneCount: 0,
    });
  },
);

Deno.test(
  "audio pipeline live status: reports campaign independently of exact stats",
  withFixtures(["AdminAuthHeaders", "Mongo"], async (
    headers: HeadersInit,
    { db },
  ) => {
    await db.collection("diarization_campaigns").insertOne({
      campaignId: "live-campaign",
      mode: "missing",
      status: "running",
      processedChunks: 25,
      totalChunks: 100,
      pendingChunks: 75,
      updatedAt: new Date(),
    });
    const response = await callExpressHandler(
      apiAudioPipelineLiveHandler,
      "http://localhost:3000/api/audio/pipeline/live",
      { headers },
    );
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.campaign).toMatchObject({
      campaignId: "live-campaign",
      status: "running",
      pendingChunks: 75,
      rateStatus: "warming",
    });
    expect(data.jobs.available).toBe(true);
    expect(typeof data.jobs.active).toBe("number");
    expect(typeof data.capacity.enabledSlots).toBe("number");
  }),
);
