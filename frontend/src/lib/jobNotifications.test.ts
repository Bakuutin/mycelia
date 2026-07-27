import { describe, expect, it } from "vitest";
import { buildSummarizationCompletionNotifications } from "./jobNotifications";

describe("buildSummarizationCompletionNotifications", () => {
  it("links a single-object result to the summarized object", () => {
    expect(buildSummarizationCompletionNotifications({
      objectId: "object-123",
      title: "Planning call",
    }, "job-456")).toEqual([{
      type: "success",
      title: "Planning call",
      description: "Summary completed",
      action: {
        label: "View summary",
        path: "/objects/object-123?summaryJobId=job-456",
      },
    }]);
  });

  it("creates one direct notification per summary in an automatic batch", () => {
    expect(buildSummarizationCompletionNotifications({
      processed: 2,
      summaries: [
        { objectId: "object-1", title: "First topic" },
        { objectId: "object-2", title: "Second topic" },
      ],
    }, "batch-job")).toEqual([
      {
        type: "success",
        title: "First topic",
        description: "Summary completed",
        action: {
          label: "View summary",
          path: "/objects/object-1?summaryJobId=batch-job",
        },
      },
      {
        type: "success",
        title: "Second topic",
        description: "Summary completed",
        action: {
          label: "View summary",
          path: "/objects/object-2?summaryJobId=batch-job",
        },
      },
    ]);
  });

  it("keeps an aggregate fallback for older batch results", () => {
    expect(
      buildSummarizationCompletionNotifications({ processed: 12 }, "old-job"),
    )
      .toEqual([{
        type: "success",
        title: "12 summaries completed",
        description: "12 new conversation summaries are ready.",
        action: { label: "View summaries", path: "/summaries" },
      }]);
  });

  it("does not notify when an automatic batch produced no summaries", () => {
    expect(buildSummarizationCompletionNotifications({ processed: 0 }, "job"))
      .toEqual([]);
  });
});
