export type DiarizationCoverageState =
  | "diarized"
  | "processing"
  | "pending"
  | "needs_attention";

const COVERAGE_BUCKETS_MS = [
  1_000,
  5_000,
  15_000,
  30_000,
  60_000,
  5 * 60_000,
  15 * 60_000,
  30 * 60_000,
  60 * 60_000,
  3 * 60 * 60_000,
  6 * 60 * 60_000,
  12 * 60 * 60_000,
  24 * 60 * 60_000,
] as const;

export function coverageBucketMs(rangeMs: number, width: number): number {
  const target = Math.max(
    COVERAGE_BUCKETS_MS[0],
    Math.ceil(rangeMs / Math.max(width / 3, 1)),
  );
  return COVERAGE_BUCKETS_MS.find((bucket) => bucket >= target) ??
    COVERAGE_BUCKETS_MS.at(-1)!;
}

export function dominantCoverageState(
  counts: Partial<Record<DiarizationCoverageState, number>>,
): DiarizationCoverageState {
  for (
    const state of [
      "needs_attention",
      "processing",
      "pending",
      "diarized",
    ] as const
  ) {
    if ((counts[state] ?? 0) > 0) return state;
  }
  return "pending";
}

export function coverageColor(state: DiarizationCoverageState): string {
  return {
    diarized: "#2563eb",
    processing: "#38bdf8",
    pending: "#94a3b8",
    needs_attention: "#dc2626",
  }[state];
}
