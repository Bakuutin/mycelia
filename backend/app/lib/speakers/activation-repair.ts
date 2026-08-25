import type { DiarizationRunStatus } from "./run-lifecycle.ts";
import { getObservedRunStatus } from "./run-lifecycle.ts";

export type MongoPredicate = Record<string, unknown>;
export type MongoUpdate = Record<string, unknown>;

export interface DiarizationRunRange {
  start: Date | string;
  end: Date | string;
}

export interface ActivationRun {
  runId: string;
  status: DiarizationRunStatus;
  range: DiarizationRunRange;
  createdAt?: Date | string;
  activatedAt?: Date | string;
  purgedAt?: Date | string | null;
  replacesRunId?: string;
}

export interface ActivationExactCountReader {
  countSegments(query: MongoPredicate): Promise<number>;
  distinctSegmentRunIds(query: MongoPredicate): Promise<string[]>;
}

export interface RepairExactCountReader extends ActivationExactCountReader {
  countRuns(query: MongoPredicate): Promise<number>;
}

export interface ActivationCountPredicates {
  targetSegments: MongoPredicate;
  targetSegmentsInRange: MongoPredicate;
  targetActiveSegmentsInRange: MongoPredicate;
  replacedActiveSegments: MongoPredicate;
}

export interface ActivationSafetyCounts {
  targetSegments: number;
  targetSegmentsInRange: number;
  targetActiveSegmentsInRange: number;
  replacedActiveSegments: number;
}

export type ActivationSafetyBlocker =
  | "invalid_run_state"
  | "purged_run"
  | "empty_target_run"
  | "empty_target_would_remove_active_coverage"
  | "replacement_provenance_missing";

export interface ActivationSafetyPreview {
  runId: string;
  range: { start: Date; end: Date };
  allowed: boolean;
  destructive: boolean;
  blockers: ActivationSafetyBlocker[];
  counts: ActivationSafetyCounts;
  replacementRunIds: string[];
  summary: string;
}

export interface RelatedRunForRepair {
  runId: string;
  supersededBy?: string;
  partialSupersessions?: Array<{ runId?: string }>;
}

export interface RepairCountPredicates {
  targetSegments: MongoPredicate;
  targetActiveSegments: MongoPredicate;
  recoverableSupersededSegments: MongoPredicate;
  alreadyActiveReplacementSegments: MongoPredicate;
  competingActiveSegments: MongoPredicate;
  fullySupersededRunDocuments: MongoPredicate;
  partialSupersessionRunDocuments: MongoPredicate;
}

export interface EmptyActivationRepairCounts {
  targetSegments: number;
  targetActiveSegments: number;
  recoverableSupersededSegments: number;
  alreadyActiveReplacementSegments: number;
  competingActiveSegments: number;
  fullySupersededRunDocuments: number;
  partialSupersessionRunDocuments: number;
}

export type EmptyActivationRepairBlocker =
  | "run_not_active"
  | "target_run_not_empty"
  | "target_has_active_segments"
  | "activation_revision_missing"
  | "replacement_provenance_missing"
  | "newer_active_coverage_present"
  | "recoverable_coverage_missing";

export interface EmptyActivationRepairPreview {
  runId: string;
  range: { start: Date; end: Date };
  repairable: boolean;
  alreadyRepaired: boolean;
  blockers: EmptyActivationRepairBlocker[];
  replacementRunIds: string[];
  activationRevision?: Date;
  counts: EmptyActivationRepairCounts;
  summary: string;
}

export interface RepairMutation {
  key:
    | "claim_empty_activation"
    | "restore_segments"
    | "restore_fully_superseded_runs"
    | "clear_partial_supersessions"
    | "complete_empty_activation_repair";
  collection: "diarizations" | "diarization_runs";
  action: "updateOne" | "updateMany";
  query: MongoPredicate;
  update: MongoUpdate;
  expectedMatches: number;
}

export interface EmptyActivationRepairPlan {
  repairId: string;
  runId: string;
  replacementRunIds: string[];
  counts: EmptyActivationRepairCounts;
  operations: RepairMutation[];
}

export const DIARIZATION_RUN_LIFECYCLE_INDEX = "diarization_run_active_start";
export const DIARIZATION_RUN_LIFECYCLE_END_INDEX =
  "diarization_run_lifecycle_end";
export const DIARIZATION_TIMELINE_LIFECYCLE_INDEX =
  "speaker_timeline_active_range";

export function selectDiarizationLifecycleIndex(
  query: MongoPredicate,
): string | undefined {
  const runId = query.runId;
  const excludesRuns = runId !== null && typeof runId === "object" &&
    ("$ne" in (runId as MongoPredicate) ||
      "$nin" in (runId as MongoPredicate));
  if (runId !== undefined && !excludesRuns) {
    if (query.lifecycleStatus && query.start && query.end) {
      return DIARIZATION_RUN_LIFECYCLE_END_INDEX;
    }
    return DIARIZATION_RUN_LIFECYCLE_INDEX;
  }
  if (query.lifecycleStatus && query.start && query.end) {
    return DIARIZATION_TIMELINE_LIFECYCLE_INDEX;
  }
  return undefined;
}

export type GenerationStateCode =
  | "building_running"
  | "building_waiting"
  | "interrupted"
  | "ready"
  | "ready_empty"
  | "active"
  | "active_empty_repairable"
  | "active_empty_unrecoverable"
  | "superseded"
  | "superseded_with_active_segments"
  | "failed";

export interface GenerationStateExplanation {
  code: GenerationStateCode;
  observedStatus: DiarizationRunStatus;
  severity: "ok" | "warning" | "error";
  summary: string;
  nextAction: string;
  canActivate: boolean;
  canRepair: boolean;
}

function normalizedRange(range: DiarizationRunRange) {
  const start = new Date(range.start);
  const end = new Date(range.end);
  if (
    !Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) ||
    end <= start
  ) {
    throw new Error("Diarization run must have a valid, non-empty range");
  }
  return { start, end };
}

function assertExactCount(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be an exact non-negative integer`);
  }
  return value;
}

function normalizedRunIds(runIds: string[], excludedRunId: string): string[] {
  return [...new Set(runIds)]
    .filter((runId) => runId.length > 0 && runId !== excludedRunId)
    .sort();
}

function overlapPredicate(range: { start: Date; end: Date }) {
  return {
    start: { $lt: range.end },
    end: { $gt: range.start },
  };
}

export function buildActivationCountPredicates(
  run: ActivationRun,
): ActivationCountPredicates {
  const range = normalizedRange(run.range);
  const overlap = overlapPredicate(range);
  return {
    targetSegments: { runId: run.runId },
    targetSegmentsInRange: { runId: run.runId, ...overlap },
    targetActiveSegmentsInRange: {
      runId: run.runId,
      lifecycleStatus: "active",
      ...overlap,
    },
    replacedActiveSegments: {
      runId: { $ne: run.runId },
      lifecycleStatus: "active",
      ...overlap,
    },
  };
}

export function evaluateActivationSafety(input: {
  run: ActivationRun;
  counts: ActivationSafetyCounts;
  replacementRunIds: string[];
}): ActivationSafetyPreview {
  const range = normalizedRange(input.run.range);
  const counts = {
    targetSegments: assertExactCount(
      "targetSegments",
      input.counts.targetSegments,
    ),
    targetSegmentsInRange: assertExactCount(
      "targetSegmentsInRange",
      input.counts.targetSegmentsInRange,
    ),
    targetActiveSegmentsInRange: assertExactCount(
      "targetActiveSegmentsInRange",
      input.counts.targetActiveSegmentsInRange,
    ),
    replacedActiveSegments: assertExactCount(
      "replacedActiveSegments",
      input.counts.replacedActiveSegments,
    ),
  };
  const replacementRunIds = normalizedRunIds(
    input.replacementRunIds,
    input.run.runId,
  );
  const blockers: ActivationSafetyBlocker[] = [];
  if (
    !(["ready", "active", "superseded"] as string[]).includes(
      input.run.status,
    )
  ) {
    blockers.push("invalid_run_state");
  }
  if (input.run.purgedAt) blockers.push("purged_run");
  if (counts.targetSegments === 0 || counts.targetSegmentsInRange === 0) {
    blockers.push("empty_target_run");
  }
  const destructive = counts.targetSegmentsInRange === 0 &&
    counts.replacedActiveSegments > 0;
  if (destructive) {
    blockers.push("empty_target_would_remove_active_coverage");
  }
  if (
    counts.replacedActiveSegments > 0 && replacementRunIds.length === 0
  ) {
    blockers.push("replacement_provenance_missing");
  }

  const allowed = blockers.length === 0;
  const summary = destructive
    ? `Blocked: ${counts.replacedActiveSegments} active segments would be removed, but ${input.run.runId} has no replacement segments in the selected range.`
    : allowed
    ? `Safe to activate ${counts.targetSegmentsInRange} segments and replace ${counts.replacedActiveSegments} active segments.`
    : `Activation is blocked by ${blockers.join(", ")}.`;
  return {
    runId: input.run.runId,
    range,
    allowed,
    destructive,
    blockers,
    counts,
    replacementRunIds,
    summary,
  };
}

export async function previewActivationSafety(
  run: ActivationRun,
  reader: ActivationExactCountReader,
): Promise<ActivationSafetyPreview> {
  const predicates = buildActivationCountPredicates(run);
  const [
    targetSegments,
    targetSegmentsInRange,
    targetActiveSegmentsInRange,
    replacedActiveSegments,
    replacementRunIds,
  ] = await Promise.all([
    reader.countSegments(predicates.targetSegments),
    reader.countSegments(predicates.targetSegmentsInRange),
    reader.countSegments(predicates.targetActiveSegmentsInRange),
    reader.countSegments(predicates.replacedActiveSegments),
    reader.distinctSegmentRunIds(predicates.replacedActiveSegments),
  ]);
  return evaluateActivationSafety({
    run,
    counts: {
      targetSegments,
      targetSegmentsInRange,
      targetActiveSegmentsInRange,
      replacedActiveSegments,
    },
    replacementRunIds,
  });
}

export function assertActivationPreviewSafe(
  preview: ActivationSafetyPreview,
): void {
  if (!preview.allowed) throw new Error(preview.summary);
}

/**
 * Only persisted supersession provenance is accepted. Generic superseded
 * segments are deliberately not inferred as predecessors: resurrecting an
 * older generation would be worse than leaving the repair for an operator.
 */
export function collectReplacementRunIds(
  target: Pick<ActivationRun, "runId" | "replacesRunId">,
  relatedRuns: RelatedRunForRepair[],
): string[] {
  const candidates = target.replacesRunId ? [target.replacesRunId] : [];
  for (const run of relatedRuns) {
    if (
      run.supersededBy === target.runId ||
      run.partialSupersessions?.some((entry) => entry.runId === target.runId)
    ) {
      candidates.push(run.runId);
    }
  }
  return normalizedRunIds(candidates, target.runId);
}

export function buildRepairCountPredicates(
  run: ActivationRun,
  rawReplacementRunIds: string[],
): RepairCountPredicates {
  const range = normalizedRange(run.range);
  const replacementRunIds = normalizedRunIds(rawReplacementRunIds, run.runId);
  const replacement = { $in: replacementRunIds };
  const overlap = overlapPredicate(range);
  return {
    targetSegments: { runId: run.runId },
    targetActiveSegments: {
      runId: run.runId,
      lifecycleStatus: "active",
    },
    recoverableSupersededSegments: {
      runId: replacement,
      lifecycleStatus: "superseded",
      ...overlap,
    },
    alreadyActiveReplacementSegments: {
      runId: replacement,
      lifecycleStatus: "active",
      ...overlap,
    },
    competingActiveSegments: {
      runId: { $nin: [run.runId, ...replacementRunIds] },
      lifecycleStatus: "active",
      ...overlap,
    },
    fullySupersededRunDocuments: {
      runId: replacement,
      status: "superseded",
      supersededBy: run.runId,
    },
    partialSupersessionRunDocuments: {
      runId: replacement,
      status: "active",
      "partialSupersessions.runId": run.runId,
    },
  };
}

export function evaluateEmptyActivationRepair(input: {
  run: ActivationRun;
  replacementRunIds: string[];
  counts: EmptyActivationRepairCounts;
}): EmptyActivationRepairPreview {
  const range = normalizedRange(input.run.range);
  const replacementRunIds = normalizedRunIds(
    input.replacementRunIds,
    input.run.runId,
  );
  const counts = Object.fromEntries(
    Object.entries(input.counts).map(([name, value]) => [
      name,
      assertExactCount(name, value),
    ]),
  ) as unknown as EmptyActivationRepairCounts;
  const activationRevision = input.run.activatedAt
    ? new Date(input.run.activatedAt)
    : undefined;
  const blockers: EmptyActivationRepairBlocker[] = [];
  if (input.run.status !== "active") blockers.push("run_not_active");
  if (counts.targetSegments > 0) blockers.push("target_run_not_empty");
  if (counts.targetActiveSegments > 0) {
    blockers.push("target_has_active_segments");
  }
  if (
    !activationRevision || !Number.isFinite(activationRevision.getTime())
  ) {
    blockers.push("activation_revision_missing");
  }
  if (replacementRunIds.length === 0) {
    blockers.push("replacement_provenance_missing");
  }
  if (counts.competingActiveSegments > 0) {
    blockers.push("newer_active_coverage_present");
  }
  const recoverableCoverage = counts.recoverableSupersededSegments +
    counts.alreadyActiveReplacementSegments;
  if (recoverableCoverage === 0) {
    blockers.push("recoverable_coverage_missing");
  }
  const alreadyRepaired = input.run.status === "failed" &&
    counts.targetSegments === 0 &&
    counts.recoverableSupersededSegments === 0 &&
    counts.alreadyActiveReplacementSegments > 0 &&
    counts.competingActiveSegments === 0;
  const repairable = blockers.length === 0;
  const summary = alreadyRepaired
    ? `Repair is already complete; ${counts.alreadyActiveReplacementSegments} replacement segments are active.`
    : repairable
    ? `Repair can restore ${counts.recoverableSupersededSegments} of ${recoverableCoverage} replacement segments before failing the empty run.`
    : `Automatic repair is blocked by ${blockers.join(", ")}.`;
  return {
    runId: input.run.runId,
    range,
    repairable,
    alreadyRepaired,
    blockers,
    replacementRunIds,
    activationRevision,
    counts,
    summary,
  };
}

export async function previewEmptyActivationRepair(
  run: ActivationRun,
  replacementRunIds: string[],
  reader: RepairExactCountReader,
): Promise<EmptyActivationRepairPreview> {
  const predicates = buildRepairCountPredicates(run, replacementRunIds);
  const [
    targetSegments,
    targetActiveSegments,
    recoverableSupersededSegments,
    alreadyActiveReplacementSegments,
    competingActiveSegments,
    fullySupersededRunDocuments,
    partialSupersessionRunDocuments,
  ] = await Promise.all([
    reader.countSegments(predicates.targetSegments),
    reader.countSegments(predicates.targetActiveSegments),
    reader.countSegments(predicates.recoverableSupersededSegments),
    reader.countSegments(predicates.alreadyActiveReplacementSegments),
    reader.countSegments(predicates.competingActiveSegments),
    reader.countRuns(predicates.fullySupersededRunDocuments),
    reader.countRuns(predicates.partialSupersessionRunDocuments),
  ]);
  return evaluateEmptyActivationRepair({
    run,
    replacementRunIds,
    counts: {
      targetSegments,
      targetActiveSegments,
      recoverableSupersededSegments,
      alreadyActiveReplacementSegments,
      competingActiveSegments,
      fullySupersededRunDocuments,
      partialSupersessionRunDocuments,
    },
  });
}

export function buildEmptyActivationRepairPlan(
  preview: EmptyActivationRepairPreview,
  now = new Date(),
): EmptyActivationRepairPlan {
  if (!preview.repairable || !preview.activationRevision) {
    throw new Error(preview.summary);
  }
  const repairId =
    `empty-activation:${preview.runId}:${preview.activationRevision.toISOString()}`;
  const replacement = { $in: preview.replacementRunIds };
  const overlap = overlapPredicate(preview.range);
  const claimQuery = {
    runId: preview.runId,
    status: "active",
    activatedAt: preview.activationRevision,
    $or: [
      { activationRepair: { $exists: false } },
      {
        "activationRepair.repairId": repairId,
        "activationRepair.state": "repairing",
      },
    ],
  };
  return {
    repairId,
    runId: preview.runId,
    replacementRunIds: preview.replacementRunIds,
    counts: preview.counts,
    operations: [
      {
        key: "claim_empty_activation",
        collection: "diarization_runs",
        action: "updateOne",
        query: claimQuery,
        update: {
          $set: {
            activationRepair: {
              repairId,
              state: "repairing",
              startedAt: now,
              replacementRunIds: preview.replacementRunIds,
            },
          },
        },
        expectedMatches: 1,
      },
      {
        key: "restore_segments",
        collection: "diarizations",
        action: "updateMany",
        query: {
          runId: replacement,
          lifecycleStatus: "superseded",
          ...overlap,
        },
        update: { $set: { lifecycleStatus: "active" } },
        expectedMatches: preview.counts.recoverableSupersededSegments,
      },
      {
        key: "restore_fully_superseded_runs",
        collection: "diarization_runs",
        action: "updateMany",
        query: {
          runId: replacement,
          status: "superseded",
          supersededBy: preview.runId,
        },
        update: {
          $set: { status: "active", reactivatedAt: now },
          $unset: { supersededAt: "", supersededBy: "" },
        },
        expectedMatches: preview.counts.fullySupersededRunDocuments,
      },
      {
        key: "clear_partial_supersessions",
        collection: "diarization_runs",
        action: "updateMany",
        query: {
          runId: replacement,
          status: "active",
          "partialSupersessions.runId": preview.runId,
        },
        update: {
          $pull: { partialSupersessions: { runId: preview.runId } },
        },
        expectedMatches: preview.counts.partialSupersessionRunDocuments,
      },
      {
        key: "complete_empty_activation_repair",
        collection: "diarization_runs",
        action: "updateOne",
        query: {
          runId: preview.runId,
          status: "active",
          activatedAt: preview.activationRevision,
          "activationRepair.repairId": repairId,
          "activationRepair.state": "repairing",
        },
        update: {
          $set: {
            status: "failed",
            failedAt: now,
            failureReason: "Empty activation repaired",
            "activationRepair.state": "completed",
            "activationRepair.completedAt": now,
            "activationRepair.restoredSegments":
              preview.counts.recoverableSupersededSegments,
          },
        },
        expectedMatches: 1,
      },
    ],
  };
}

export function explainGenerationState(input: {
  run: ActivationRun;
  campaigns?: Array<{ runId?: string; status?: string }>;
  segmentCount?: number;
  activeSegmentCount?: number;
  recoverableSupersededSegments?: number;
  now?: Date;
}): GenerationStateExplanation {
  const segmentCount = input.segmentCount === undefined
    ? undefined
    : assertExactCount("segmentCount", input.segmentCount);
  const activeSegmentCount = input.activeSegmentCount === undefined
    ? undefined
    : assertExactCount("activeSegmentCount", input.activeSegmentCount);
  const recoverable = input.recoverableSupersededSegments === undefined
    ? 0
    : assertExactCount(
      "recoverableSupersededSegments",
      input.recoverableSupersededSegments,
    );
  const campaigns = input.campaigns ?? [];
  const observedStatus = getObservedRunStatus(
    {
      runId: input.run.runId,
      status: input.run.status,
      createdAt: input.run.createdAt
        ? new Date(input.run.createdAt)
        : undefined,
    },
    campaigns,
    input.now,
  );
  const hasLiveCampaign = campaigns.some((campaign) =>
    campaign.runId === input.run.runId &&
    ["counting", "running"].includes(campaign.status ?? "")
  );

  if (observedStatus === "interrupted") {
    return {
      code: "interrupted",
      observedStatus,
      severity: "warning",
      summary: "Generation stopped without a live campaign.",
      nextAction:
        "Resume only if writes are idempotent; otherwise mark it failed and rebuild.",
      canActivate: false,
      canRepair: false,
    };
  }
  if (observedStatus === "building") {
    return {
      code: hasLiveCampaign ? "building_running" : "building_waiting",
      observedStatus,
      severity: "warning",
      summary: hasLiveCampaign
        ? "Generation is still being built by an active campaign."
        : "Generation is waiting for work or the stale threshold.",
      nextAction: hasLiveCampaign
        ? "Wait for the campaign to finish."
        : "Check its campaign and worker before taking action.",
      canActivate: false,
      canRepair: false,
    };
  }
  if (observedStatus === "ready") {
    const empty = segmentCount === 0;
    return {
      code: empty ? "ready_empty" : "ready",
      observedStatus,
      severity: empty ? "error" : "ok",
      summary: empty
        ? "Generation is marked ready but contains no segments."
        : "Generation is ready for comparison and activation preview.",
      nextAction: empty
        ? "Do not activate it; inspect the generation campaign and rebuild the range."
        : "Compare it with active coverage, then run activation preview.",
      canActivate: segmentCount === undefined || segmentCount > 0,
      canRepair: false,
    };
  }
  if (observedStatus === "active") {
    const empty = segmentCount === 0 && activeSegmentCount === 0;
    if (empty) {
      const repairable = recoverable > 0;
      return {
        code: repairable
          ? "active_empty_repairable"
          : "active_empty_unrecoverable",
        observedStatus,
        severity: "error",
        summary: repairable
          ? `The active generation is empty; ${recoverable} superseded segments can be restored.`
          : "The active generation is empty and no recoverable predecessor coverage was proven.",
        nextAction: repairable
          ? "Preview and run the empty-activation repair."
          : "Keep automatic repair blocked and inspect activation provenance manually.",
        canActivate: false,
        canRepair: repairable,
      };
    }
    return {
      code: "active",
      observedStatus,
      severity: "ok",
      summary: "Generation currently provides active diarization coverage.",
      nextAction: "No lifecycle repair is required.",
      canActivate: true,
      canRepair: false,
    };
  }
  if (observedStatus === "superseded") {
    const inconsistent = (activeSegmentCount ?? 0) > 0;
    return {
      code: inconsistent ? "superseded_with_active_segments" : "superseded",
      observedStatus,
      severity: inconsistent ? "error" : "ok",
      summary: inconsistent
        ? "Run is superseded but still owns active segments."
        : "Generation is retained as inactive rollback data.",
      nextAction: inconsistent
        ? "Inspect partial supersession metadata before purge or rollback."
        : "Keep it for rollback or preview purge when retention permits.",
      canActivate: !inconsistent,
      canRepair: false,
    };
  }
  return {
    code: "failed",
    observedStatus,
    severity: "error",
    summary: "Generation failed and cannot be activated.",
    nextAction: "Inspect its errors and build a new generation.",
    canActivate: false,
    canRepair: false,
  };
}
