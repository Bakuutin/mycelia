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
});
