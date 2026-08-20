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
  rateStatus?: "live" | "aggregate" | "warming" | "legacy";
  usefulAudioRealtimeMultiple?: number | null;
  rateWindowSeconds?: number | null;
  successfulSequences?: number;
  skippedSequences?: number;
  recordingLeaseBusyOriginals?: number;
  recordingLeaseSkippedSequences?: number;
  chunkClaimSkips?: number;
  skipRatio?: number | null;
  leaseSkipRatio?: number | null;
  claimSkipRatio?: number | null;
  stageTimingsMs?: Record<
    string,
    { count: number; total: number; avg: number; max: number }
  >;
  etaSeconds: number | null;
};

export type DiarizationSkipMetricsView = {
  totalLabel: string;
  leaseLabel: string;
  claimLabel: string;
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
  const view = getDiarizationProgressView({
    total_chunks: campaign.totalChunks,
    chunks_processed: campaign.processedChunks,
    chunks_remaining: campaign.pendingChunks ?? undefined,
    chunks_per_second: campaign.chunksPerSecond,
    eta_seconds: campaign.etaSeconds,
  });
  if (campaign.chunksPerSecond == null || campaign.chunksPerSecond <= 0) {
    return view;
  }

  const chunksPerMinute = (campaign.chunksPerSecond * 60).toFixed(1);
  const rateLabel = campaign.rateStatus === "live"
    ? `All active tasks combined: ${chunksPerMinute} chunks/min`
    : campaign.rateStatus === "aggregate"
    ? `Recent completed tasks combined: ${chunksPerMinute} chunks/min`
    : campaign.rateStatus === "legacy"
    ? `Legacy single-lane estimate: ${chunksPerMinute} chunks/min`
    : view.rateLabel;
  return { ...view, rateLabel };
}

function formatSkipRatio(value: number | null | undefined): string | null {
  return value != null && Number.isFinite(value) && value >= 0
    ? `${(value * 100).toFixed(1)}%`
    : null;
}

export function getDiarizationSkipMetricsView(
  campaign: DiarizationCampaignSummary,
): DiarizationSkipMetricsView {
  const skippedSequences = Math.max(campaign.skippedSequences ?? 0, 0);
  const leaseSkips = Math.max(
    campaign.recordingLeaseSkippedSequences ?? 0,
    0,
  );
  const busyOriginals = Math.max(
    campaign.recordingLeaseBusyOriginals ?? 0,
    0,
  );
  const claimSkips = Math.max(campaign.chunkClaimSkips ?? 0, 0);
  // Older API responses used `claimSkipRatio` for the aggregate ratio and did
  // not include a claim-breakdown count. Preserve that display during a
  // rolling frontend/backend deployment without mislabelling it as claim-only.
  const legacyAggregateRatio = campaign.chunkClaimSkips == null
    ? campaign.claimSkipRatio
    : null;
  const totalRatio = formatSkipRatio(
    campaign.skipRatio ?? legacyAggregateRatio,
  );
  const leaseRatio = formatSkipRatio(campaign.leaseSkipRatio);
  const claimRatio = campaign.chunkClaimSkips == null
    ? null
    : formatSkipRatio(campaign.claimSkipRatio);

  return {
    totalLabel: [
      totalRatio,
      skippedSequences.toLocaleString(),
    ].filter(Boolean).join(" · "),
    leaseLabel: [
      leaseSkips.toLocaleString(),
      leaseRatio,
      `${busyOriginals.toLocaleString()} busy`,
    ].filter(Boolean).join(" · "),
    claimLabel: [
      claimSkips.toLocaleString(),
      claimRatio,
    ].filter(Boolean).join(" · "),
  };
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
