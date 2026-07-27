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
  summaries?: Array<{
    objectId: string;
    title?: string;
  }>;
}

function buildObjectNotification(
  objectId: string,
  title: string | undefined,
  jobId: string,
  end?: string,
): PendingNotification {
  const topic = title || "Conversation";
  const date = end
    ? new Date(end).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
    : "";

  return {
    type: "success",
    title: topic,
    description: `Summary completed${date ? ` • ${date}` : ""}`,
    action: {
      label: "View summary",
      path: `/objects/${objectId}?summaryJobId=${encodeURIComponent(jobId)}`,
    },
  };
}

export function buildSummarizationCompletionNotifications(
  result: SummarizationResult | undefined,
  jobId: string,
): PendingNotification[] {
  if (!result) return [];

  if (result.objectId) {
    return [buildObjectNotification(
      result.objectId,
      result.title,
      jobId,
      result.end,
    )];
  }

  if (result.summaries?.length) {
    return result.summaries.map((summary) =>
      buildObjectNotification(
        summary.objectId,
        summary.title,
        jobId,
      )
    );
  }

  // Backward-compatible fallback for jobs completed before per-item results
  // were added to the worker response.
  if (typeof result.processed === "number" && result.processed > 0) {
    const count = result.processed;
    return [{
      type: "success",
      title: count === 1
        ? "1 summary completed"
        : `${count} summaries completed`,
      description: count === 1
        ? "A new conversation summary is ready."
        : `${count} new conversation summaries are ready.`,
      action: { label: "View summaries", path: "/summaries" },
    }];
  }

  return [];
}
