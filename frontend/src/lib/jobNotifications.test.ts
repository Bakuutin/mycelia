import { describe, expect, it } from "vitest";
import { buildSummarizationCompletionNotification } from "./jobNotifications";

describe("buildSummarizationCompletionNotification", () => {
  it("links a single-object result to the summarized object", () => {
    expect(buildSummarizationCompletionNotification({
      objectId: "object-123",
      title: "Planning call",
    })).toEqual({
      type: "success",
      title: "Summarization completed",
      description: '"Planning call"',
      action: { label: "View", path: "/objects/object-123" },
    });
  });

  it("creates one notification for an automatic summary batch", () => {
    expect(buildSummarizationCompletionNotification({ processed: 12 }))
      .toEqual({
        type: "success",
        title: "12 summaries completed",
        description: "12 new conversation summaries are ready.",
        action: { label: "View summaries", path: "/summaries" },
      });
  });

  it("does not notify when an automatic batch produced no summaries", () => {
    expect(buildSummarizationCompletionNotification({ processed: 0 }))
      .toBeNull();
  });
});
