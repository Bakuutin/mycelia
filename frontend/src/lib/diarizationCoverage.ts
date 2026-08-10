export type DiarizationCoverageState =
  | "diarized"
  | "processing"
  | "pending"
  | "needs_attention";

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
