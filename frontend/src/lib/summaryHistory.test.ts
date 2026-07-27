import { describe, expect, it } from "vitest";
import {
  buildSummaryHistoryPipeline,
  buildSummaryTaskPipeline,
  normalizeSummaryHistoryResult,
  normalizeSummaryTaskResult,
} from "./summaryHistory";

describe("summary history aggregation", () => {
  it("filters by executed model and generated date", () => {
    const pipeline = buildSummaryHistoryPipeline({
      model: "Qwen.gguf",
      from: "2026-07-01",
      to: "2026-07-27",
      limit: 25,
    });

    const facet = pipeline[2].$facet as any;
    expect(facet.entries[0].$match.$expr.$eq[1]).toBe("Qwen.gguf");
    expect(facet.entries[0].$match["summaries.date"].$gte).toBeInstanceOf(Date);
    expect(facet.entries[0].$match["summaries.date"].$lte).toBeInstanceOf(Date);
    expect(facet.entries[2].$limit).toBe(25);
  });

  it("keeps the model list independent from active filters", () => {
    const pipeline = buildSummaryHistoryPipeline({ model: "Qwen.gguf" });
    const facet = pipeline[2].$facet as any;

    expect(facet.models[0].$project.model).toBeDefined();
    expect(facet.models.some((stage: any) => stage.$match?.$expr)).toBe(false);
  });

  it("normalizes an empty aggregation response", () => {
    expect(normalizeSummaryHistoryResult([])).toEqual({
      entries: [],
      models: [],
      total: 0,
    });
  });
});

describe("summary task aggregation", () => {
  it("filters unfinished jobs and keeps status counts independent", () => {
    const pipeline = buildSummaryTaskPipeline({
      status: "unfinished",
      model: "small",
      from: "2026-07-01",
      limit: 25,
    });
    const facet = pipeline[1].$facet as any;

    expect(facet.entries[0].$match.state.$in).toEqual([
      "active",
      "waiting",
      "delayed",
      "paused",
    ]);
    expect(facet.entries[0].$match["data.model"]).toBe("small");
    expect(facet.entries[2].$limit).toBe(25);
    expect(facet.counts[0].$match.state).toBeUndefined();
  });

  it("normalizes empty task statistics", () => {
    expect(normalizeSummaryTaskResult([])).toEqual({
      entries: [],
      models: [],
      counts: {
        total: 0,
        completed: 0,
        unfinished: 0,
        failed: 0,
        cancelled: 0,
      },
    });
  });
});
