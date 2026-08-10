export type DiarizationProgress = {
  total_chunks?: number;
  chunks_processed?: number;
  chunks_remaining?: number;
  chunks_per_second?: number | null;
  eta_seconds?: number | null;
};

export type DiarizationProgressView = {
  percent: number;
  progressLabel: string;
  remainingLabel: string;
  rateLabel: string | null;
  etaLabel: string;
};

function formatEta(seconds: number): string {
  const rounded = Math.max(Math.round(seconds), 0);
  if (rounded < 60) return `About ${rounded}s remaining`;
  if (rounded < 3600) return `About ${Math.ceil(rounded / 60)}m remaining`;
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.ceil((rounded % 3600) / 60);
  return `About ${hours}h${minutes ? ` ${minutes}m` : ""} remaining`;
}

export function getDiarizationProgressView(
  progress: DiarizationProgress,
): DiarizationProgressView {
  const total = Math.max(progress.total_chunks ?? 0, 0);
  const processed = Math.max(progress.chunks_processed ?? 0, 0);
  const remaining = Math.max(
    progress.chunks_remaining ?? total - processed,
    0,
  );
  const percent = total > 0
    ? Math.min(Math.max((processed / total) * 100, 0), 100)
    : 0;
  const rate = progress.chunks_per_second;

  return {
    percent,
    progressLabel: `${processed} / ${total} chunks`,
    remainingLabel: `${remaining} chunks remaining in range`,
    rateLabel: rate && rate > 0 ? `${(rate * 60).toFixed(1)} chunks/min` : null,
    etaLabel: progress.eta_seconds != null && progress.eta_seconds >= 0
      ? formatEta(progress.eta_seconds)
      : "ETA available after the first completed sequence",
  };
}
