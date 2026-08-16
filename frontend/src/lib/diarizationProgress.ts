export type DiarizationProgress = {
  total_chunks?: number | null;
  total_estimated?: boolean;
  chunks_processed?: number;
  chunks_remaining?: number;
  chunks_per_second?: number | null;
  current_chunks_per_second?: number | null;
  worker_chunks_per_second?: number | null;
  eta_seconds?: number | null;
  batch_sequences_processed?: number;
  batch_sequences_total?: number;
  batch_chunks_processed?: number;
};

export type DiarizationProgressView = {
  percent: number;
  progressLabel: string;
  remainingLabel: string | null;
  rateLabel: string | null;
  etaLabel: string | null;
  batchPercent: number | null;
  batchProgressLabel: string | null;
  batchChunksLabel: string | null;
  workerRateLabel: string | null;
};

export type DiarizationCampaignSummary = {
  processedChunks: number;
  totalChunks: number | null;
  pendingChunks: number | null;
  chunksPerSecond: number | null;
  etaSeconds: number | null;
};

export type CompletedDiarizationResult = {
  worker_chunks_per_second?: number | null;
  chunks_processed?: number | null;
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
  const hasKnownTotal = typeof progress.total_chunks === "number";
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
  const workerRate = progress.worker_chunks_per_second ??
    progress.current_chunks_per_second;
  const batchProcessed = Math.max(
    progress.batch_sequences_processed ?? 0,
    0,
  );
  const batchTotal = Math.max(progress.batch_sequences_total ?? 0, 0);
  const batchPercent = batchTotal > 0
    ? Math.min(Math.max((batchProcessed / batchTotal) * 100, 0), 100)
    : null;
  const batchProgressLabel = batchTotal > 0
    ? `${batchProcessed} / up to ${batchTotal} sequences in this job`
    : progress.batch_sequences_processed != null
    ? `${batchProcessed} sequences in this job`
    : null;
  const batchChunksLabel = progress.batch_chunks_processed != null
    ? `${Math.max(progress.batch_chunks_processed, 0)} chunks in this job`
    : null;
  const workerRateLabel = formatDiarizationWorkerRate(workerRate);
  const rateLabel = rate && rate > 0
    ? `Recent jobs average: ${(rate * 60).toFixed(1)} chunks/min`
    : null;

  if (!hasKnownTotal) {
    return {
      percent: 0,
      progressLabel: `${processed} chunks processed`,
      remainingLabel: null,
      rateLabel,
      etaLabel: null,
      batchPercent,
      batchProgressLabel,
      batchChunksLabel,
      workerRateLabel,
    };
  }

  return {
    percent,
    progressLabel: `${processed} / ${total} chunks`,
    remainingLabel: `${remaining} chunks remaining in range`,
    rateLabel,
    etaLabel: progress.eta_seconds != null && progress.eta_seconds >= 0
      ? formatEta(progress.eta_seconds)
      : "ETA available after the first completed sequence",
    batchPercent,
    batchProgressLabel,
    batchChunksLabel,
    workerRateLabel,
  };
}

export function getDiarizationCampaignProgressView(
  campaign: DiarizationCampaignSummary,
): DiarizationProgressView {
  return getDiarizationProgressView({
    total_chunks: campaign.totalChunks,
    chunks_processed: campaign.processedChunks,
    chunks_remaining: campaign.pendingChunks ?? undefined,
    chunks_per_second: campaign.chunksPerSecond,
    eta_seconds: campaign.etaSeconds,
  });
}

export function isOpenDiarizationCampaignStatus(status: string): boolean {
  return ["counting", "running", "interrupted"].includes(status);
}

export function getCompletedDiarizationWorkerRate(
  result: CompletedDiarizationResult,
  processedOn?: number,
  finishedOn?: number,
): number | null {
  const persistedRate = result.worker_chunks_per_second;
  if (persistedRate != null && persistedRate > 0) return persistedRate;

  const chunks = result.chunks_processed;
  if (
    chunks == null || chunks <= 0 || processedOn == null ||
    finishedOn == null || finishedOn <= processedOn
  ) {
    return null;
  }
  return chunks / ((finishedOn - processedOn) / 1000);
}

export function formatDiarizationWorkerRate(
  chunksPerSecond: number | null | undefined,
): string | null {
  return chunksPerSecond != null && chunksPerSecond > 0
    ? `This worker: ${(chunksPerSecond * 60).toFixed(1)} chunks/min`
    : null;
}
