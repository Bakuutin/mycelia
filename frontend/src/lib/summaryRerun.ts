import { zonedDateKeyToDate } from "./datePicker";

/** Inclusive calendar days in the picker timezone, with an exclusive end. */
export function summaryDateBounds(from: string, to: string, timeZone: string) {
  if (!from || !to || from > to) return null;
  const start = zonedDateKeyToDate(from, timeZone);
  const nextDay = new Date(`${to}T12:00:00Z`);
  if (!start || !Number.isFinite(nextDay.getTime())) return null;
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  const end = zonedDateKeyToDate(nextDay.toISOString().slice(0, 10), timeZone);
  if (!end) return null;
  return { start: start.toISOString(), end: end.toISOString() };
}

type RerunRequest = {
  start: string;
  end: string;
  sourceModel?: string;
  targetModel: string;
  targetProviderProfileId?: string;
};

type BatchResult = {
  queued?: unknown[];
  skippedAlreadyQueued?: number;
  nextCursor?: string | null;
};

export async function queueSummaryRerunRange(
  request: RerunRequest,
  call: (request: Record<string, unknown>) => Promise<BatchResult>,
  onProgress: (queued: number, skipped: number) => void,
) {
  let afterObjectId: string | undefined;
  let queued = 0;
  let skipped = 0;
  do {
    const result = await call({
      ...request,
      action: "reprocess_model_artifacts",
      artifactType: "summary",
      limit: 100,
      ...(afterObjectId ? { afterObjectId } : {}),
    });
    queued += result.queued?.length ?? 0;
    skipped += result.skippedAlreadyQueued ?? 0;
    onProgress(queued, skipped);
    if (
      result.nextCursor && afterObjectId && result.nextCursor <= afterObjectId
    ) {
      throw new Error("Rerun pagination did not advance. Please retry.");
    }
    afterObjectId = result.nextCursor ?? undefined;
  } while (afterObjectId);
  return { queued, skipped };
}
