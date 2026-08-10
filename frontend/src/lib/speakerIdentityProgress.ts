export type SpeakerIdentityProgress = {
  processed?: number | null;
  total?: number | null;
  remaining?: number | null;
  segmentsPerSecond?: number | null;
  etaSeconds?: number | null;
};

export function formatIdentityEta(seconds?: number | null): string {
  if (seconds == null || seconds < 0) return "Estimating…";
  const rounded = Math.max(Math.round(seconds), 0);
  if (rounded < 60) return `~${rounded}s left`;
  if (rounded < 3600) return `~${Math.ceil(rounded / 60)}m left`;
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.ceil((rounded % 3600) / 60);
  return `~${hours}h${minutes ? ` ${minutes}m` : ""} left`;
}

export function getSpeakerIdentityProgressView(
  progress: SpeakerIdentityProgress,
) {
  const processed = Math.max(progress.processed ?? 0, 0);
  const hasTotal = typeof progress.total === "number";
  const total = Math.max(progress.total ?? 0, 0);
  const remaining = Math.max(progress.remaining ?? total - processed, 0);
  return {
    percent: total > 0
      ? Math.min(Math.max(processed / total * 100, 0), 100)
      : 0,
    progressLabel: hasTotal
      ? `${processed} / ${total} embeddings`
      : `${processed} embeddings classified`,
    remainingLabel: hasTotal
      ? `${remaining} remaining`
      : "Exact backlog total unavailable",
    rateLabel: progress.segmentsPerSecond && progress.segmentsPerSecond > 0
      ? `${(progress.segmentsPerSecond * 60).toFixed(1)}/min`
      : null,
    etaLabel: formatIdentityEta(progress.etaSeconds),
  };
}
