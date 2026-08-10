export interface ComparableDiarizationRun {
  runId: string;
  status: "building" | "ready" | "active" | "superseded" | "failed";
  generation: number;
  replacesRunId?: string;
}

export function getRunComparison(
  run: ComparableDiarizationRun,
  runs: ComparableDiarizationRun[],
): { enabled: boolean; baseline?: ComparableDiarizationRun; reason: string } {
  const byId = new Map(runs.map((item) => [item.runId, item]));
  const explicitBaseline = run.replacesRunId
    ? byId.get(run.replacesRunId)
    : undefined;
  const activeBaseline = runs.find((item) =>
    item.status === "active" && item.runId !== run.runId
  );
  const supersededBaseline = run.status === "active"
    ? [...runs]
      .filter((item) =>
        item.status === "superseded" && item.runId !== run.runId
      )
      .sort((a, b) => b.generation - a.generation)[0]
    : undefined;
  const baseline = explicitBaseline ?? activeBaseline ?? supersededBaseline;

  if (!baseline) {
    return {
      enabled: false,
      reason:
        "Build a new diarization generation first; Compare needs this run and a baseline run.",
    };
  }
  if (run.status === "building") {
    return {
      enabled: false,
      baseline,
      reason:
        `Wait until ${run.runId} is ready, then compare it with ${baseline.runId}.`,
    };
  }
  if (run.status === "failed") {
    return {
      enabled: false,
      baseline,
      reason:
        "Failed runs cannot be compared until they are rebuilt successfully.",
    };
  }
  return {
    enabled: true,
    baseline,
    reason: `Compare ${run.runId} with baseline ${baseline.runId}.`,
  };
}

export function validateOperationRange(start: Date, end: Date) {
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
    return "Choose a valid start and end time.";
  }
  if (end <= start) return "End time must be after start time.";
  return null;
}
