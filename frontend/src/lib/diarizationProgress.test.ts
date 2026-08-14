import { describe, expect, it } from "vitest";
import { getDiarizationProgressView } from "./diarizationProgress";

describe("getDiarizationProgressView", () => {
  it("formats bounded progress, throughput, and ETA", () => {
    expect(getDiarizationProgressView({
      total_chunks: 10,
      chunks_processed: 3,
      chunks_remaining: 7,
      chunks_per_second: 0.5,
      eta_seconds: 14,
    })).toEqual({
      percent: 30,
      progressLabel: "3 / 10 chunks",
      remainingLabel: "7 chunks remaining in range",
      rateLabel: "30.0 chunks/min",
      etaLabel: "About 14s remaining",
    });
  });

  it("does not invent an ETA before measurable work completes", () => {
    expect(getDiarizationProgressView({ total_chunks: 10 })).toEqual({
      percent: 0,
      progressLabel: "0 / 10 chunks",
      remainingLabel: "10 chunks remaining in range",
      rateLabel: null,
      etaLabel: "ETA available after the first completed sequence",
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
      rateLabel: "15.0 chunks/min",
      etaLabel: null,
    });
  });
});
