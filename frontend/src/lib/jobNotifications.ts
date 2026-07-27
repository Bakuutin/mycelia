import type { Notification } from "@/stores/notificationStore";

export type PendingNotification = Omit<
  Notification,
  "id" | "timestamp" | "read"
>;

interface SummarizationResult {
  objectId?: string;
  title?: string;
  end?: string;
  processed?: number;
}

export function buildSummarizationCompletionNotification(
  result: SummarizationResult | undefined,
): PendingNotification | null {
  if (!result) return null;

  if (result.objectId) {
    const title = result.title || "Conversation";
    const date = result.end
      ? new Date(result.end).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
      : "";

    return {
      type: "success",
      title: "Summarization completed",
      description: `"${title}"${date ? ` • ${date}` : ""}`,
      action: { label: "View", path: `/objects/${result.objectId}` },
    };
  }

  if (typeof result.processed === "number" && result.processed > 0) {
    const count = result.processed;
    return {
      type: "success",
      title: count === 1
        ? "1 summary completed"
        : `${count} summaries completed`,
      description: count === 1
        ? "A new conversation summary is ready."
        : `${count} new conversation summaries are ready.`,
      action: { label: "View summaries", path: "/summaries" },
    };
  }

  return null;
}
