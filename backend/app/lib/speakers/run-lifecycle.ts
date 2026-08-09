export type DiarizationRunStatus =
  | "building"
  | "ready"
  | "active"
  | "superseded"
  | "failed";

export function assertPurgeAllowed(
  run: { status: DiarizationRunStatus },
): void {
  if (run.status !== "superseded" && run.status !== "failed") {
    throw new Error(`Cannot purge a ${run.status} diarization run`);
  }
}

export function buildActivationUpdates(newRunId: string, oldRunId?: string) {
  const updates: Array<{
    runId: string;
    status: Extract<DiarizationRunStatus, "active" | "superseded">;
  }> = [{ runId: newRunId, status: "active" }];
  if (oldRunId && oldRunId !== newRunId) {
    updates.push({ runId: oldRunId, status: "superseded" });
  }
  return updates;
}

export function projectAnnotationState(input: {
  segmentStart: Date;
  segmentEnd: Date;
  annotationStart: Date;
  annotationEnd: Date;
  profileId?: string;
  excludedProfileIds: string[];
}) {
  const overlaps = input.segmentStart < input.annotationEnd &&
    input.segmentEnd > input.annotationStart;
  if (!overlaps) return null;
  if (input.profileId) {
    return {
      state: "matched" as const,
      profileId: input.profileId,
      source: "manual_projection" as const,
    };
  }
  if (input.excludedProfileIds.length > 0) {
    return {
      state: "rejected" as const,
      profileId: null,
      source: "manual_projection" as const,
    };
  }
  return null;
}
