export type MediaRecognitionBatchCounts = Record<string, unknown>;

export interface MediaRecognitionBatchProgressSource {
  status?: unknown;
  counts?: MediaRecognitionBatchCounts;
  progress?: MediaRecognitionBatchCounts;
}

export interface MediaRecognitionBatchProgressView {
  stage: string;
  done: number;
  total: number;
  remaining: number;
  percent: number;
  pending: number;
  queued: number;
  processing: number;
  ready: number;
  skipped: number;
  failed: number;
  cancelled: number;
}

function count(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function boundedPercent(value: unknown): number | undefined {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.min(100, Math.max(0, parsed));
}

/**
 * One view model for the durable photo-analysis batch shown in Media and Jobs.
 * New coordinator progress is flat, while stored batches keep the same values
 * under `counts`; accepting both keeps historical rows readable.
 */
export function getMediaRecognitionBatchProgress(
  source: MediaRecognitionBatchProgressSource,
): MediaRecognitionBatchProgressView {
  const progress = source.progress ?? {};
  const counts = source.counts ?? {};
  const value = (key: string) => progress[key] ?? counts[key];

  const pending = count(value("pending"));
  const queued = count(value("queued"));
  const processing = count(value("processing"));
  const ready = count(value("ready"));
  const skipped = count(value("skipped"));
  const failed = count(value("failed"));
  const cancelled = count(value("cancelled"));
  const terminal = ready + skipped + failed + cancelled;
  const done = Math.max(terminal, count(progress.processed));
  const total = Math.max(done, count(progress.total ?? counts.total));
  const remaining = Math.max(
    0,
    Number.isFinite(Number(progress.remaining))
      ? Number(progress.remaining)
      : total - done,
  );
  const percent = boundedPercent(progress.percent) ??
    (total > 0 ? done / total * 100 : 0);

  return {
    stage: String(progress.stage ?? source.status ?? "queued"),
    done,
    total,
    remaining,
    percent,
    pending,
    queued,
    processing,
    ready,
    skipped,
    failed,
    cancelled,
  };
}

export function mediaRecognitionBatchStageLabel(stage: string): string {
  const labels: Record<string, string> = {
    preparing: "Preparing photos",
    queued: "Queued",
    processing: "Processing photos",
    running: "Processing photos",
    paused: "Paused",
    completed: "Finished",
    completed_with_errors: "Finished with issues",
    cancelled: "Cancelled",
    failed: "Failed",
  };
  return labels[stage] ?? stage.replaceAll("_", " ");
}
