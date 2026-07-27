import { describe, expect, it } from "vitest";
import {
  buildSummaryHistoryPipeline,
  normalizeSummaryHistoryResult,
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
