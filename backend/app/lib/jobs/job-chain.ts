/**
 * Continue automatic batch processing only when the previous run both reports
 * more work and proves that it made progress. This prevents a worker that is
 * stuck on the same input from creating an endless sequence of jobs.
 */
export function shouldContinueJobChain(
  result: unknown,
): boolean {
  if (!result || typeof result !== "object") return false;
  const value = result as Record<string, unknown>;
  return value.hasMore === true &&
    typeof value.processed === "number" &&
    Number.isFinite(value.processed) &&
    value.processed > 0;
}

/**
 * Automatic summarization batches must resolve prompt/model defaults again for
 * every continuation. Copying the previous validated payload would pin a stale
 * prompt snapshot for the entire historical backlog.
 */
export function getContinuationJobData(
  data: Record<string, unknown>,
  result?: Record<string, unknown>,
): Record<string, unknown> {
  if (data.type === "summarization") {
    return { type: "summarization" };
  }
  const continuation = { ...data };
  if (
    (data.type === "diarization" || data.type === "speakerIdentity") &&
    typeof result?.campaignId === "string" && result.campaignId.length > 0
  ) {
    continuation.campaignId = result.campaignId;
  }
  if (typeof result?.cursor === "string" && result.cursor.length > 0) {
    const parsedCursor = new Date(result.cursor);
    continuation.cursor = Number.isNaN(parsedCursor.getTime())
      ? result.cursor
      : parsedCursor.toISOString();
  }
  if (
    data.type === "histRecalculation" &&
    typeof result?.nextStart === "string" &&
    typeof result?.nextEnd === "string"
  ) {
    continuation.start = result.nextStart;
    continuation.end = result.nextEnd;
    if (typeof result.timelineRebuildBatchIndex === "number") {
      continuation.timelineRebuildBatchIndex = result.timelineRebuildBatchIndex;
    }
  }
  return Object.keys(continuation).length === Object.keys(data).length &&
      Object.entries(continuation).every(([key, value]) => data[key] === value)
    ? data
    : continuation;
}

export function getContinuationPriority(
  data: Record<string, unknown>,
): number | undefined {
  if (data.type !== "diarization") return undefined;
  if (data.originalId) return 1;
  if (data.mode === "build_generation") return 5;
  return 10;
}
