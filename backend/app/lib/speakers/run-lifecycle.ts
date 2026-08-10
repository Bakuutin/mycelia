export type DiarizationRunStatus =
  | "building"
  | "ready"
  | "active"
  | "superseded"
  | "failed"
  | "interrupted";

export function assertPurgeAllowed(
  run: { status: DiarizationRunStatus },
): void {
  if (run.status !== "superseded" && run.status !== "failed") {
    throw new Error(`Cannot purge a ${run.status} diarization run`);
  }
}

export function getObservedRunStatus(
  run: { runId?: string; status: DiarizationRunStatus; createdAt?: Date },
  campaigns: Array<{ runId?: string; status?: string }>,
  now = new Date(),
): DiarizationRunStatus {
  if (run.status !== "building") return run.status;
  const hasLiveCampaign = campaigns.some((campaign) =>
    campaign.runId === run.runId &&
    ["counting", "running"].includes(campaign.status ?? "")
  );
  if (hasLiveCampaign) return "building";
  const createdAt = run.createdAt ? new Date(run.createdAt) : now;
  return now.getTime() - createdAt.getTime() >= 20 * 60_000
    ? "interrupted"
    : "building";
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
