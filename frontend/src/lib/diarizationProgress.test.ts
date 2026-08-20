import { describe, expect, it } from "vitest";
import {
  formatDiarizationWorkerRate,
  getCompletedDiarizationWorkerRate,
  getDiarizationCampaignProgressView,
  getDiarizationProgressView,
  getDiarizationSkipMetricsView,
  isOpenDiarizationCampaignStatus,
} from "./diarizationProgress";

describe("getDiarizationProgressView", () => {
  it("formats bounded progress, throughput, and ETA", () => {
    expect(getDiarizationProgressView({
      total_chunks: 10,
      chunks_processed: 3,
      chunks_remaining: 7,
      chunks_per_second: 0.5,
      worker_chunks_per_second: 0.25,
      eta_seconds: 14,
      batch_sequences_processed: 2,
      batch_sequences_total: 8,
      batch_chunks_processed: 3,
    })).toEqual({
      percent: 30,
      progressLabel: "3 / 10 chunks",
      remainingLabel: "7 chunks remaining in range",
      rateLabel: "Recent jobs average: 30.0 chunks/min",
      etaLabel: "About 14s remaining",
      batchPercent: 25,
      batchProgressLabel: "2 / up to 8 sequences in this job",
      batchChunksLabel: "3 chunks in this job",
      workerRateLabel: "This worker: 15.0 chunks/min",
    });
  });

  it("does not invent an ETA before measurable work completes", () => {
    expect(getDiarizationProgressView({ total_chunks: 10 })).toEqual({
      percent: 0,
      progressLabel: "0 / 10 chunks",
      remainingLabel: "10 chunks remaining in range",
      rateLabel: null,
      etaLabel: "ETA available after the first completed sequence",
      batchPercent: null,
      batchProgressLabel: null,
      batchChunksLabel: null,
      workerRateLabel: null,
    });
  });

  it("shows measured work without an unavailable-total warning", () => {
    expect(getDiarizationProgressView({
      total_chunks: null,
      total_estimated: true,
      chunks_processed: 6,
      chunks_per_second: 0.25,
    })).toEqual({
      percent: 0,
      progressLabel: "6 chunks processed",
      remainingLabel: null,
      rateLabel: "Recent jobs average: 15.0 chunks/min",
      etaLabel: null,
      batchPercent: null,
      batchProgressLabel: null,
      batchChunksLabel: null,
      workerRateLabel: null,
    });
  });

  it("falls back to the legacy current-job rate field", () => {
    expect(getDiarizationProgressView({
      current_chunks_per_second: 1.25,
      batch_sequences_processed: 1,
      batch_sequences_total: 4,
    })).toMatchObject({
      batchPercent: 25,
      batchProgressLabel: "1 / up to 4 sequences in this job",
      workerRateLabel: "This worker: 75.0 chunks/min",
    });
  });
});

describe("getDiarizationCampaignProgressView", () => {
  it("formats persisted campaign-wide progress", () => {
    expect(getDiarizationCampaignProgressView({
      processedChunks: 40,
      totalChunks: 100,
      pendingChunks: 60,
      chunksPerSecond: 0.75,
      rateStatus: "aggregate",
      usefulAudioRealtimeMultiple: 7.5,
      rateWindowSeconds: 120,
      successfulSequences: 8,
      skippedSequences: 1,
      claimSkipRatio: 0.125,
      etaSeconds: 80,
    })).toMatchObject({
      percent: 40,
      progressLabel: "40 / 100 chunks",
      remainingLabel: "60 chunks remaining in range",
      rateLabel: "Rolling 5 min, completed tasks: 45.0 chunks/min",
      etaLabel: "About 2m remaining",
    });
  });

  it("labels the live rate as a rolling active plus completed average", () => {
    expect(getDiarizationCampaignProgressView({
      processedChunks: 40,
      totalChunks: 100,
      pendingChunks: 60,
      chunksPerSecond: 1.5,
      rateStatus: "live",
      etaSeconds: 40,
    })).toMatchObject({
      rateLabel: "Rolling 5 min, active + completed: 90.0 chunks/min",
      etaLabel: "About 40s remaining",
    });
  });

  it("does not invent a percentage when the campaign total is unknown", () => {
    expect(getDiarizationCampaignProgressView({
      processedChunks: 12,
      totalChunks: null,
      pendingChunks: null,
      chunksPerSecond: null,
      usefulAudioRealtimeMultiple: null,
      rateWindowSeconds: null,
      successfulSequences: 0,
      skippedSequences: 0,
      claimSkipRatio: null,
      etaSeconds: null,
    })).toMatchObject({
      percent: 0,
      progressLabel: "12 chunks processed",
      remainingLabel: null,
      etaLabel: null,
    });
  });

  it("treats completed campaigns as terminal", () => {
    expect(isOpenDiarizationCampaignStatus("running")).toBe(true);
    expect(isOpenDiarizationCampaignStatus("interrupted")).toBe(true);
    expect(isOpenDiarizationCampaignStatus("completed")).toBe(false);
    expect(isOpenDiarizationCampaignStatus("completed_with_errors")).toBe(
      false,
    );
  });
});

describe("getDiarizationSkipMetricsView", () => {
  it("formats aggregate, lease, and claim metrics separately", () => {
    expect(getDiarizationSkipMetricsView({
      processedChunks: 40,
      totalChunks: 100,
      pendingChunks: 60,
      chunksPerSecond: 0.75,
      successfulSequences: 16,
      skippedSequences: 4,
      recordingLeaseBusyOriginals: 3,
      recordingLeaseSkippedSequences: 3,
      chunkClaimSkips: 1,
      skipRatio: 0.25,
      leaseSkipRatio: 0.1875,
      claimSkipRatio: 0.0625,
      etaSeconds: 80,
    })).toEqual({
      totalLabel: "25.0% · 4",
      leaseLabel: "3 · 18.8% · 3 busy",
      claimLabel: "1 · 6.3%",
    });
  });

  it("keeps legacy campaigns with missing breakdown fields readable", () => {
    expect(getDiarizationSkipMetricsView({
      processedChunks: 12,
      totalChunks: null,
      pendingChunks: null,
      chunksPerSecond: null,
      skippedSequences: 3,
      claimSkipRatio: 1,
      etaSeconds: null,
    })).toEqual({
      totalLabel: "100.0% · 3",
      leaseLabel: "0 · 0 busy",
      claimLabel: "0",
    });
  });
});

describe("completed diarization worker rate", () => {
  it("prefers the final rate persisted by the worker", () => {
    expect(getCompletedDiarizationWorkerRate(
      {
        worker_chunks_per_second: 0.75,
        chunks_processed: 36,
      },
      1_000,
      59_600,
    )).toBe(0.75);
  });

  it("derives a legacy completed-job rate from chunks and duration", () => {
    const rate = getCompletedDiarizationWorkerRate(
      { chunks_processed: 36 },
      1_000,
      59_600,
    );
    expect(formatDiarizationWorkerRate(rate)).toBe(
      "This worker: 36.9 chunks/min",
    );
  });
});
