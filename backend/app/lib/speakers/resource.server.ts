import { ObjectId } from "bson";
import { z } from "zod";
import { type Auth } from "@/lib/auth/core.server.ts";
import { type Resource } from "@/lib/auth/resources.ts";
import { getMongoResource } from "@/lib/mongo/core.server.ts";
import { zDateOrString } from "@myceliasdk/zod-json-schema.ts";
import {
  assertPurgeAllowed,
  buildActivationUpdates,
  getObservedRunStatus,
  projectAnnotationState,
} from "./run-lifecycle.ts";
import {
  applyReviewDecisionRevision,
  attachReviewDecisionSummaries,
  groupReviewSegments,
  latestReviewAnnotationsBySegment,
  prepareReviewCandidates,
  restoreReviewDecision,
} from "./review-sessions.ts";
import {
  applyPositiveThresholdOverride,
  chooseCalibrationThresholds,
  classifyCalibrationScore,
  cosineSimilarity,
  evaluateCalibration,
  splitCalibrationRecordings,
} from "./calibration.ts";
import {
  describeCalibrations,
  findUsableCalibration,
  findUsableFullCalibration,
  findUsablePilotCalibration,
  normalizeCalibrationPolicy,
  normalizeNegativeDecisionMode,
  normalizePositiveThresholdProvenance,
  SPEAKER_CALIBRATION_COMPUTED_BY,
  SPEAKER_CALIBRATION_CONTRACT_VERSION,
  SPEAKER_CALIBRATION_PILOT_MAX_RANGE_HOURS,
  SPEAKER_CALIBRATION_PILOT_MIN_PRECISION,
  SPEAKER_CALIBRATION_TARGET_PRECISION,
  SPEAKER_IDENTITY_SNAPSHOT_INDEX,
} from "./calibration-contract.ts";
import {
  buildDiarizationCoveragePipeline,
  TIMELINE_SPEAKER_SEGMENT_PROJECTION,
} from "./timeline-queries.ts";

const objectId = z.string().refine(ObjectId.isValid, "Invalid ObjectId");
const range = { start: zDateOrString(), end: zDateOrString() };
const profileName = z.string().trim().min(1).max(120);
const SPEAKER_REVIEW_SOURCE_INDEX = "speaker_review_source_scan";
const SPEAKER_REVIEW_RANGE_INDEX = "speaker_review_range_scan";
const uniqueReviewStrings = (maximum: number) =>
  z.array(z.string().trim().min(1).max(256)).max(maximum).transform((
    values,
  ) => [...new Set(values)]);
const uniqueReviewObjectIds = (maximum: number) =>
  z.array(objectId).max(maximum).transform((values) => [...new Set(values)]);
const reviewSourceShape = {
  targetProfileIds: z.array(objectId).length(1),
  sourceMode: z.enum([
    "all_matching",
    "selected_recordings",
    "timeline_range",
    "diarization_generation",
  ]).default("all_matching"),
  embeddingSpaceIds: uniqueReviewStrings(1).default([]),
  runIds: uniqueReviewStrings(1).default([]),
  recordingIds: uniqueReviewObjectIds(500).default([]),
  rangeMode: z.enum(["fixed", "all_before"]).default("fixed"),
  candidateMode: z.enum(["reviewable", "auto_matched"]).default(
    "reviewable",
  ),
  quality: z.object({
    minDurationSeconds: z.number().min(0).max(10).default(1),
    deduplicateOverlaps: z.boolean().default(true),
  }).default({ minDurationSeconds: 1, deduplicateOverlaps: true }),
  start: zDateOrString().optional(),
  end: zDateOrString().optional(),
};

function validateReviewSource(
  value: {
    sourceMode:
      | "all_matching"
      | "selected_recordings"
      | "timeline_range"
      | "diarization_generation";
    rangeMode: "fixed" | "all_before";
    start?: Date | string;
    end?: Date | string;
    runIds: string[];
    recordingIds: string[];
  },
  context: z.RefinementCtx,
  options: { allowEmptySelectedRecordings: boolean },
) {
  const issue = (path: string, message: string) =>
    context.addIssue({ code: "custom", path: [path], message });
  if (value.rangeMode === "fixed" && !(value.start && value.end)) {
    issue("rangeMode", "A fixed review source requires start and end");
  }
  if (value.sourceMode === "diarization_generation") {
    if (value.runIds.length !== 1) {
      issue("runIds", "Choose exactly one diarization generation");
    }
    if (value.recordingIds.length > 0) {
      issue(
        "recordingIds",
        "A diarization generation cannot also select recordings",
      );
    }
    return;
  }
  if (value.runIds.length > 0) {
    issue("runIds", "Only a diarization-generation source may select a run");
  }
  if (value.sourceMode === "selected_recordings") {
    if (
      !options.allowEmptySelectedRecordings && value.recordingIds.length === 0
    ) {
      issue("recordingIds", "Select at least one recording");
    }
    return;
  }
  if (value.recordingIds.length > 0) {
    issue(
      "recordingIds",
      "Only a selected-recordings source may include recording IDs",
    );
  }
  if (
    value.sourceMode === "timeline_range" && value.rangeMode !== "fixed"
  ) {
    issue("rangeMode", "A Timeline source requires a fixed range");
  }
}
const PROFILE_COLORS = [
  "#3b82f6",
  "#ef4444",
  "#10b981",
  "#f59e0b",
  "#8b5cf6",
  "#ec4899",
  "#06b6d4",
  "#f97316",
];

function isValidReviewAssignment(value: {
  profileId?: string;
  excludedProfileIds: string[];
}): boolean {
  return Boolean(value.profileId || value.excludedProfileIds.length > 0) &&
    (!value.profileId || !value.excludedProfileIds.includes(value.profileId));
}

export const speakerSegmentsRequestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("coverage"),
    ...range,
    bucketMs: z.number().int().min(1_000).max(86_400_000),
  }),
  z.object({
    action: z.literal("list"),
    ...range,
    profileId: objectId.optional(),
    state: z.enum(["matched", "rejected", "uncertain"]).optional(),
    view: z.enum(["full", "timeline"]).default("full"),
    limit: z.number().int().min(1).max(5000).default(1000),
  }),
  z.object({
    action: z.literal("annotate"),
    originalId: objectId,
    segmentId: objectId.optional(),
    runId: z.string().optional(),
    ...range,
    profileId: objectId.optional(),
    excludedProfileIds: z.array(objectId).default([]),
  }).refine(
    (v) => Boolean(v.profileId) !== (v.excludedProfileIds.length > 0),
    "Choose a profile or excluded profiles",
  ),
  z.object({
    action: z.literal("assign"),
    segmentId: objectId,
    scope: z.enum(["segment", "speaker"]),
    profileId: objectId.optional(),
  }),
  z.object({
    action: z.literal("create-profile"),
    name: profileName,
  }),
  z.object({
    action: z.literal("create-profile-from-segments"),
    name: profileName,
    segmentIds: z.array(objectId).min(1).max(100),
  }),
  z.object({ action: z.literal("delete-annotation"), id: objectId }),
  z.object({
    action: z.literal("preview-review-session"),
    ...reviewSourceShape,
    previewLimit: z.number().int().min(1).max(10).default(5),
  }).superRefine((value, context) =>
    validateReviewSource(value, context, {
      allowEmptySelectedRecordings: true,
    })
  ),
  z.object({
    action: z.literal("create-review-session"),
    name: z.string().max(120).optional(),
    ...reviewSourceShape,
    limit: z.number().int().min(1).max(100).default(10),
    preferences: z.object({
      autoPlay: z.boolean().default(true),
      autoAdvanceWindow: z.boolean().default(true),
      groupMode: z.boolean().default(true),
      compactMode: z.boolean().default(true),
    }).default({
      autoPlay: true,
      autoAdvanceWindow: true,
      groupMode: true,
      compactMode: true,
    }),
  }).superRefine((value, context) =>
    validateReviewSource(value, context, {
      allowEmptySelectedRecordings: false,
    })
  ),
  z.object({
    action: z.literal("list-review-sessions"),
    profileId: objectId.optional(),
    limit: z.number().int().min(1).max(50).default(20),
  }),
  z.object({ action: z.literal("get-review-session"), sessionId: objectId }),
  z.object({
    action: z.literal("load-next-review-window"),
    sessionId: objectId,
    revision: z.number().int().positive(),
  }),
  z.object({
    action: z.literal("update-review-position"),
    sessionId: objectId,
    revision: z.number().int().positive(),
    activeSegmentId: objectId.nullable().optional(),
    skipSegmentId: objectId.optional(),
    preferences: z.object({
      autoPlay: z.boolean().optional(),
      autoAdvanceWindow: z.boolean().optional(),
      groupMode: z.boolean().optional(),
      compactMode: z.boolean().optional(),
    }).optional(),
  }),
  z.object({
    action: z.literal("commit-review-decision"),
    sessionId: objectId,
    revision: z.number().int().positive(),
    clientRequestId: z.string().min(1).max(120),
    segmentIds: z.array(objectId).min(1).max(100),
    profileId: objectId.optional(),
    excludedProfileIds: z.array(objectId).default([]),
  }).refine(
    isValidReviewAssignment,
    "Choose an assigned or excluded profile without contradicting the assignment",
  ),
  z.object({
    action: z.literal("revise-review-decision"),
    sessionId: objectId,
    revision: z.number().int().positive(),
    clientRequestId: z.string().min(1).max(120),
    segmentIds: z.array(objectId).min(1).max(100),
    replacesDecisionId: objectId,
    profileId: objectId.optional(),
    excludedProfileIds: z.array(objectId).default([]),
  }).refine(
    isValidReviewAssignment,
    "Choose an assigned or excluded profile without contradicting the assignment",
  ),
  z.object({
    action: z.literal("commit-review-skip"),
    sessionId: objectId,
    revision: z.number().int().positive(),
    clientRequestId: z.string().min(1).max(120),
    segmentIds: z.array(objectId).min(1).max(100),
    replacesDecisionId: objectId.optional(),
  }),
  z.object({
    action: z.literal("list-review-history"),
    profileId: objectId,
    limit: z.number().int().min(1).max(500).default(100),
  }),
  z.object({
    action: z.literal("revise-review-history"),
    profileId: objectId,
    segmentId: objectId,
    replacesDecisionId: objectId,
    clientRequestId: z.string().min(1).max(120),
    outcome: z.enum(["assigned", "skipped"]),
    assignedProfileId: objectId.optional(),
    excludedProfileIds: z.array(objectId).default([]),
  }).refine(
    (value) =>
      value.outcome === "skipped" || isValidReviewAssignment({
        profileId: value.assignedProfileId,
        excludedProfileIds: value.excludedProfileIds,
      }),
    "An assigned correction needs a profile or an excluded target",
  ),
  z.object({
    action: z.literal("undo-review-decision"),
    sessionId: objectId,
    revision: z.number().int().positive(),
    decisionId: objectId,
  }),
  z.object({
    action: z.literal("complete-review-session"),
    sessionId: objectId,
  }),
  z.object({
    action: z.literal("review-queue"),
    ...range,
    state: z.enum(["matched", "rejected", "uncertain", "reviewable"]).default(
      "reviewable",
    ),
    limit: z.number().int().min(1).max(1000).default(100),
  }),
  z.object({
    action: z.literal("similar"),
    segmentId: objectId,
    topN: z.number().int().min(1).max(100).default(20),
    candidateLimit: z.number().int().min(1).max(10000).default(5000),
  }),
  z.object({
    action: z.literal("list-calibrations"),
    profileId: objectId.optional(),
  }),
  z.object({
    action: z.literal("calibration-preview"),
    profileId: objectId,
    calibrationRecordingIds: z.array(z.string()).default([]),
    validationRecordingIds: z.array(z.string()).default([]),
    targetPrecision: z.number().min(SPEAKER_CALIBRATION_PILOT_MIN_PRECISION)
      .max(1).default(SPEAKER_CALIBRATION_TARGET_PRECISION),
    positiveThresholdOverride: z.number().finite().min(-1).max(1).optional(),
  }).superRefine((value, context) => {
    if (
      value.positiveThresholdOverride !== undefined &&
      value.targetPrecision >= SPEAKER_CALIBRATION_TARGET_PRECISION
    ) {
      context.addIssue({
        code: "custom",
        path: ["positiveThresholdOverride"],
        message:
          "Positive threshold override is available only for provisional pilots",
      });
    }
  }),
  z.object({
    action: z.literal("identity-status"),
    profileId: objectId,
  }),
  z.object({
    action: z.literal("identity-classification"),
    profileId: objectId,
  }),
  z.object({
    action: z.literal("list-identity-campaigns"),
    profileId: objectId.optional(),
    runId: z.string().optional(),
    limit: z.number().int().min(1).max(100).default(20),
  }),
  z.object({
    action: z.literal("save-calibration"),
    profileId: objectId,
    calibrationRecordingIds: z.array(z.string()).min(1),
    validationRecordingIds: z.array(z.string()).min(1),
    targetPrecision: z.number().min(SPEAKER_CALIBRATION_PILOT_MIN_PRECISION)
      .max(1).default(SPEAKER_CALIBRATION_TARGET_PRECISION),
    positiveThresholdOverride: z.number().finite().min(-1).max(1).optional(),
    acceptLowerPrecisionRisk: z.boolean().default(false),
  }).strict().superRefine((value, context) => {
    if (
      value.targetPrecision < SPEAKER_CALIBRATION_TARGET_PRECISION &&
      value.acceptLowerPrecisionRisk !== true
    ) {
      context.addIssue({
        code: "custom",
        path: ["acceptLowerPrecisionRisk"],
        message:
          "Explicitly accept lower-precision pilot risk before saving this calibration",
      });
    }
    if (
      value.positiveThresholdOverride !== undefined &&
      value.targetPrecision >= SPEAKER_CALIBRATION_TARGET_PRECISION
    ) {
      context.addIssue({
        code: "custom",
        path: ["positiveThresholdOverride"],
        message:
          "Positive threshold override is available only for provisional pilots",
      });
    }
  }),
  z.object({ action: z.literal("list-runs") }),
  z.object({
    action: z.literal("list-campaigns"),
    runId: z.string().optional(),
    limit: z.number().int().min(1).max(100).default(20),
  }),
  z.object({
    action: z.literal("create-run"),
    runId: z.string().min(1),
    mode: z.enum(["missing", "rediarize"]),
    ...range,
    generation: z.number().int().min(1),
    replacesRunId: z.string().optional(),
    diarizationFingerprint: z.record(z.string(), z.any()),
    embeddingSpaceId: z.string().min(1),
    sourceJobId: z.string().optional(),
  }),
  z.object({
    action: z.literal("mark-run-ready"),
    runId: z.string().min(1),
    coverage: z.record(z.string(), z.any()).default({}),
    errors: z.array(z.any()).default([]),
  }),
  z.object({ action: z.literal("compare-run"), runId: z.string().min(1) }),
  z.object({ action: z.literal("mark-run-failed"), runId: z.string().min(1) }),
  z.object({ action: z.literal("activate-run"), runId: z.string().min(1) }),
  z.object({ action: z.literal("preview-purge"), runId: z.string().min(1) }),
  z.object({
    action: z.literal("purge-superseded"),
    runId: z.string().min(1),
    confirmation: z.string(),
  }),
]);

type SpeakerSegmentsRequest = z.input<typeof speakerSegmentsRequestSchema>;

function normalizedEmbedding(values: unknown): number[] | null {
  if (
    !Array.isArray(values) || values.length === 0 ||
    values.some((value) => typeof value !== "number" || !Number.isFinite(value))
  ) {
    return null;
  }
  const norm = Math.sqrt(
    values.reduce((sum: number, value: number) => sum + value * value, 0),
  );
  if (!Number.isFinite(norm) || norm === 0) return null;
  return values.map((value: number) => value / norm);
}

function centroidEmbedding(embeddings: unknown[]): number[] {
  const normalized = embeddings.map(normalizedEmbedding);
  if (normalized.some((embedding) => embedding === null)) {
    throw new Error("Every selected segment must have a valid voice embedding");
  }
  const vectors = normalized as number[][];
  const dimension = vectors[0].length;
  if (vectors.some((embedding) => embedding.length !== dimension)) {
    throw new Error("Selected segment embeddings have different dimensions");
  }
  const centroid = Array.from(
    { length: dimension },
    (_, index) =>
      vectors.reduce((sum, embedding) => sum + embedding[index], 0) /
      vectors.length,
  );
  const result = normalizedEmbedding(centroid);
  if (!result) {
    throw new Error("Selected segment embeddings cancel each other out");
  }
  return result;
}

async function nextProfileColor(mongo: any): Promise<string> {
  const profiles = await mongo({
    action: "find",
    collection: "speaker_profiles",
    query: {},
    options: { projection: { _id: 1 }, limit: 5_000 },
  }) as any[];
  return PROFILE_COLORS[profiles.length % PROFILE_COLORS.length];
}

async function assertProfileNameAvailable(mongo: any, name: string) {
  const existing = await mongo({
    action: "findOne",
    collection: "speaker_profiles",
    query: { name },
    options: { projection: { _id: 1 } },
  });
  if (existing) {
    throw new Error(`A voice profile named "${name}" already exists`);
  }
}

type ReviewAutomaticIdentityContext = {
  calibrationId: string;
  profileRevision: number;
  embeddingSpaceId: string;
  decisionValidity: "verified" | "provisional";
};

type ResolvedReviewCandidateContext = {
  embeddingSpaceIds: string[];
  automaticIdentity: ReviewAutomaticIdentityContext | null;
};

export async function resolveReviewCandidateContext(
  mongo: any,
  targetProfileId: string,
  requested: string[],
  options: {
    sourceMode:
      | "all_matching"
      | "selected_recordings"
      | "timeline_range"
      | "diarization_generation";
    runIds: string[];
    candidateMode: "reviewable" | "auto_matched";
  },
): Promise<ResolvedReviewCandidateContext> {
  const profile = await mongo({
    action: "findOne",
    collection: "speaker_profiles",
    query: { _id: new ObjectId(targetProfileId) },
    options: { projection: { name: 1, revision: 1, embeddingSpaceId: 1 } },
  }) as any;
  if (!profile) throw new Error("Review target profile not found");
  const profileSpace = String(profile.embeddingSpaceId ?? "").trim();
  if (!profileSpace || ["unknown", "legacy-unknown"].includes(profileSpace)) {
    throw new Error(
      (profile.name ?? "Voice profile") +
        " must be re-enrolled before scoped review",
    );
  }
  if (requested.length > 0 && !requested.includes(profileSpace)) {
    throw new Error(
      "Review embedding space does not match " +
        (profile.name ?? "the target profile"),
    );
  }
  if (options.runIds.length > 0) {
    const run = await mongo({
      action: "findOne",
      collection: "diarization_runs",
      query: { runId: options.runIds[0] },
      options: {
        projection: { runId: 1, status: 1, embeddingSpaceId: 1 },
      },
    }) as any;
    if (!run || run.status !== "active") {
      throw new Error("The selected diarization generation is not active");
    }
    if (run.embeddingSpaceId !== profileSpace) {
      throw new Error(
        "The selected diarization generation uses a different embedding space",
      );
    }
  }
  let automaticIdentity: ReviewAutomaticIdentityContext | null = null;
  if (options.candidateMode === "auto_matched") {
    const calibrations = await mongo({
      action: "find",
      collection: "speaker_calibrations",
      query: { profileId: targetProfileId },
      options: { sort: { createdAt: -1 }, limit: 20 },
    }) as any[];
    const profileRevision = Number(profile.revision ?? 1);
    const calibration = findUsableCalibration(calibrations, {
      profileId: targetProfileId,
      profileRevision,
      embeddingSpaceId: profileSpace,
    });
    if (!calibration) {
      throw new Error(
        "Audit automatic matches requires a current server-validated calibration",
      );
    }
    const policy = normalizeCalibrationPolicy(calibration);
    if (!policy) {
      throw new Error(
        "Audit automatic matches requires a current calibration policy",
      );
    }
    automaticIdentity = {
      calibrationId: String(calibration.calibrationId),
      profileRevision,
      embeddingSpaceId: profileSpace,
      decisionValidity: policy.classificationPolicy === "full"
        ? "verified"
        : "provisional",
    };
  }
  return { embeddingSpaceIds: [profileSpace], automaticIdentity };
}

type ReviewCandidateScope = {
  embeddingSpaceIds?: string[];
  runIds?: string[];
  recordingIds?: string[];
};

function safeObjectIdValues(ids: string[]): Array<string | ObjectId> {
  return [...new Set(ids)].filter(ObjectId.isValid).flatMap((id) => [
    id,
    new ObjectId(id),
  ]);
}

function buildReviewIdentityFilter(
  candidateMode: "reviewable" | "auto_matched",
  targetProfileId?: string,
  automaticIdentity?: ReviewAutomaticIdentityContext | null,
): Record<string, unknown> {
  const profileValues = targetProfileId && ObjectId.isValid(targetProfileId)
    ? [targetProfileId, new ObjectId(targetProfileId)]
    : [];
  if (candidateMode === "auto_matched") {
    if (!automaticIdentity || profileValues.length === 0) {
      throw new Error(
        "Audit automatic matches requires a current identity calibration",
      );
    }
    return {
      "speakerIdentity.state": "matched",
      "speakerIdentity.calibrationId": automaticIdentity.calibrationId,
      "speakerIdentity.profileRevision": automaticIdentity.profileRevision,
      "speakerIdentity.embeddingSpaceId": automaticIdentity.embeddingSpaceId,
      "speakerIdentity.source": "automatic",
      "speakerIdentity.validity": automaticIdentity.decisionValidity,
      $or: [
        { "speakerIdentity.profileId": { $in: profileValues } },
        { "speakerIdentity.topCandidate.profileId": { $in: profileValues } },
      ],
    };
  }
  return {
    $or: [
      { "speakerIdentity.state": "uncertain" },
      { "speakerIdentity.identityState": "unclassified" },
      { speakerIdentity: { $exists: false } },
      { "speakerIdentity.identityState": { $exists: false } },
    ],
  };
}

function buildStoredReviewScopeQuery(
  scope: ReviewCandidateScope,
  candidateMode: "reviewable" | "auto_matched",
  targetProfileId?: string,
  automaticIdentity?: ReviewAutomaticIdentityContext | null,
): Record<string, unknown> {
  const query: Record<string, unknown> = { lifecycleStatus: "active" };
  if (scope.embeddingSpaceIds?.length) {
    query.embeddingSpaceId = { $in: scope.embeddingSpaceIds };
  }
  if (scope.runIds?.length) query.runId = { $in: scope.runIds };
  if (scope.recordingIds?.length) {
    const recordingValues = safeObjectIdValues(scope.recordingIds);
    if (recordingValues.length === 0) return { _id: { $exists: false } };
    query.$or = [
      { original_id: { $in: recordingValues } },
      { original: { $in: recordingValues } },
    ];
  }
  query.$and = [
    buildReviewIdentityFilter(
      candidateMode,
      targetProfileId,
      automaticIdentity,
    ),
  ];
  return query;
}

export function buildReviewCandidateQuery(
  start: Date,
  end: Date,
  candidateMode: "reviewable" | "auto_matched" = "reviewable",
  targetProfileId?: string,
  cursor?: { start: Date | string; segmentId: string } | null,
  scope: ReviewCandidateScope = {},
  automaticIdentity?: ReviewAutomaticIdentityContext | null,
): Record<string, unknown> {
  const identityFilter = buildReviewIdentityFilter(
    candidateMode,
    targetProfileId,
    automaticIdentity,
  );
  const cursorFilter = cursor
    ? {
      $or: [
        { start: { $gt: new Date(cursor.start) } },
        {
          start: new Date(cursor.start),
          _id: { $gt: new ObjectId(cursor.segmentId) },
        },
      ],
    }
    : null;
  const scopedConditions: Record<string, unknown>[] = [identityFilter];
  if (cursorFilter) scopedConditions.push(cursorFilter);
  if (scope.embeddingSpaceIds?.length) {
    scopedConditions.push({
      embeddingSpaceId: { $in: scope.embeddingSpaceIds },
    });
  }
  if (scope.runIds?.length) {
    scopedConditions.push({ runId: { $in: scope.runIds } });
  }
  if (scope.recordingIds?.length) {
    const recordingValues = safeObjectIdValues(scope.recordingIds);
    if (recordingValues.length === 0) {
      scopedConditions.push({ _id: { $exists: false } });
    } else {
      scopedConditions.push({
        $or: [
          { original_id: { $in: recordingValues } },
          { original: { $in: recordingValues } },
        ],
      });
    }
  }
  return {
    lifecycleStatus: "active",
    start: { $lt: end },
    end: { $gt: start },
    $and: scopedConditions,
  };
}

async function findReviewCandidates(
  mongo: any,
  start: Date,
  end: Date,
  limit: number,
  candidateMode: "reviewable" | "auto_matched" = "reviewable",
  targetProfileId?: string,
  cursor?: { start: Date | string; segmentId: string } | null,
  scope: ReviewCandidateScope = {},
  automaticIdentity?: ReviewAutomaticIdentityContext | null,
): Promise<ReviewCandidateScan> {
  const scanLimit = Math.min(Math.max(limit, 1), 5_000);
  const scanHint = scope.runIds?.length
    ? "speaker_identity_campaign_scan"
    : scope.recordingIds?.length
    ? undefined
    : start.getTime() > 0
    ? SPEAKER_REVIEW_RANGE_INDEX
    : SPEAKER_REVIEW_SOURCE_INDEX;
  const rawCandidates = await mongo({
    action: "find",
    collection: "diarizations",
    query: buildReviewCandidateQuery(
      start,
      end,
      candidateMode,
      targetProfileId,
      cursor,
      scope,
      automaticIdentity,
    ),
    options: {
      sort: { start: 1, _id: 1 },
      limit: scanLimit,
      projection: { embedding: 0 },
      ...(scanHint ? { hint: scanHint } : {}),
      maxTimeMS: 15_000,
    },
  }) as any[];
  const scan = buildReviewScanMetadata(rawCandidates, scanLimit);
  const candidateIds = rawCandidates.map((segment) => segment._id);
  if (candidateIds.length === 0) return { ...scan, candidates: [] };
  const [annotations, skippedDecisions] = await Promise.all([
    mongo({
      action: "find",
      collection: "speaker_annotations",
      query: { segmentId: { $in: candidateIds } },
      options: {
        projection: { segmentId: 1 },
        limit: candidateIds.length,
        maxTimeMS: 10_000,
      },
    }),
    targetProfileId
      ? mongo({
        action: "find",
        collection: "speaker_review_decisions",
        query: {
          status: "committed",
          outcome: "skipped",
          targetProfileIds: new ObjectId(targetProfileId),
          segmentIds: { $in: candidateIds },
        },
        options: {
          projection: { segmentIds: 1 },
          limit: candidateIds.length,
          maxTimeMS: 10_000,
        },
      })
      : Promise.resolve([]),
  ]) as [any[], any[]];
  const excluded = new Set([
    ...annotations.map((item) => String(item.segmentId)),
    ...skippedDecisions.flatMap((decision) =>
      (decision.segmentIds ?? []).map(String)
    ),
  ]);
  return {
    ...scan,
    candidates: rawCandidates.filter((segment) =>
      !excluded.has(String(segment._id))
    ),
  };
}

type ReviewCandidateScan = {
  candidates: any[];
  rawScannedCount: number;
  capped: boolean;
  nextCursor: { start: Date | string; segmentId: string } | null;
};

export function buildReviewScanMetadata(
  rawCandidates: any[],
  scanLimit: number,
): Omit<ReviewCandidateScan, "candidates"> {
  const last = rawCandidates.at(-1);
  return {
    rawScannedCount: rawCandidates.length,
    capped: rawCandidates.length >= scanLimit,
    nextCursor: last
      ? { start: last.start, segmentId: String(last._id) }
      : null,
  };
}

export function stratifyReviewCandidates(
  candidates: any[],
  limit: number,
): { selected: any[]; remaining: any[] } {
  const groups = new Map<string, any[]>();
  for (const candidate of candidates) {
    const recordingId = String(
      candidate.original_id ?? candidate.original ?? "unknown",
    );
    const group = groups.get(recordingId) ?? [];
    group.push(candidate);
    groups.set(recordingId, group);
  }
  const queues = [...groups.values()];
  const selected: any[] = [];
  while (selected.length < limit && queues.some((queue) => queue.length > 0)) {
    for (const queue of queues) {
      const candidate = queue.shift();
      if (candidate) selected.push(candidate);
      if (selected.length >= limit) break;
    }
  }
  const selectedIds = new Set(
    selected.map((candidate) => String(candidate._id)),
  );
  return {
    selected,
    remaining: candidates.filter((candidate) =>
      !selectedIds.has(String(candidate._id))
    ),
  };
}

async function loadBufferedReviewCandidates(
  mongo: any,
  ids: unknown[],
  targetProfileId?: string,
  scope: ReviewCandidateScope = {},
  candidateMode: "reviewable" | "auto_matched" = "reviewable",
  automaticIdentity?: ReviewAutomaticIdentityContext | null,
): Promise<any[]> {
  const objectIds = ids.map(String).filter(ObjectId.isValid).map((id) =>
    new ObjectId(id)
  );
  if (objectIds.length === 0) return [];
  const candidates = await mongo({
    action: "find",
    collection: "diarizations",
    query: {
      _id: { $in: objectIds },
      ...buildStoredReviewScopeQuery(
        scope,
        candidateMode,
        targetProfileId,
        automaticIdentity,
      ),
    },
    options: { projection: { embedding: 0 }, limit: objectIds.length },
  }) as any[];
  const [annotations, skippedDecisions] = await Promise.all([
    mongo({
      action: "find",
      collection: "speaker_annotations",
      query: { segmentId: { $in: objectIds } },
      options: { projection: { segmentId: 1 }, limit: objectIds.length },
    }),
    targetProfileId
      ? mongo({
        action: "find",
        collection: "speaker_review_decisions",
        query: {
          status: "committed",
          outcome: "skipped",
          targetProfileIds: new ObjectId(targetProfileId),
          segmentIds: { $in: objectIds },
        },
        options: { projection: { segmentIds: 1 }, limit: objectIds.length },
      })
      : Promise.resolve([]),
  ]) as [any[], any[]];
  const excluded = new Set([
    ...annotations.map((item) => String(item.segmentId)),
    ...skippedDecisions.flatMap((decision) =>
      (decision.segmentIds ?? []).map(String)
    ),
  ]);
  const byId = new Map(candidates.map((item) => [String(item._id), item]));
  return objectIds.map((id) => byId.get(String(id))).filter((item) =>
    item && !excluded.has(String(item._id))
  );
}

async function suppressStaleAutomaticIdentities(
  mongo: any,
  segments: any[],
): Promise<void> {
  const automatic = segments.filter((segment) =>
    segment.speakerIdentity?.source !== "manual_projection" &&
    segment.speakerIdentity?.calibrationId
  );
  const calibrationIds = [
    ...new Set(
      automatic.map((segment) => String(segment.speakerIdentity.calibrationId)),
    ),
  ];
  if (calibrationIds.length === 0) return;
  const calibrations = await mongo({
    action: "find",
    collection: "speaker_calibrations",
    query: { calibrationId: { $in: calibrationIds } },
    options: { limit: calibrationIds.length },
  }) as any[];
  const profileIds = [
    ...new Set(
      calibrations.map((calibration) => String(calibration.profileId ?? ""))
        .filter(ObjectId.isValid),
    ),
  ];
  const profiles = profileIds.length === 0 ? [] : await mongo({
    action: "find",
    collection: "speaker_profiles",
    query: { _id: { $in: profileIds.map((id) => new ObjectId(id)) } },
    options: {
      projection: { revision: 1, embeddingSpaceId: 1 },
      limit: profileIds.length,
    },
  }) as any[];
  const profileById = new Map(
    profiles.map((profile) => [String(profile._id), profile]),
  );
  const usablePolicies = new Map<string, "full" | "pilot">();
  for (const calibration of calibrations) {
    const profileId = String(calibration.profileId ?? "");
    const profile = profileById.get(profileId);
    const usable = profile && findUsableCalibration([calibration], {
      profileId,
      profileRevision: Number(profile.revision ?? 1),
      embeddingSpaceId: profile.embeddingSpaceId,
    });
    const policy = usable ? normalizeCalibrationPolicy(calibration) : null;
    if (policy) {
      usablePolicies.set(
        String(calibration.calibrationId),
        policy.classificationPolicy,
      );
    }
  }
  for (const segment of automatic) {
    const identity = segment.speakerIdentity;
    const policy = usablePolicies.get(String(identity.calibrationId));
    if (policy) {
      identity.validity = policy === "full" ? "verified" : "provisional";
      identity.classificationPolicy = policy;
      continue;
    }
    identity.validity = "stale";
    identity.staleState = identity.state;
    delete identity.state;
    identity.identityState = "unclassified";
  }
}

async function hydrateReviewSession(
  mongo: any,
  session: any,
): Promise<any> {
  const { candidateBufferIds: _candidateBufferIds, ...publicSession } = session;
  const window = session?.window ?? [];
  const ids = window.map((item: any) => String(item.segmentId)).filter(
    ObjectId.isValid,
  ).map((id: string) => new ObjectId(id));
  const segments = ids.length === 0 ? [] : await mongo({
    action: "find",
    collection: "diarizations",
    query: { _id: { $in: ids }, lifecycleStatus: "active" },
    options: { projection: { embedding: 0 }, limit: ids.length },
  }) as any[];
  const byId = new Map(
    segments.map((segment) => [String(segment._id), segment]),
  );
  const decisionIds = [
    ...new Set(
      window.map((item: any) => String(item.decisionId ?? "")).filter(
        ObjectId.isValid,
      ),
    ),
  ].map((id) => new ObjectId(String(id)));
  const decisions = decisionIds.length === 0 ? [] : await mongo({
    action: "find",
    collection: "speaker_review_decisions",
    query: { _id: { $in: decisionIds }, status: "committed" },
    options: {
      projection: {
        outcome: 1,
        profileId: 1,
        excludedProfileIds: 1,
        source: 1,
        updatedAt: 1,
      },
      limit: decisionIds.length,
    },
  }) as any[];
  const profileIds = [
    ...new Set(
      decisions.flatMap((decision) => [
        String(decision.profileId ?? ""),
        ...(decision.excludedProfileIds ?? []).map(String),
      ]).filter(ObjectId.isValid),
    ),
  ].map((id) => new ObjectId(String(id)));
  const profiles = profileIds.length === 0 ? [] : await mongo({
    action: "find",
    collection: "speaker_profiles",
    query: { _id: { $in: profileIds } },
    options: { projection: { name: 1 }, limit: profileIds.length },
  }) as any[];
  return {
    ...publicSession,
    window: attachReviewDecisionSummaries(window, decisions, profiles),
    segments: window.map((item: any) => byId.get(String(item.segmentId)))
      .filter(Boolean),
  };
}

async function loadReviewHistory(
  mongo: any,
  author: string,
  profileId: string,
  limit: number,
): Promise<any> {
  const profileObjectId = new ObjectId(profileId);
  const scanLimit = Math.min(Math.max(limit * 10, 500), 5_000);
  const decisions = await mongo({
    action: "find",
    collection: "speaker_review_decisions",
    query: {
      author,
      status: "committed",
      targetProfileIds: profileObjectId,
    },
    options: {
      sort: { updatedAt: -1, createdAt: -1 },
      limit: scanLimit,
      projection: {
        sessionId: 1,
        segmentIds: 1,
        targetProfileIds: 1,
        outcome: 1,
        profileId: 1,
        excludedProfileIds: 1,
        source: 1,
        updatedAt: 1,
        createdAt: 1,
      },
    },
  }) as any[];
  const latestBySegment = new Map<string, any>();
  for (const decision of decisions) {
    for (const segmentId of decision.segmentIds ?? []) {
      const id = String(segmentId);
      if (!latestBySegment.has(id)) latestBySegment.set(id, decision);
    }
  }
  const selected = [...latestBySegment.entries()].slice(0, limit);
  const segmentIds = selected.map(([id]) => id).filter(ObjectId.isValid).map(
    (id) => new ObjectId(id),
  );
  const segments = segmentIds.length === 0 ? [] : await mongo({
    action: "find",
    collection: "diarizations",
    query: { _id: { $in: segmentIds } },
    options: { projection: { embedding: 0 }, limit: segmentIds.length },
  }) as any[];
  const segmentById = new Map(
    segments.map((segment) => [String(segment._id), segment]),
  );
  const sessionIds = [
    ...new Set(
      selected.map(([, decision]) => String(decision.sessionId ?? "")).filter(
        ObjectId.isValid,
      ),
    ),
  ].map((id) => new ObjectId(id));
  const sessions = sessionIds.length === 0 ? [] : await mongo({
    action: "find",
    collection: "speaker_review_sessions",
    query: { _id: { $in: sessionIds }, owner: author },
    options: {
      projection: { name: 1, status: 1 },
      limit: sessionIds.length,
    },
  }) as any[];
  const sessionById = new Map(
    sessions.map((session) => [String(session._id), session]),
  );
  const profileIds = [
    ...new Set(
      selected.flatMap(([, decision]) => [
        String(decision.profileId ?? ""),
        ...(decision.excludedProfileIds ?? []).map(String),
      ]).filter(ObjectId.isValid),
    ),
  ].map((id) => new ObjectId(id));
  const profiles = profileIds.length === 0 ? [] : await mongo({
    action: "find",
    collection: "speaker_profiles",
    query: { _id: { $in: profileIds } },
    options: { projection: { name: 1 }, limit: profileIds.length },
  }) as any[];
  const profileNames = new Map(
    profiles.map((profile) => [
      String(profile._id),
      String(profile.name ?? "Deleted profile"),
    ]),
  );
  return {
    items: selected.map(([segmentId, decision]) => {
      const segment = segmentById.get(segmentId) ?? null;
      const assignedProfileId = decision.profileId
        ? String(decision.profileId)
        : null;
      const excludedProfileIds = (decision.excludedProfileIds ?? []).map(
        String,
      );
      const session = sessionById.get(String(decision.sessionId ?? ""));
      return {
        decisionId: String(decision._id),
        outcome: decision.outcome === "skipped" ? "skipped" : "assigned",
        assignedProfileId,
        assignedProfileName: assignedProfileId
          ? profileNames.get(assignedProfileId) ?? "Deleted profile"
          : null,
        excludedProfileIds,
        excludedProfileNames: excludedProfileIds.map((id: string) =>
          profileNames.get(id) ?? "Deleted profile"
        ),
        updatedAt: decision.updatedAt ?? decision.createdAt ?? null,
        sessionId: decision.sessionId ? String(decision.sessionId) : null,
        sessionName: session?.name ?? "Older review",
        sessionStatus: session?.status ?? null,
        segment,
      };
    }).filter((item) => item.segment),
    scannedDecisions: decisions.length,
    hasMore: decisions.length >= scanLimit ||
      latestBySegment.size > selected.length,
  };
}

async function commitReviewDecisionArtifacts(
  mongo: any,
  decision: any,
  segments: any[],
): Promise<void> {
  const now = new Date();
  for (const segment of segments) {
    await mongo({
      action: "updateOne",
      collection: "speaker_annotations",
      query: { decisionId: decision._id, segmentId: segment._id },
      update: {
        $setOnInsert: {
          decisionId: decision._id,
          sessionId: decision.sessionId,
          originalId: segment.original_id ?? segment.original,
          segmentId: segment._id,
          runId: segment.runId ?? null,
          start: segment.start,
          end: segment.end,
          profileId: decision.profileId ?? null,
          excludedProfileIds: decision.excludedProfileIds ?? [],
          source: "manual",
          author: decision.author,
          createdAt: decision.createdAt ?? now,
        },
        $set: { updatedAt: now },
      },
      options: { upsert: true },
    });
  }
  await mongo({
    action: "updateOne",
    collection: "speaker_review_decisions",
    query: { _id: decision._id, status: "building" },
    update: {
      $set: {
        status: "committed",
        annotationCount: segments.length,
        committedAt: now,
        updatedAt: now,
      },
    },
  });
}

function nextPendingSegmentId(
  window: any[],
  afterSegmentId?: string,
): string | null {
  const after = afterSegmentId
    ? window.findIndex((item) => String(item.segmentId) === afterSegmentId)
    : -1;
  for (let offset = 1; offset <= window.length; offset++) {
    const item = window[(after + offset) % window.length];
    if (item?.status === "pending") return String(item.segmentId);
  }
  return null;
}

async function computeCalibrationPreview(
  mongo: any,
  profileId: string,
  requestedCalibrationIds: string[],
  requestedValidationIds: string[],
  targetPrecision: number,
  positiveThresholdOverride?: number,
): Promise<any> {
  const profileObjectId = new ObjectId(profileId);
  const profile = await mongo({
    action: "findOne",
    collection: "speaker_profiles",
    query: { _id: profileObjectId },
  }) as any;
  if (!profile?.embedding?.length || !profile.embeddingSpaceId) {
    throw new Error("Re-enroll this profile before calibration");
  }
  const annotations = await mongo({
    action: "find",
    collection: "speaker_annotations",
    query: {
      $or: [
        { profileId: profileObjectId },
        { excludedProfileIds: profileObjectId },
      ],
    },
    options: {
      sort: { updatedAt: -1, createdAt: -1 },
      limit: 20_000,
      projection: {
        decisionId: 1,
        sessionId: 1,
        segmentId: 1,
        originalId: 1,
        profileId: 1,
        excludedProfileIds: 1,
        updatedAt: 1,
        createdAt: 1,
      },
    },
  }) as any[];
  const latestBySegment = new Map<string, any>();
  for (const annotation of annotations) {
    const segmentId = String(annotation.segmentId ?? "");
    if (ObjectId.isValid(segmentId) && !latestBySegment.has(segmentId)) {
      latestBySegment.set(segmentId, annotation);
    }
  }
  const segmentIds = [...latestBySegment.keys()].map((id) => new ObjectId(id));
  const segments = segmentIds.length === 0 ? [] : await mongo({
    action: "find",
    collection: "diarizations",
    query: { _id: { $in: segmentIds }, embedding: { $exists: true } },
    options: {
      projection: {
        embedding: 1,
        embeddingSpaceId: 1,
        original_id: 1,
        original: 1,
        runId: 1,
        speaker: 1,
        start: 1,
        end: 1,
      },
      limit: segmentIds.length,
    },
  }) as any[];
  const segmentById = new Map(
    segments.map((segment) => [String(segment._id), segment]),
  );
  const examples: Array<{
    segmentId: string;
    recordingId: string;
    label: "positive" | "negative";
    score: number;
    start: Date;
    end: Date;
    decisionId: string | null;
    sessionId: string | null;
    assignedProfileId: string | null;
    excludedProfileIds: string[];
    updatedAt: Date | null;
    segment: Record<string, unknown>;
  }> = [];
  let incompatible = 0;
  for (const [segmentId, annotation] of latestBySegment) {
    const segment = segmentById.get(segmentId);
    if (
      !segment?.embedding ||
      segment.embeddingSpaceId !== profile.embeddingSpaceId
    ) {
      incompatible += 1;
      continue;
    }
    const isPositive = String(annotation.profileId ?? "") === profileId;
    const isNegative = (annotation.excludedProfileIds ?? []).some((
      id: unknown,
    ) => String(id) === profileId);
    if (!isPositive && !isNegative) continue;
    const { embedding: _embedding, ...publicSegment } = segment;
    examples.push({
      segmentId,
      recordingId: String(
        annotation.originalId ?? segment.original_id ?? segment.original,
      ),
      label: isPositive ? "positive" : "negative",
      score: cosineSimilarity(profile.embedding, segment.embedding),
      start: new Date(segment.start),
      end: new Date(segment.end),
      decisionId: ObjectId.isValid(String(annotation.decisionId ?? ""))
        ? String(annotation.decisionId)
        : null,
      sessionId: ObjectId.isValid(String(annotation.sessionId ?? ""))
        ? String(annotation.sessionId)
        : null,
      assignedProfileId: ObjectId.isValid(String(annotation.profileId ?? ""))
        ? String(annotation.profileId)
        : null,
      excludedProfileIds: (annotation.excludedProfileIds ?? []).map(String),
      updatedAt: annotation.updatedAt ?? annotation.createdAt ?? null,
      segment: publicSegment,
    });
  }
  const recordingMap = new Map<string, any>();
  for (const example of examples) {
    const row = recordingMap.get(example.recordingId) ?? {
      id: example.recordingId,
      positive: 0,
      negative: 0,
      total: 0,
      start: example.start,
      end: example.end,
    };
    row[example.label] += 1;
    row.total += 1;
    if (example.start < row.start) row.start = example.start;
    if (example.end > row.end) row.end = example.end;
    recordingMap.set(example.recordingId, row);
  }
  const recordings = [...recordingMap.values()].sort((a, b) =>
    b.total - a.total || a.id.localeCompare(b.id)
  );
  const automaticSplit = requestedCalibrationIds.length === 0 &&
    requestedValidationIds.length === 0;
  const split = automaticSplit ? splitCalibrationRecordings(recordings) : {
    calibrationRecordingIds: requestedCalibrationIds,
    validationRecordingIds: requestedValidationIds,
  };
  const calibrationSet = new Set(split.calibrationRecordingIds);
  const validationSet = new Set(split.validationRecordingIds);
  const overlap = split.validationRecordingIds.filter((id: string) =>
    calibrationSet.has(id)
  );
  const calibrationExamples = examples.filter((item) =>
    calibrationSet.has(item.recordingId)
  );
  const validationExamples = examples.filter((item) =>
    validationSet.has(item.recordingId)
  );
  const recommendedThresholds = chooseCalibrationThresholds(
    calibrationExamples,
    targetPrecision,
  );
  const thresholdSelection = applyPositiveThresholdOverride(
    recommendedThresholds,
    positiveThresholdOverride,
    targetPrecision < SPEAKER_CALIBRATION_TARGET_PRECISION,
  );
  const thresholds = thresholdSelection.thresholds;
  const calibrationMetrics = thresholds
    ? evaluateCalibration(
      calibrationExamples,
      thresholds.positiveThreshold,
      thresholds.negativeThreshold,
      thresholds.negativeDecisionMode,
    )
    : null;
  const validationMetrics = thresholds
    ? evaluateCalibration(
      validationExamples,
      thresholds.positiveThreshold,
      thresholds.negativeThreshold,
      thresholds.negativeDecisionMode,
    )
    : null;
  const validationIssues = thresholds
    ? {
      falsePositive: validationExamples.filter((example) =>
        example.label === "negative" &&
        classifyCalibrationScore(
            example.score,
            thresholds.positiveThreshold,
            thresholds.negativeThreshold,
            thresholds.negativeDecisionMode,
          ) === "identified"
      ).sort((a, b) => b.score - a.score).slice(0, 200).map((example) => ({
        kind: "false_positive",
        ...example,
        decision: "identified",
      })),
      missedPositive: validationExamples.filter((example) =>
        example.label === "positive" &&
        classifyCalibrationScore(
            example.score,
            thresholds.positiveThreshold,
            thresholds.negativeThreshold,
            thresholds.negativeDecisionMode,
          ) !== "identified"
      ).sort((a, b) => b.score - a.score).slice(0, 200).map((example) => ({
        kind: "missed_positive",
        ...example,
        decision: classifyCalibrationScore(
          example.score,
          thresholds.positiveThreshold,
          thresholds.negativeThreshold,
          thresholds.negativeDecisionMode,
        ),
      })),
    }
    : { falsePositive: [], missedPositive: [] };
  const positive = examples.filter((item) => item.label === "positive").length;
  const negative = examples.length - positive;
  const blockers: string[] = [];
  if (positive < 40) {
    blockers.push(`${40 - positive} more compatible target labels needed`);
  }
  if (negative < 40) {
    blockers.push(`${40 - negative} more compatible not-target labels needed`);
  }
  if (examples.length < 100) {
    blockers.push(
      `${100 - examples.length} more compatible labels needed in total`,
    );
  }
  if (recordings.length < 2) {
    blockers.push("Label at least two different source recordings");
  }
  if (overlap.length > 0) {
    blockers.push("Calibration and validation recordings overlap");
  }
  if (
    calibrationExamples.every((item) => item.label !== "positive") ||
    calibrationExamples.every((item) => item.label !== "negative")
  ) {
    blockers.push("Calibration set needs both target and not-target examples");
  }
  if (
    validationExamples.every((item) => item.label !== "positive") ||
    validationExamples.every((item) => item.label !== "negative")
  ) {
    blockers.push("Validation set needs both target and not-target examples");
  }
  if (!thresholds) {
    blockers.push(
      "No auto-Sky threshold reaches the target precision on calibration audio",
    );
  }
  if (
    thresholds && (!validationMetrics || validationMetrics.identified === 0 ||
      validationMetrics.positivePrecision < targetPrecision)
  ) {
    blockers.push(
      `Validation auto-match precision is below ${
        Math.round(targetPrecision * 100)
      }%`,
    );
  }
  return {
    profile: {
      id: profileId,
      name: profile.name,
      revision: profile.revision ?? 1,
      embeddingSpaceId: profile.embeddingSpaceId,
    },
    counts: {
      positive,
      negative,
      total: examples.length,
      recordings: recordings.length,
      incompatible,
    },
    recordings,
    ...split,
    automaticSplit,
    targetPrecision,
    thresholds,
    recommendedPositiveThreshold:
      thresholdSelection.recommendedPositiveThreshold,
    positiveThresholdSource: thresholdSelection.positiveThresholdSource,
    calibrationMetrics,
    validationMetrics,
    validationIssues,
    scoreDistribution: {
      calibrationPositive: calibrationExamples.filter((item) =>
        item.label === "positive"
      ).map((item) => item.score),
      calibrationNegative: calibrationExamples.filter((item) =>
        item.label === "negative"
      ).map((item) => item.score),
      validationPositive: validationExamples.filter((item) =>
        item.label === "positive"
      ).map((item) => item.score),
      validationNegative: validationExamples.filter((item) =>
        item.label === "negative"
      ).map((item) => item.score),
    },
    blockers: [...new Set(blockers)],
    canValidate: blockers.length === 0,
  };
}

export class SpeakerSegmentsResource
  implements Resource<SpeakerSegmentsRequest, unknown> {
  code = "speaker-segments";
  description =
    "Versioned speaker segments, manual identity annotations, similarity and diarization run lifecycle";
  schemas = { request: speakerSegmentsRequestSchema, response: z.any() };

  extractActions(input: SpeakerSegmentsRequest) {
    return [{ path: ["speaker-segments"], actions: [input.action] }];
  }

  async use(rawInput: SpeakerSegmentsRequest, auth: Auth): Promise<unknown> {
    const input = speakerSegmentsRequestSchema.parse(rawInput);
    const mongo = await getMongoResource(auth);

    switch (input.action) {
      case "create-profile": {
        await assertProfileNameAvailable(mongo, input.name);
        const now = new Date();
        const doc = {
          name: input.name,
          sample_count: 0,
          total_duration: 0,
          is_primary: false,
          color: await nextProfileColor(mongo),
          source: "manual_profile",
          enrollmentStatus: "needs_samples",
          revision: 1,
          created_at: now,
          updated_at: now,
          createdBy: auth.principal,
        };
        const result = await mongo({
          action: "insertOne",
          collection: "speaker_profiles",
          doc,
        }) as any;
        return { ...doc, _id: result.insertedId };
      }
      case "create-profile-from-segments": {
        await assertProfileNameAvailable(mongo, input.name);
        const segmentIds = [...new Set(input.segmentIds)].map((id) =>
          new ObjectId(id)
        );
        const segments = await mongo({
          action: "find",
          collection: "diarizations",
          query: { _id: { $in: segmentIds }, lifecycleStatus: "active" },
          options: { limit: segmentIds.length },
        }) as any[];
        if (segments.length !== segmentIds.length) {
          throw new Error(
            "Every selected review segment must still be active and available",
          );
        }
        const embeddingSpaceIds = new Set(
          segments.map((segment) =>
            String(segment.embeddingSpaceId ?? "legacy-unknown")
          ),
        );
        if (embeddingSpaceIds.size !== 1) {
          throw new Error(
            "Selected segments use different embedding spaces and cannot seed one profile",
          );
        }
        const embeddingSpaceId = [...embeddingSpaceIds][0];
        const embedding = centroidEmbedding(
          segments.map((segment) => segment.embedding),
        );
        const duration = segments.reduce((total, segment) => {
          const start = new Date(segment.start).getTime();
          const end = new Date(segment.end).getTime();
          return total +
            (Number.isFinite(start) && Number.isFinite(end)
              ? Math.max(0, (end - start) / 1_000)
              : 0);
        }, 0);
        const now = new Date();
        const doc = {
          name: input.name,
          embedding,
          embeddingSpaceId,
          sample_count: 0,
          total_duration: 0,
          seed_segment_count: segments.length,
          seed_duration: duration,
          is_primary: false,
          color: await nextProfileColor(mongo),
          source: "review_segments",
          enrollmentStatus: "seeded_from_review",
          revision: 1,
          enrollmentProvenance: {
            source: "review_segments",
            embeddingSpaceId,
            segmentIds: segments.map((segment) => segment._id),
            segmentCount: segments.length,
            duration,
          },
          created_at: now,
          updated_at: now,
          createdBy: auth.principal,
        };
        const result = await mongo({
          action: "insertOne",
          collection: "speaker_profiles",
          doc,
        }) as any;
        return { ...doc, _id: result.insertedId };
      }
      case "coverage": {
        const [rows, buildingRuns] = await Promise.all([
          mongo({
            action: "aggregate",
            collection: "audio_chunks",
            pipeline: buildDiarizationCoveragePipeline(
              input.start,
              input.end,
              input.bucketMs,
            ),
            options: {
              hint: "audio_chunks_diarization_coverage_v1",
              maxTimeMS: 8_000,
            },
          }),
          mongo({
            action: "find",
            collection: "diarization_runs",
            query: {
              status: "building",
              "range.start": { $lt: input.end },
              "range.end": { $gt: input.start },
            },
            options: { projection: { runId: 1, range: 1, generation: 1 } },
          }),
        ]) as [any[], any[]];
        const buckets = new Map<number, Record<string, number>>();
        for (const row of rows) {
          const time = Number(row._id.bucket);
          const counts = buckets.get(time) ?? {};
          counts[String(row._id.state)] = Number(row.count);
          buckets.set(time, counts);
        }
        return {
          bucketMs: input.bucketMs,
          buckets: [...buckets.entries()].map(([start, counts]) => ({
            start,
            end: start + input.bucketMs,
            counts,
          })),
          buildingRuns,
        };
      }
      case "list": {
        const query: Record<string, unknown> = {
          lifecycleStatus: "active",
          start: { $lt: input.end },
          end: { $gt: input.start },
        };
        const segments = await mongo({
          action: "find",
          collection: "diarizations",
          query,
          options: {
            sort: { start: 1 },
            limit: input.state || input.profileId ? 5000 : input.limit,
            ...(input.view === "timeline"
              ? { projection: TIMELINE_SPEAKER_SEGMENT_PROJECTION }
              : {}),
          },
        }) as any[];
        await suppressStaleAutomaticIdentities(mongo, segments);
        const originalIds = [
          ...new Set(
            segments.map((s) => String(s.original_id ?? s.original)).filter(
              ObjectId.isValid,
            ),
          ),
        ].map((id) => new ObjectId(id));
        const annotations = originalIds.length === 0 ? [] : await mongo({
          action: "find",
          collection: "speaker_annotations",
          query: {
            originalId: { $in: originalIds },
            start: { $lt: input.end },
            end: { $gt: input.start },
          },
          options: { sort: { createdAt: 1 } },
        }) as any[];
        for (const segment of segments) {
          const original = String(segment.original_id ?? segment.original);
          const applicable = annotations.filter((a) =>
            String(a.originalId) === original
          );
          for (const annotation of applicable) {
            const projected = projectAnnotationState({
              segmentStart: new Date(segment.start),
              segmentEnd: new Date(segment.end),
              annotationStart: new Date(annotation.start),
              annotationEnd: new Date(annotation.end),
              profileId: annotation.profileId
                ? String(annotation.profileId)
                : undefined,
              excludedProfileIds: (annotation.excludedProfileIds ?? []).map(
                String,
              ),
            });
            if (projected) {
              segment.speakerIdentity = {
                ...segment.speakerIdentity,
                ...projected,
                annotationId: annotation._id,
                validity: "manual",
              };
            }
          }
        }
        const filtered = segments.filter((segment) =>
          (!input.state || segment.speakerIdentity?.state === input.state) &&
          (!input.profileId ||
            String(segment.speakerIdentity?.profileId ?? "") ===
              input.profileId)
        ).slice(0, input.limit);
        return { segments: filtered, annotations };
      }
      case "annotate": {
        const now = new Date();
        const doc = {
          originalId: new ObjectId(input.originalId),
          segmentId: input.segmentId ? new ObjectId(input.segmentId) : null,
          runId: input.runId ?? null,
          start: input.start,
          end: input.end,
          profileId: input.profileId ? new ObjectId(input.profileId) : null,
          excludedProfileIds: input.excludedProfileIds.map((id) =>
            new ObjectId(id)
          ),
          source: "manual",
          author: auth.principal,
          createdAt: now,
          updatedAt: now,
        };
        const result = await mongo({
          action: "insertOne",
          collection: "speaker_annotations",
          doc,
        });
        return { ...doc, _id: (result as any).insertedId };
      }
      case "assign": {
        const source = await mongo({
          action: "findOne",
          collection: "diarizations",
          query: { _id: new ObjectId(input.segmentId) },
        }) as any;
        if (!source) throw new Error("Diarization segment not found");
        const targetQuery = input.scope === "speaker"
          ? {
            lifecycleStatus: "active",
            original_id: source.original_id ?? source.original,
            speaker: source.speaker,
          }
          : { _id: source._id };
        const targets = await mongo({
          action: "find",
          collection: "diarizations",
          query: targetQuery,
          options: { limit: 5000 },
        }) as any[];
        const targetIds = targets.map((target) => target._id);
        await mongo({
          action: "deleteMany",
          collection: "speaker_annotations",
          query: { segmentId: { $in: targetIds } },
        });
        if (!input.profileId) return { assigned: 0, cleared: targetIds.length };
        const now = new Date();
        const docs = targets.map((target) => ({
          originalId: target.original_id ?? target.original,
          segmentId: target._id,
          runId: target.runId ?? null,
          start: target.start,
          end: target.end,
          profileId: new ObjectId(input.profileId!),
          excludedProfileIds: [],
          source: "manual",
          author: auth.principal,
          createdAt: now,
          updatedAt: now,
        }));
        if (docs.length) {
          await mongo({
            action: "insertMany",
            collection: "speaker_annotations",
            docs,
          });
        }
        return { assigned: docs.length, cleared: targetIds.length };
      }
      case "delete-annotation":
        return await mongo({
          action: "deleteOne",
          collection: "speaker_annotations",
          query: { _id: new ObjectId(input.id) },
        });
      case "preview-review-session": {
        const now = new Date();
        const snapshotStart = input.rangeMode === "all_before"
          ? new Date(0)
          : new Date(input.start!);
        const requestedEnd = input.rangeMode === "all_before"
          ? now
          : new Date(input.end!);
        const snapshotEnd = requestedEnd > now ? now : requestedEnd;
        if (!(snapshotStart < snapshotEnd)) {
          throw new Error("Review range must end after it starts");
        }
        const resolvedContext = await resolveReviewCandidateContext(
          mongo,
          input.targetProfileIds[0],
          input.embeddingSpaceIds,
          {
            sourceMode: input.sourceMode,
            runIds: input.runIds,
            candidateMode: input.candidateMode,
          },
        );
        const embeddingSpaceIds = resolvedContext.embeddingSpaceIds;
        const scope = {
          embeddingSpaceIds,
          runIds: input.runIds,
          recordingIds: input.recordingIds,
        };
        const candidateScan = await findReviewCandidates(
          mongo,
          snapshotStart,
          snapshotEnd,
          5_000,
          input.candidateMode,
          input.targetProfileIds[0],
          null,
          scope,
          resolvedContext.automaticIdentity,
        );
        const prepared = prepareReviewCandidates(
          candidateScan.candidates,
          input.quality,
        );
        const { selected: sampleSegments } = stratifyReviewCandidates(
          prepared.candidates,
          input.previewLimit,
        );
        const recordingMap = new Map<string, {
          id: string;
          eligibleSegments: number;
          start: Date;
          end: Date;
        }>();
        for (const segment of prepared.candidates) {
          const id = String(segment.original_id ?? segment.original ?? "");
          if (!ObjectId.isValid(id)) continue;
          const segmentStart = new Date(segment.start);
          const segmentEnd = new Date(segment.end);
          const current = recordingMap.get(id);
          recordingMap.set(
            id,
            current
              ? {
                ...current,
                eligibleSegments: current.eligibleSegments + 1,
                start: segmentStart < current.start
                  ? segmentStart
                  : current.start,
                end: segmentEnd > current.end ? segmentEnd : current.end,
              }
              : {
                id,
                eligibleSegments: 1,
                start: segmentStart,
                end: segmentEnd,
              },
          );
        }
        const recordingIds = [...recordingMap.keys()];
        const sourceFiles = recordingIds.length === 0 ? [] : await mongo({
          action: "find",
          collection: "source_files",
          query: {
            _id: {
              $in: recordingIds.map((id) => new ObjectId(id)),
            },
          },
          options: {
            projection: {
              path: 1,
              filename: 1,
              name: 1,
              start: 1,
              updatedAt: 1,
            },
            limit: recordingIds.length,
            maxTimeMS: 10_000,
          },
        }) as any[];
        const sourceById = new Map(
          sourceFiles.map((source) => [String(source._id), source]),
        );
        const recordings = [...recordingMap.values()].map((recording) => {
          const source = sourceById.get(recording.id);
          return {
            ...recording,
            name: source?.name ?? source?.filename ?? source?.path ?? null,
            path: source?.path ?? null,
          };
        }).sort((a, b) =>
          b.eligibleSegments - a.eligibleSegments ||
          a.start.getTime() - b.start.getTime()
        );
        return {
          sourceMode: input.sourceMode,
          range: { start: snapshotStart, end: snapshotEnd },
          embeddingSpaceIds,
          runIds: input.runIds,
          recordingIds: input.recordingIds,
          scope: {
            sourceMode: input.sourceMode,
            targetProfileIds: input.targetProfileIds,
            embeddingSpaceIds,
            runIds: input.runIds,
            recordingIds: input.recordingIds,
            rangeMode: "fixed",
            candidateMode: input.candidateMode,
            quality: input.quality,
            start: snapshotStart,
            end: snapshotEnd,
          },
          counts: {
            eligibleSegments: prepared.candidates.length,
            recordings: recordings.length,
            scannedSegments: candidateScan.rawScannedCount,
            capped: candidateScan.capped,
          },
          qualityStats: prepared.stats,
          recordings,
          sampleSegments,
        };
      }
      case "create-review-session": {
        const now = new Date();
        const snapshotStart = input.rangeMode === "all_before"
          ? new Date(0)
          : new Date(input.start!);
        const requestedEnd = input.rangeMode === "all_before"
          ? now
          : new Date(input.end!);
        const snapshotEnd = requestedEnd > now ? now : requestedEnd;
        if (!(snapshotStart < snapshotEnd)) {
          throw new Error("Review range must end after it starts");
        }
        const resolvedContext = await resolveReviewCandidateContext(
          mongo,
          input.targetProfileIds[0],
          input.embeddingSpaceIds,
          {
            sourceMode: input.sourceMode,
            runIds: input.runIds,
            candidateMode: input.candidateMode,
          },
        );
        const embeddingSpaceIds = resolvedContext.embeddingSpaceIds;
        const candidateScan = await findReviewCandidates(
          mongo,
          snapshotStart,
          snapshotEnd,
          5_000,
          input.candidateMode,
          input.targetProfileIds[0],
          null,
          {
            embeddingSpaceIds,
            runIds: input.runIds,
            recordingIds: input.recordingIds,
          },
          resolvedContext.automaticIdentity,
        );
        const prepared = prepareReviewCandidates(
          candidateScan.candidates,
          input.quality,
        );
        const { selected: candidates, remaining } = stratifyReviewCandidates(
          prepared.candidates,
          input.limit,
        );
        const groups = groupReviewSegments(candidates);
        const groupBySegment = new Map(
          groups.flatMap((group) =>
            group.segmentIds.map((segmentId) => [segmentId, group.groupId])
          ),
        );
        const sessionId = new ObjectId();
        const doc = {
          _id: sessionId,
          owner: auth.principal,
          name: input.name ??
            `Review ${snapshotEnd.toISOString().slice(0, 10)}`,
          status: "active",
          targetProfileIds: input.targetProfileIds.map((id) =>
            new ObjectId(id)
          ),
          embeddingSpaceIds,
          runIds: input.runIds,
          recordingIds: input.recordingIds.map((id) => new ObjectId(id)),
          querySnapshot: {
            sourceMode: input.sourceMode,
            identityState: input.candidateMode,
            candidateMode: input.candidateMode,
            rangeMode: input.rangeMode,
            start: snapshotStart,
            end: snapshotEnd,
            snapshotEnd,
            sort: { start: 1, _id: 1 },
            quality: input.quality,
            embeddingSpaceIds,
            runIds: input.runIds,
            recordingIds: input.recordingIds.map((id) => new ObjectId(id)),
            automaticIdentity: resolvedContext.automaticIdentity,
          },
          window: candidates.map((segment) => ({
            segmentId: segment._id,
            groupId: groupBySegment.get(String(segment._id)),
            status: "pending",
            ...(segment.reviewQuality
              ? { quality: segment.reviewQuality }
              : {}),
          })),
          candidateBufferIds: remaining.map((segment) => segment._id),
          groups,
          windowNumber: 1,
          windowSize: input.limit,
          loadedCount: candidates.length,
          sessionLoadedCount: candidates.length,
          reviewedCount: 0,
          skippedCount: 0,
          windowReviewedCount: 0,
          windowSkippedCount: 0,
          backlogEstimate: prepared.candidates.length,
          backlogEstimateCapped: candidateScan.capped,
          qualityStats: prepared.stats,
          hasMore: remaining.length > 0 || candidateScan.capped,
          hasMoreBeyondCursor: candidateScan.capped,
          nextCursor: candidateScan.nextCursor,
          activeSegmentId: candidates[0]?._id ?? null,
          grouping: {
            version: "nearby-speaker-v1",
            maxGapSeconds: 2,
            maxDurationSeconds: 30,
            maxSegments: 20,
          },
          preferences: input.preferences,
          revision: 1,
          createdAt: now,
          updatedAt: now,
          lastOpenedAt: now,
        };
        await mongo({
          action: "insertOne",
          collection: "speaker_review_sessions",
          doc,
        });
        const { candidateBufferIds: _candidateBufferIds, ...publicDoc } = doc;
        return { ...publicDoc, segments: candidates };
      }
      case "list-review-sessions":
        return await mongo({
          action: "find",
          collection: "speaker_review_sessions",
          query: {
            owner: auth.principal,
            status: { $ne: "abandoned" },
            ...(input.profileId
              ? { targetProfileIds: new ObjectId(input.profileId) }
              : {}),
          },
          options: {
            sort: { lastOpenedAt: -1, updatedAt: -1 },
            limit: input.limit,
            projection: { window: 0, groups: 0, candidateBufferIds: 0 },
          },
        });
      case "list-review-history":
        return await loadReviewHistory(
          mongo,
          auth.principal,
          input.profileId,
          input.limit,
        );
      case "revise-review-history": {
        const segmentId = new ObjectId(input.segmentId);
        const current = await mongo({
          action: "findOne",
          collection: "speaker_review_decisions",
          query: {
            segmentIds: segmentId,
            author: auth.principal,
            status: "committed",
          },
          options: { sort: { updatedAt: -1, createdAt: -1 } },
        }) as any;
        if (!current || String(current._id) !== input.replacesDecisionId) {
          throw new Error(
            "This history item changed elsewhere; refresh before editing",
          );
        }
        const existing = await mongo({
          action: "findOne",
          collection: "speaker_review_decisions",
          query: {
            author: auth.principal,
            clientRequestId: input.clientRequestId,
          },
        }) as any;
        if (existing?.status === "committed") {
          return await loadReviewHistory(
            mongo,
            auth.principal,
            input.profileId,
            100,
          );
        }
        const segment = await mongo({
          action: "findOne",
          collection: "diarizations",
          query: { _id: segmentId, lifecycleStatus: "active" },
          options: { projection: { embedding: 0 } },
        }) as any;
        if (!segment) {
          throw new Error("The diarization segment is no longer active");
        }
        const now = new Date();
        const decisionId = existing?._id ?? new ObjectId();
        const targetProfileIds = (current.targetProfileIds ?? []).length > 0
          ? current.targetProfileIds
          : [new ObjectId(input.profileId)];
        const assignedProfileId = input.outcome === "assigned" &&
            input.assignedProfileId
          ? new ObjectId(input.assignedProfileId)
          : null;
        const excludedProfileIds = input.outcome === "assigned"
          ? input.excludedProfileIds.map((id) => new ObjectId(id))
          : [];
        await mongo({
          action: "updateOne",
          collection: "speaker_review_decisions",
          query: {
            author: auth.principal,
            clientRequestId: input.clientRequestId,
          },
          update: {
            $setOnInsert: {
              _id: decisionId,
              sessionId: current.sessionId ?? null,
              clientRequestId: input.clientRequestId,
              author: auth.principal,
              segmentIds: [segmentId],
              targetProfileIds,
              outcome: input.outcome,
              profileId: assignedProfileId,
              excludedProfileIds,
              supersedesDecisionId: current._id,
              source: "review_history_revision",
              status: "building",
              createdAt: now,
            },
            $set: { updatedAt: now },
          },
          options: { upsert: true },
        });
        await mongo({
          action: "deleteMany",
          collection: "speaker_annotations",
          query: { segmentId, source: "manual" },
        });
        if (input.outcome === "assigned") {
          await mongo({
            action: "insertOne",
            collection: "speaker_annotations",
            doc: {
              decisionId,
              sessionId: current.sessionId ?? null,
              originalId: segment.original_id ?? segment.original,
              segmentId,
              runId: segment.runId ?? null,
              start: segment.start,
              end: segment.end,
              profileId: assignedProfileId,
              excludedProfileIds,
              source: "manual",
              author: auth.principal,
              createdAt: now,
              updatedAt: now,
            },
          });
        }
        const affectedSessions = await mongo({
          action: "find",
          collection: "speaker_review_sessions",
          query: { owner: auth.principal, "window.segmentId": segmentId },
          options: { limit: 50 },
        }) as any[];
        for (const session of affectedSessions) {
          const previousWindow = session.window ?? [];
          const previous = previousWindow.find((item: any) =>
            String(item.segmentId) === input.segmentId
          );
          if (!previous) continue;
          const nextStatus = input.outcome === "skipped"
            ? "skipped"
            : "reviewed";
          const window = previousWindow.map((item: any) =>
            String(item.segmentId) === input.segmentId
              ? { ...item, status: nextStatus, decisionId }
              : item
          );
          const reviewedDelta = (nextStatus === "reviewed" ? 1 : 0) -
            (previous.status === "reviewed" ? 1 : 0);
          const skippedDelta = (nextStatus === "skipped" ? 1 : 0) -
            (previous.status === "skipped" ? 1 : 0);
          await mongo({
            action: "updateOne",
            collection: "speaker_review_sessions",
            query: { _id: session._id },
            update: {
              $set: {
                window,
                reviewedCount: Math.max(
                  0,
                  Number(session.reviewedCount ?? 0) + reviewedDelta,
                ),
                skippedCount: Math.max(
                  0,
                  Number(session.skippedCount ?? 0) + skippedDelta,
                ),
                windowReviewedCount: window.filter((item: any) =>
                  item.status === "reviewed"
                )
                  .length,
                windowSkippedCount: window.filter((item: any) =>
                  item.status === "skipped"
                )
                  .length,
                updatedAt: now,
              },
              $inc: { revision: 1 },
            },
          });
        }
        await mongo({
          action: "updateOne",
          collection: "speaker_review_decisions",
          query: { _id: decisionId, status: "building" },
          update: {
            $set: {
              status: "committed",
              annotationCount: input.outcome === "assigned" ? 1 : 0,
              committedAt: new Date(),
              updatedAt: new Date(),
            },
          },
        });
        return await loadReviewHistory(
          mongo,
          auth.principal,
          input.profileId,
          100,
        );
      }
      case "get-review-session": {
        const session = await mongo({
          action: "findOne",
          collection: "speaker_review_sessions",
          query: { _id: new ObjectId(input.sessionId), owner: auth.principal },
        }) as any;
        if (!session) throw new Error("Review session not found");
        return await hydrateReviewSession(mongo, session);
      }
      case "load-next-review-window": {
        const sessionId = new ObjectId(input.sessionId);
        const session = await mongo({
          action: "findOne",
          collection: "speaker_review_sessions",
          query: {
            _id: sessionId,
            owner: auth.principal,
            status: "active",
            revision: input.revision,
          },
        }) as any;
        if (!session) {
          throw new Error(
            "Review session changed elsewhere; reload to continue",
          );
        }
        if (
          (session.window ?? []).some((item: any) => item.status === "pending")
        ) {
          throw new Error("Review or skip every item in this window first");
        }
        const snapshot = session.querySnapshot;
        const targetProfileId = String(session.targetProfileIds?.[0] ?? "");
        const candidateMode = snapshot.candidateMode ?? "reviewable";
        const scope = {
          embeddingSpaceIds: snapshot.embeddingSpaceIds ??
            session.embeddingSpaceIds ?? [],
          runIds: snapshot.runIds ?? session.runIds ?? [],
          recordingIds: (
            snapshot.recordingIds ?? session.recordingIds ?? []
          ).map(String),
        };
        const sourceMode = snapshot.sourceMode ??
          (scope.runIds.length > 0
            ? "diarization_generation"
            : scope.recordingIds.length > 0
            ? "selected_recordings"
            : "all_matching");
        const resolvedContext = await resolveReviewCandidateContext(
          mongo,
          targetProfileId,
          scope.embeddingSpaceIds.map(String),
          {
            sourceMode,
            runIds: scope.runIds.map(String),
            candidateMode,
          },
        );
        scope.embeddingSpaceIds = resolvedContext.embeddingSpaceIds;
        const frozenAutomaticIdentity = snapshot.automaticIdentity as
          | ReviewAutomaticIdentityContext
          | null
          | undefined;
        if (
          frozenAutomaticIdentity &&
          JSON.stringify(frozenAutomaticIdentity) !==
            JSON.stringify(resolvedContext.automaticIdentity)
        ) {
          throw new Error(
            "This automatic-match review session is stale; create a new session",
          );
        }
        const buffered = await loadBufferedReviewCandidates(
          mongo,
          session.candidateBufferIds ?? [],
          targetProfileId,
          scope,
          candidateMode,
          resolvedContext.automaticIdentity,
        );
        const fetchedScan = buffered.length === 0 &&
            Boolean(session.hasMoreBeyondCursor ?? session.hasMore)
          ? await findReviewCandidates(
            mongo,
            new Date(snapshot.start),
            new Date(snapshot.snapshotEnd ?? snapshot.end),
            5_000,
            candidateMode,
            targetProfileId,
            session.nextCursor,
            scope,
            resolvedContext.automaticIdentity,
          )
          : null;
        const prepared = buffered.length > 0
          ? {
            candidates: buffered,
            stats: {
              input: 0,
              accepted: 0,
              shortExcluded: 0,
              duplicateExcluded: 0,
            },
          }
          : prepareReviewCandidates(
            fetchedScan?.candidates ?? [],
            snapshot.quality ?? {
              minDurationSeconds: 0,
              deduplicateOverlaps: false,
            },
          );
        const candidatePool = prepared.candidates;
        const { selected: candidates, remaining } = stratifyReviewCandidates(
          candidatePool,
          Number(session.windowSize ?? 100),
        );
        const groups = groupReviewSegments(candidates, session.grouping);
        const groupBySegment = new Map(
          groups.flatMap((group) =>
            group.segmentIds.map((segmentId) => [segmentId, group.groupId])
          ),
        );
        const window = candidates.map((segment) => ({
          segmentId: segment._id,
          groupId: groupBySegment.get(String(segment._id)),
          status: "pending",
          ...(segment.reviewQuality ? { quality: segment.reviewQuality } : {}),
        }));
        const hasMoreBeyondCursor = buffered.length > 0
          ? Boolean(session.hasMoreBeyondCursor ?? session.hasMore)
          : Boolean(fetchedScan?.capped);
        const completed = candidates.length === 0 && !hasMoreBeyondCursor;
        const result = await mongo({
          action: "updateOne",
          collection: "speaker_review_sessions",
          query: { _id: sessionId, revision: input.revision },
          update: {
            $set: {
              window,
              groups,
              candidateBufferIds: remaining.map((segment) => segment._id),
              activeSegmentId: candidates[0]?._id ?? null,
              loadedCount: candidates.length,
              sessionLoadedCount:
                Number(session.sessionLoadedCount ?? session.loadedCount ?? 0) +
                candidates.length,
              windowReviewedCount: 0,
              windowSkippedCount: 0,
              qualityStats: {
                input: Number(session.qualityStats?.input ?? 0) +
                  prepared.stats.input,
                accepted: Number(session.qualityStats?.accepted ?? 0) +
                  prepared.stats.accepted,
                shortExcluded:
                  Number(session.qualityStats?.shortExcluded ?? 0) +
                  prepared.stats.shortExcluded,
                duplicateExcluded:
                  Number(session.qualityStats?.duplicateExcluded ?? 0) +
                  prepared.stats.duplicateExcluded,
              },
              hasMore: remaining.length > 0 || hasMoreBeyondCursor,
              hasMoreBeyondCursor,
              nextCursor: fetchedScan?.nextCursor ?? session.nextCursor,
              status: completed ? "completed" : "active",
              ...(completed ? { completedAt: new Date() } : {}),
              updatedAt: new Date(),
              lastOpenedAt: new Date(),
            },
            $inc: { revision: 1, windowNumber: 1 },
          },
        }) as any;
        if (result.matchedCount !== 1) {
          throw new Error(
            "Review session changed elsewhere; reload to continue",
          );
        }
        const updated = await mongo({
          action: "findOne",
          collection: "speaker_review_sessions",
          query: { _id: sessionId },
        }) as any;
        return await hydrateReviewSession(mongo, updated);
      }
      case "update-review-position": {
        const sessionId = new ObjectId(input.sessionId);
        const session = await mongo({
          action: "findOne",
          collection: "speaker_review_sessions",
          query: {
            _id: sessionId,
            owner: auth.principal,
            status: "active",
            revision: input.revision,
          },
        }) as any;
        if (!session) {
          throw new Error(
            "Review session changed elsewhere; reload to continue",
          );
        }
        const window = [...(session.window ?? [])];
        let skippedDelta = 0;
        if (input.skipSegmentId) {
          const item = window.find((entry: any) =>
            String(entry.segmentId) === input.skipSegmentId
          );
          if (!item) {
            throw new Error("Skipped segment is not in this review window");
          }
          if (item.status === "reviewed") {
            throw new Error(
              "Undo the saved decision before skipping this segment",
            );
          }
          if (item.status !== "skipped") skippedDelta = 1;
          item.status = "skipped";
        }
        const validActive = input.activeSegmentId == null || window.some(
          (item: any) => String(item.segmentId) === input.activeSegmentId,
        );
        if (!validActive) {
          throw new Error("Active segment is not in this review window");
        }
        const preferences = {
          ...(session.preferences ?? {}),
          ...(input.preferences ?? {}),
        };
        const windowSkippedCount =
          window.filter((item: any) => item.status === "skipped").length;
        const skippedCount = Number(session.skippedCount ?? 0) + skippedDelta;
        const result = await mongo({
          action: "updateOne",
          collection: "speaker_review_sessions",
          query: { _id: sessionId, revision: input.revision },
          update: {
            $set: {
              window,
              preferences,
              skippedCount,
              windowSkippedCount,
              ...(input.activeSegmentId !== undefined
                ? {
                  activeSegmentId: input.activeSegmentId
                    ? new ObjectId(input.activeSegmentId)
                    : null,
                }
                : {}),
              updatedAt: new Date(),
              lastOpenedAt: new Date(),
            },
            $inc: { revision: 1 },
          },
        }) as any;
        if (result.matchedCount !== 1) {
          throw new Error(
            "Review session changed elsewhere; reload to continue",
          );
        }
        const updated = await mongo({
          action: "findOne",
          collection: "speaker_review_sessions",
          query: { _id: sessionId },
        }) as any;
        return await hydrateReviewSession(mongo, updated);
      }
      case "commit-review-decision": {
        const sessionId = new ObjectId(input.sessionId);
        const existing = await mongo({
          action: "findOne",
          collection: "speaker_review_decisions",
          query: { sessionId, clientRequestId: input.clientRequestId },
        }) as any;
        if (existing?.status === "committed") {
          const session = await mongo({
            action: "findOne",
            collection: "speaker_review_sessions",
            query: { _id: sessionId, owner: auth.principal },
          }) as any;
          return {
            decision: existing,
            session: await hydrateReviewSession(mongo, session),
          };
        }
        if (existing?.status === "building") {
          const recoverySession = await mongo({
            action: "findOne",
            collection: "speaker_review_sessions",
            query: { _id: sessionId, owner: auth.principal, status: "active" },
          }) as any;
          const claimed = (existing.segmentIds ?? []).every(
            (segmentId: unknown) =>
              (recoverySession?.window ?? []).some((item: any) =>
                String(item.segmentId) === String(segmentId) &&
                String(item.decisionId) === String(existing._id)
              ),
          );
          if (claimed) {
            const recoverySegments = await mongo({
              action: "find",
              collection: "diarizations",
              query: {
                _id: { $in: existing.segmentIds ?? [] },
                lifecycleStatus: "active",
              },
              options: {
                projection: { embedding: 0 },
                limit: (existing.segmentIds ?? []).length,
              },
            }) as any[];
            await commitReviewDecisionArtifacts(
              mongo,
              existing,
              recoverySegments,
            );
            return {
              decision: { ...existing, status: "committed" },
              session: await hydrateReviewSession(mongo, recoverySession),
            };
          }
        }
        const session = await mongo({
          action: "findOne",
          collection: "speaker_review_sessions",
          query: {
            _id: sessionId,
            owner: auth.principal,
            status: { $in: ["active", "completed"] },
            revision: input.revision,
          },
        }) as any;
        if (!session) {
          throw new Error(
            "Review session changed elsewhere; reload to continue",
          );
        }
        const segmentIds = [...new Set(input.segmentIds)];
        const allowed = new Set(
          (session.window ?? []).map((item: any) => String(item.segmentId)),
        );
        if (segmentIds.some((id) => !allowed.has(id))) {
          throw new Error(
            "Every selected segment must belong to this review window",
          );
        }
        if (
          session.status === "completed" &&
          (session.window ?? []).some((item: any) =>
            segmentIds.includes(String(item.segmentId)) &&
            item.status === "pending"
          )
        ) {
          throw new Error(
            "Completed sessions only allow corrections to saved answers",
          );
        }
        const objectIds = segmentIds.map((id) => new ObjectId(id));
        const segments = await mongo({
          action: "find",
          collection: "diarizations",
          query: { _id: { $in: objectIds }, lifecycleStatus: "active" },
          options: { projection: { embedding: 0 }, limit: objectIds.length },
        }) as any[];
        if (segments.length !== objectIds.length) {
          throw new Error("One or more selected segments are no longer active");
        }
        const now = new Date();
        const decisionId = existing?._id ?? new ObjectId();
        await mongo({
          action: "updateOne",
          collection: "speaker_review_decisions",
          query: { sessionId, clientRequestId: input.clientRequestId },
          update: {
            $setOnInsert: {
              _id: decisionId,
              sessionId,
              clientRequestId: input.clientRequestId,
              author: auth.principal,
              segmentIds: objectIds,
              targetProfileIds: session.targetProfileIds ?? [],
              originalGroups: session.groups,
              outcome: "assigned",
              profileId: input.profileId ? new ObjectId(input.profileId) : null,
              excludedProfileIds: input.excludedProfileIds.map((id) =>
                new ObjectId(id)
              ),
              source: segmentIds.length > 1 ? "review_batch" : "review_single",
              status: "building",
              createdAt: now,
            },
            $set: { updatedAt: now },
          },
          options: { upsert: true },
        });
        for (const segment of segments) {
          await mongo({
            action: "updateOne",
            collection: "speaker_annotations",
            query: { decisionId, segmentId: segment._id },
            update: {
              $setOnInsert: {
                decisionId,
                sessionId,
                originalId: segment.original_id ?? segment.original,
                segmentId: segment._id,
                runId: segment.runId ?? null,
                start: segment.start,
                end: segment.end,
                profileId: input.profileId
                  ? new ObjectId(input.profileId)
                  : null,
                excludedProfileIds: input.excludedProfileIds.map((id) =>
                  new ObjectId(id)
                ),
                source: "manual",
                author: auth.principal,
                createdAt: now,
              },
              $set: { updatedAt: now },
            },
            options: { upsert: true },
          });
        }
        await mongo({
          action: "updateOne",
          collection: "speaker_review_decisions",
          query: { _id: decisionId },
          update: {
            $set: {
              status: "committed",
              annotationCount: segments.length,
              committedAt: new Date(),
              updatedAt: new Date(),
            },
          },
        });
        const selected = new Set(segmentIds);
        const selectedItems = (session.window ?? []).filter((item: any) =>
          selected.has(String(item.segmentId))
        );
        const reviewedDelta =
          selectedItems.filter((item: any) => item.status !== "reviewed")
            .length;
        const skippedToReviewed =
          selectedItems.filter((item: any) => item.status === "skipped").length;
        const window = (session.window ?? []).map((item: any) =>
          selected.has(String(item.segmentId))
            ? { ...item, status: "reviewed", decisionId }
            : item
        );
        const windowReviewedCount =
          window.filter((item: any) => item.status === "reviewed").length;
        const windowSkippedCount =
          window.filter((item: any) => item.status === "skipped").length;
        const reviewedCount = Number(session.reviewedCount ?? 0) +
          reviewedDelta;
        const skippedCount = Math.max(
          0,
          Number(session.skippedCount ?? 0) - skippedToReviewed,
        );
        const activeSegmentId = nextPendingSegmentId(window, segmentIds.at(-1));
        const updated = await mongo({
          action: "updateOne",
          collection: "speaker_review_sessions",
          query: { _id: sessionId, revision: input.revision },
          update: {
            $set: {
              window,
              reviewedCount,
              skippedCount,
              windowReviewedCount,
              windowSkippedCount,
              activeSegmentId: activeSegmentId
                ? new ObjectId(activeSegmentId)
                : null,
              updatedAt: new Date(),
              lastOpenedAt: new Date(),
            },
            $inc: { revision: 1 },
          },
        }) as any;
        if (updated.matchedCount !== 1) {
          throw new Error(
            "Decision was saved; reload the session to refresh its position",
          );
        }
        const latestSession = await mongo({
          action: "findOne",
          collection: "speaker_review_sessions",
          query: { _id: sessionId },
        }) as any;
        return {
          decision: {
            _id: decisionId,
            status: "committed",
            segmentIds: objectIds,
          },
          session: await hydrateReviewSession(mongo, latestSession),
        };
      }
      case "commit-review-skip": {
        const sessionId = new ObjectId(input.sessionId);
        const existing = await mongo({
          action: "findOne",
          collection: "speaker_review_decisions",
          query: { sessionId, clientRequestId: input.clientRequestId },
        }) as any;
        if (existing?.status === "committed") {
          const current = await mongo({
            action: "findOne",
            collection: "speaker_review_sessions",
            query: { _id: sessionId, owner: auth.principal },
          }) as any;
          return {
            decision: existing,
            session: await hydrateReviewSession(mongo, current),
          };
        }
        const session = await mongo({
          action: "findOne",
          collection: "speaker_review_sessions",
          query: {
            _id: sessionId,
            owner: auth.principal,
            status: { $in: ["active", "completed"] },
            revision: input.revision,
          },
        }) as any;
        if (!session) {
          throw new Error(
            "Review session changed elsewhere; reload to continue",
          );
        }
        const segmentIds = [...new Set(input.segmentIds)];
        const selected = new Set(segmentIds);
        const selectedItems = (session.window ?? []).filter((item: any) =>
          selected.has(String(item.segmentId))
        );
        if (selectedItems.length !== segmentIds.length) {
          throw new Error(
            "Every skipped segment must belong to this review window",
          );
        }
        if (
          selectedItems.some((item: any) => item.status === "reviewed") &&
          (!input.replacesDecisionId ||
            selectedItems.some((item: any) =>
              String(item.decisionId ?? "") !== input.replacesDecisionId
            ))
        ) {
          throw new Error(
            "The reviewed answer changed; reopen Edit before skipping it",
          );
        }
        const objectIds = segmentIds.map((id) => new ObjectId(id));
        const now = new Date();
        const decisionId = existing?._id ?? new ObjectId();
        await mongo({
          action: "updateOne",
          collection: "speaker_review_decisions",
          query: { sessionId, clientRequestId: input.clientRequestId },
          update: {
            $setOnInsert: {
              _id: decisionId,
              sessionId,
              clientRequestId: input.clientRequestId,
              author: auth.principal,
              segmentIds: objectIds,
              targetProfileIds: session.targetProfileIds ?? [],
              outcome: "skipped",
              profileId: null,
              excludedProfileIds: [],
              ...(input.replacesDecisionId
                ? {
                  supersedesDecisionId: new ObjectId(
                    input.replacesDecisionId,
                  ),
                }
                : {}),
              source: segmentIds.length > 1
                ? "review_batch_skip"
                : "review_single_skip",
              status: "building",
              createdAt: now,
            },
            $set: { updatedAt: now },
          },
          options: { upsert: true },
        });
        const window = (session.window ?? []).map((item: any) =>
          selected.has(String(item.segmentId))
            ? { ...item, status: "skipped", decisionId }
            : item
        );
        const reviewedRemoved =
          selectedItems.filter((item: any) => item.status === "reviewed")
            .length;
        const skippedAdded =
          selectedItems.filter((item: any) => item.status !== "skipped").length;
        const activeSegmentId = selected.has(String(session.activeSegmentId))
          ? nextPendingSegmentId(window, segmentIds.at(-1))
          : String(session.activeSegmentId ?? "") || null;
        const updated = await mongo({
          action: "updateOne",
          collection: "speaker_review_sessions",
          query: { _id: sessionId, revision: input.revision },
          update: {
            $set: {
              window,
              reviewedCount: Math.max(
                0,
                Number(session.reviewedCount ?? 0) - reviewedRemoved,
              ),
              skippedCount: Number(session.skippedCount ?? 0) + skippedAdded,
              windowReviewedCount: window.filter((item: any) =>
                item.status === "reviewed"
              ).length,
              windowSkippedCount:
                window.filter((item: any) => item.status === "skipped").length,
              activeSegmentId: activeSegmentId
                ? new ObjectId(activeSegmentId)
                : null,
              updatedAt: now,
              lastOpenedAt: now,
            },
            $inc: { revision: 1 },
          },
        }) as any;
        if (updated.matchedCount !== 1) {
          await mongo({
            action: "updateOne",
            collection: "speaker_review_decisions",
            query: { _id: decisionId, status: "building" },
            update: { $set: { status: "conflicted", updatedAt: new Date() } },
          });
          throw new Error(
            "Review session changed elsewhere; reload to continue",
          );
        }
        await mongo({
          action: "deleteMany",
          collection: "speaker_annotations",
          query: { segmentId: { $in: objectIds }, source: "manual" },
        });
        await mongo({
          action: "updateOne",
          collection: "speaker_review_decisions",
          query: { _id: decisionId, status: "building" },
          update: {
            $set: {
              status: "committed",
              annotationCount: 0,
              committedAt: new Date(),
              updatedAt: new Date(),
            },
          },
        });
        const latestSession = await mongo({
          action: "findOne",
          collection: "speaker_review_sessions",
          query: { _id: sessionId },
        }) as any;
        return {
          decision: { _id: decisionId, status: "committed", segmentIds },
          session: await hydrateReviewSession(mongo, latestSession),
        };
      }
      case "revise-review-decision": {
        const sessionId = new ObjectId(input.sessionId);
        const existing = await mongo({
          action: "findOne",
          collection: "speaker_review_decisions",
          query: { sessionId, clientRequestId: input.clientRequestId },
        }) as any;
        if (existing?.status === "committed") {
          const session = await mongo({
            action: "findOne",
            collection: "speaker_review_sessions",
            query: { _id: sessionId, owner: auth.principal },
          }) as any;
          return {
            decision: existing,
            session: await hydrateReviewSession(mongo, session),
          };
        }
        if (existing?.status === "building") {
          const recoverySession = await mongo({
            action: "findOne",
            collection: "speaker_review_sessions",
            query: { _id: sessionId, owner: auth.principal, status: "active" },
          }) as any;
          const claimed = (existing.segmentIds ?? []).every(
            (segmentId: unknown) =>
              (recoverySession?.window ?? []).some((item: any) =>
                String(item.segmentId) === String(segmentId) &&
                String(item.decisionId) === String(existing._id)
              ),
          );
          if (claimed) {
            const recoverySegments = await mongo({
              action: "find",
              collection: "diarizations",
              query: {
                _id: { $in: existing.segmentIds ?? [] },
                lifecycleStatus: "active",
              },
              options: {
                projection: { embedding: 0 },
                limit: (existing.segmentIds ?? []).length,
              },
            }) as any[];
            if (
              recoverySegments.length !== (existing.segmentIds ?? []).length
            ) {
              throw new Error(
                "One or more selected segments are no longer active",
              );
            }
            await commitReviewDecisionArtifacts(
              mongo,
              existing,
              recoverySegments,
            );
            return {
              decision: { ...existing, status: "committed" },
              session: await hydrateReviewSession(mongo, recoverySession),
            };
          }
        }
        const session = await mongo({
          action: "findOne",
          collection: "speaker_review_sessions",
          query: {
            _id: sessionId,
            owner: auth.principal,
            status: { $in: ["active", "completed"] },
            revision: input.revision,
          },
        }) as any;
        if (!session) {
          throw new Error(
            "Review session changed elsewhere; reload to continue",
          );
        }
        const segmentIds = [...new Set(input.segmentIds)];
        const previousWindow = session.window ?? [];
        let decisionId = existing?._id ?? new ObjectId();
        let window = applyReviewDecisionRevision(previousWindow, {
          segmentIds,
          replacesDecisionId: input.replacesDecisionId,
          decisionId,
        });
        const objectIds = segmentIds.map((id) => new ObjectId(id));
        const segments = await mongo({
          action: "find",
          collection: "diarizations",
          query: { _id: { $in: objectIds }, lifecycleStatus: "active" },
          options: { projection: { embedding: 0 }, limit: objectIds.length },
        }) as any[];
        if (segments.length !== objectIds.length) {
          throw new Error("One or more selected segments are no longer active");
        }
        const now = new Date();
        await mongo({
          action: "updateOne",
          collection: "speaker_review_decisions",
          query: { sessionId, clientRequestId: input.clientRequestId },
          update: {
            $setOnInsert: {
              _id: decisionId,
              sessionId,
              clientRequestId: input.clientRequestId,
              author: auth.principal,
              segmentIds: objectIds,
              targetProfileIds: session.targetProfileIds ?? [],
              originalGroups: session.groups,
              outcome: "assigned",
              profileId: input.profileId ? new ObjectId(input.profileId) : null,
              excludedProfileIds: input.excludedProfileIds.map((id) =>
                new ObjectId(id)
              ),
              supersedesDecisionId: new ObjectId(input.replacesDecisionId),
              source: segmentIds.length > 1
                ? "review_batch_revision"
                : "review_single_revision",
              status: "building",
              createdAt: now,
            },
            $set: { updatedAt: now },
          },
          options: { upsert: true },
        });
        const persistedDecision = await mongo({
          action: "findOne",
          collection: "speaker_review_decisions",
          query: { sessionId, clientRequestId: input.clientRequestId },
        }) as any;
        if (
          !persistedDecision?._id || persistedDecision.status !== "building"
        ) {
          throw new Error("Review decision could not be claimed");
        }
        decisionId = persistedDecision._id;
        window = applyReviewDecisionRevision(previousWindow, {
          segmentIds,
          replacesDecisionId: input.replacesDecisionId,
          decisionId,
        });
        const updated = await mongo({
          action: "updateOne",
          collection: "speaker_review_sessions",
          query: { _id: sessionId, revision: input.revision },
          update: {
            $set: {
              window,
              reviewedCount: Number(session.reviewedCount ?? 0) +
                window.filter((item: any) => item.status === "reviewed")
                  .length -
                previousWindow.filter((item: any) => item.status === "reviewed")
                  .length,
              skippedCount: Number(session.skippedCount ?? 0) +
                window.filter((item: any) => item.status === "skipped").length -
                previousWindow.filter((item: any) => item.status === "skipped")
                  .length,
              windowReviewedCount: window.filter((item: any) =>
                item.status === "reviewed"
              ).length,
              windowSkippedCount:
                window.filter((item: any) => item.status === "skipped").length,
              updatedAt: new Date(),
              lastOpenedAt: new Date(),
            },
            $inc: { revision: 1 },
          },
        }) as any;
        if (updated.matchedCount !== 1) {
          const latest = await mongo({
            action: "findOne",
            collection: "speaker_review_sessions",
            query: { _id: sessionId, owner: auth.principal },
          }) as any;
          const claimed = segmentIds.every((segmentId) =>
            (latest?.window ?? []).some((item: any) =>
              String(item.segmentId) === segmentId &&
              String(item.decisionId) === String(decisionId)
            )
          );
          if (!claimed) {
            await mongo({
              action: "updateOne",
              collection: "speaker_review_decisions",
              query: { _id: decisionId, status: "building" },
              update: { $set: { status: "conflicted", updatedAt: new Date() } },
            });
            throw new Error(
              "Review session changed elsewhere; reload to continue",
            );
          }
        }
        await mongo({
          action: "deleteMany",
          collection: "speaker_annotations",
          query: { segmentId: { $in: objectIds }, source: "manual" },
        });
        await commitReviewDecisionArtifacts(mongo, persistedDecision, segments);
        const latestSession = await mongo({
          action: "findOne",
          collection: "speaker_review_sessions",
          query: { _id: sessionId },
        }) as any;
        return {
          decision: {
            _id: decisionId,
            status: "committed",
            segmentIds: objectIds,
            supersedesDecisionId: new ObjectId(input.replacesDecisionId),
          },
          session: await hydrateReviewSession(mongo, latestSession),
        };
      }
      case "undo-review-decision": {
        const decisionId = new ObjectId(input.decisionId);
        const decision = await mongo({
          action: "findOne",
          collection: "speaker_review_decisions",
          query: {
            _id: decisionId,
            author: auth.principal,
            status: { $in: ["committed", "rolling_back"] },
          },
        }) as any;
        if (!decision) throw new Error("Review decision cannot be undone");
        if (String(decision.sessionId) !== input.sessionId) {
          throw new Error("Review decision does not belong to this session");
        }
        const currentSession = await mongo({
          action: "findOne",
          collection: "speaker_review_sessions",
          query: {
            _id: new ObjectId(input.sessionId),
            owner: auth.principal,
            status: "active",
          },
        }) as any;
        if (!currentSession) throw new Error("Review session not found");
        const decisionStillCurrent = (decision.segmentIds ?? []).some(
          (segmentId: unknown) =>
            (currentSession.window ?? []).some((item: any) =>
              String(item.segmentId) === String(segmentId) &&
              String(item.decisionId) === input.decisionId
            ),
        );
        if (!decisionStillCurrent) {
          await mongo({
            action: "deleteMany",
            collection: "speaker_annotations",
            query: { decisionId },
          });
          await mongo({
            action: "updateOne",
            collection: "speaker_review_decisions",
            query: { _id: decisionId, status: { $ne: "rolled_back" } },
            update: {
              $set: {
                status: "rolled_back",
                rolledBackAt: new Date(),
                updatedAt: new Date(),
              },
            },
          });
          return await hydrateReviewSession(mongo, currentSession);
        }
        const session = Number(currentSession.revision) === input.revision
          ? currentSession
          : null;
        if (!session) {
          throw new Error(
            "Review session changed elsewhere; reload to continue",
          );
        }
        const restored = restoreReviewDecision(session.window ?? [], {
          segmentIds: decision.segmentIds ?? [],
          decisionId: input.decisionId,
        });
        const restoredIds = new Set(
          (decision.segmentIds ?? []).map((segmentId: unknown) =>
            String(segmentId)
          ),
        );
        const restoredReviewedCount = (session.window ?? []).filter((
          item: any,
        ) =>
          restoredIds.has(String(item.segmentId)) &&
          String(item.decisionId ?? "") === input.decisionId &&
          item.status === "reviewed"
        ).length;
        const restoredSkippedCount = (session.window ?? []).filter((
          item: any,
        ) =>
          restoredIds.has(String(item.segmentId)) &&
          String(item.decisionId ?? "") === input.decisionId &&
          item.status === "skipped"
        ).length;
        const window = restored.window;
        const windowReviewedCount =
          window.filter((item: any) => item.status === "reviewed").length;
        const windowSkippedCount =
          window.filter((item: any) => item.status === "skipped").length;
        const updated = await mongo({
          action: "updateOne",
          collection: "speaker_review_sessions",
          query: { _id: session._id, revision: input.revision },
          update: {
            $set: {
              window,
              reviewedCount: Math.max(
                0,
                Number(session.reviewedCount ?? 0) -
                  restoredReviewedCount,
              ),
              skippedCount: Math.max(
                0,
                Number(session.skippedCount ?? 0) - restoredSkippedCount,
              ),
              windowReviewedCount,
              windowSkippedCount,
              activeSegmentId: restored.firstRestored,
              updatedAt: new Date(),
              lastOpenedAt: new Date(),
            },
            $inc: { revision: 1 },
          },
        }) as any;
        if (updated.matchedCount !== 1) {
          throw new Error(
            "Review session changed elsewhere; reload to continue",
          );
        }
        await mongo({
          action: "updateOne",
          collection: "speaker_review_decisions",
          query: { _id: decisionId, status: "committed" },
          update: { $set: { status: "rolling_back", updatedAt: new Date() } },
        });
        await mongo({
          action: "deleteMany",
          collection: "speaker_annotations",
          query: { decisionId },
        });
        await mongo({
          action: "updateOne",
          collection: "speaker_review_decisions",
          query: { _id: decisionId, status: "rolling_back" },
          update: {
            $set: {
              status: "rolled_back",
              rolledBackAt: new Date(),
              updatedAt: new Date(),
            },
          },
        });
        const latestSession = await mongo({
          action: "findOne",
          collection: "speaker_review_sessions",
          query: { _id: session._id },
        }) as any;
        return await hydrateReviewSession(mongo, latestSession);
      }
      case "complete-review-session": {
        const result = await mongo({
          action: "updateOne",
          collection: "speaker_review_sessions",
          query: {
            _id: new ObjectId(input.sessionId),
            owner: auth.principal,
            status: "active",
          },
          update: {
            $set: {
              status: "completed",
              completedAt: new Date(),
              updatedAt: new Date(),
            },
            $inc: { revision: 1 },
          },
        }) as any;
        if (result.matchedCount !== 1) {
          throw new Error("Active review session not found");
        }
        return { success: true, sessionId: input.sessionId };
      }
      case "review-queue": {
        const candidates = await mongo({
          action: "find",
          collection: "diarizations",
          query: {
            lifecycleStatus: "active",
            start: { $lt: input.end },
            end: { $gt: input.start },
            ...(input.state === "reviewable"
              ? {
                $or: [
                  { "speakerIdentity.state": "uncertain" },
                  { speakerIdentity: { $exists: false } },
                  { "speakerIdentity.identityState": { $exists: false } },
                ],
              }
              : { "speakerIdentity.state": input.state }),
          },
          options: {
            sort: input.state === "reviewable"
              ? { start: -1 }
              : { "speakerIdentity.primaryScore": 1 },
            limit: Math.min(input.limit * 3, 3000),
            projection: {
              embedding: 0,
            },
          },
        }) as any[];
        const candidateIds = candidates.map((segment) => segment._id);
        const annotations = candidateIds.length === 0 ? [] : await mongo({
          action: "find",
          collection: "speaker_annotations",
          query: { segmentId: { $in: candidateIds } },
          options: { projection: { segmentId: 1 }, limit: candidateIds.length },
        }) as any[];
        const annotated = new Set(
          annotations.map((item) => String(item.segmentId)),
        );
        return candidates.filter((segment) =>
          !annotated.has(String(segment._id))
        )
          .slice(0, input.limit);
      }
      case "similar": {
        const source = await mongo({
          action: "findOne",
          collection: "diarizations",
          query: { _id: new ObjectId(input.segmentId) },
        }) as any;
        if (!source?.embedding) {
          throw new Error("Source segment has no embedding");
        }
        if (!source.embeddingSpaceId) {
          throw new Error("Source segment has no embeddingSpaceId");
        }
        const candidates = await mongo({
          action: "find",
          collection: "diarizations",
          query: {
            lifecycleStatus: "active",
            embeddingSpaceId: source.embeddingSpaceId,
            embedding: { $exists: true },
            _id: { $ne: source._id },
          },
          options: { limit: input.candidateLimit },
        }) as any[];
        return candidates.map((segment) => ({
          segment,
          score: cosineSimilarity(source.embedding, segment.embedding),
        })).sort((a, b) => b.score - a.score).slice(0, input.topN);
      }
      case "list-calibrations":
        return await mongo({
          action: "find",
          collection: "speaker_calibrations",
          query: input.profileId ? { profileId: input.profileId } : {},
          options: { sort: { createdAt: -1 } },
        });
      case "calibration-preview":
        return await computeCalibrationPreview(
          mongo,
          input.profileId,
          input.calibrationRecordingIds,
          input.validationRecordingIds,
          input.targetPrecision,
          input.positiveThresholdOverride,
        );
      case "identity-status": {
        const profileId = new ObjectId(input.profileId);
        const [
          profile,
          annotations,
          calibrations,
          latestJobs,
          latestCampaigns,
        ] = await Promise.all([
          mongo({
            action: "findOne",
            collection: "speaker_profiles",
            query: { _id: profileId },
            options: {
              projection: {
                name: 1,
                is_primary: 1,
                revision: 1,
                embeddingSpaceId: 1,
                sample_count: 1,
                enrollmentStatus: 1,
                embedding: 1,
              },
            },
          }),
          mongo({
            action: "find",
            collection: "speaker_annotations",
            query: {
              $or: [
                { profileId },
                { excludedProfileIds: profileId },
              ],
            },
            options: {
              projection: {
                segmentId: 1,
                originalId: 1,
                profileId: 1,
                excludedProfileIds: 1,
                createdAt: 1,
                updatedAt: 1,
              },
              sort: { updatedAt: -1, createdAt: -1 },
              limit: 10_000,
            },
          }),
          mongo({
            action: "find",
            collection: "speaker_calibrations",
            query: { profileId: input.profileId },
            options: { sort: { createdAt: -1 }, limit: 10 },
          }),
          mongo({
            action: "find",
            collection: "jobs",
            query: {
              type: "speakerIdentity",
              "data.profileId": input.profileId,
            },
            options: {
              sort: { updatedAt: -1, createdAt: -1 },
              projection: {
                state: 1,
                progress: 1,
                result: 1,
                createdAt: 1,
                updatedAt: 1,
                failedReason: 1,
              },
              limit: 1,
            },
          }),
          mongo({
            action: "find",
            collection: "speaker_identity_campaigns",
            query: { profileId: input.profileId },
            options: { sort: { updatedAt: -1 }, limit: 1 },
          }),
        ]) as [any, any[], any[], any[], any[]];
        const profileRevision = Number(profile?.revision ?? 1);
        const profileEmbeddingSpaceId = profile?.embeddingSpaceId;
        const calibrationContext = {
          profileId: input.profileId,
          profileRevision,
          embeddingSpaceId: profileEmbeddingSpaceId,
        };
        const describedCalibrations = describeCalibrations(
          calibrations,
          calibrationContext,
        );
        const latestUsableCalibrationRecord = findUsableCalibration(
          calibrations,
          calibrationContext,
        );
        const usableFullCalibration = findUsableFullCalibration(
          calibrations,
          calibrationContext,
        );
        const usablePilotCalibrationRecord = findUsablePilotCalibration(
          calibrations,
          calibrationContext,
        );
        // Launchers should never be moved from a verified/full calibration to a
        // newer bounded pilot. Keep the pilot visible separately for audit and
        // explicitly scoped pilot runs.
        const usableCalibrationRecord = usableFullCalibration ??
          latestUsableCalibrationRecord;
        const usableCalibrationPolicy = usableCalibrationRecord
          ? normalizeCalibrationPolicy(usableCalibrationRecord)
          : null;
        const usableCalibration = usableCalibrationRecord &&
            usableCalibrationPolicy
          ? {
            ...usableCalibrationRecord,
            ...usableCalibrationPolicy,
            negativeDecisionMode: normalizeNegativeDecisionMode(
              usableCalibrationRecord,
            ),
            recommendedPositiveThreshold: normalizePositiveThresholdProvenance(
              usableCalibrationRecord,
            )
              ?.recommendedPositiveThreshold,
            positiveThresholdSource: normalizePositiveThresholdProvenance(
              usableCalibrationRecord,
            )
              ?.positiveThresholdSource,
          }
          : null;
        const usablePilotCalibrationPolicy = usablePilotCalibrationRecord
          ? normalizeCalibrationPolicy(usablePilotCalibrationRecord)
          : null;
        const usablePilotCalibration = usablePilotCalibrationRecord &&
            usablePilotCalibrationPolicy
          ? {
            ...usablePilotCalibrationRecord,
            ...usablePilotCalibrationPolicy,
            negativeDecisionMode: normalizeNegativeDecisionMode(
              usablePilotCalibrationRecord,
            ),
            recommendedPositiveThreshold: normalizePositiveThresholdProvenance(
              usablePilotCalibrationRecord,
            )
              ?.recommendedPositiveThreshold,
            positiveThresholdSource: normalizePositiveThresholdProvenance(
              usablePilotCalibrationRecord,
            )
              ?.positiveThresholdSource,
          }
          : null;
        const blockers: string[] = [];
        if (!profile) blockers.push("Profile no longer exists");
        if (!profile?.is_primary) blockers.push("Profile is not primary");
        if (
          !Array.isArray(profile?.embedding) || profile.embedding.length === 0
        ) {
          blockers.push("Profile has no enrolled embedding");
        }
        if (profile?.enrollmentStatus === "pending_rebuild") {
          blockers.push("Profile embedding rebuild is pending");
        }
        if (!profileEmbeddingSpaceId) {
          blockers.push("Profile has no embedding provenance");
        }
        if (profile && !usableCalibration) {
          const staleReasons = describedCalibrations.flatMap((calibration) =>
            calibration.staleReasons ?? []
          );
          blockers.push(
            staleReasons.length > 0
              ? `Saved calibration is stale: ${
                [...new Set(staleReasons)].join("; ")
              }`
              : "No server-validated calibration exists for the current profile",
          );
        }
        const recordings = new Map<
          string,
          { id: string; sky: number; notSky: number }
        >();
        let sky = 0;
        let notSky = 0;
        for (
          const annotation of latestReviewAnnotationsBySegment(annotations)
        ) {
          const recordingId = annotation.originalId
            ? String(annotation.originalId)
            : null;
          const isSky = String(annotation.profileId ?? "") === input.profileId;
          const isNotSky = (annotation.excludedProfileIds ?? []).some(
            (id: unknown) => String(id) === input.profileId,
          );
          if (isSky) sky += 1;
          if (isNotSky) notSky += 1;
          if (recordingId) {
            const row = recordings.get(recordingId) ?? {
              id: recordingId,
              sky: 0,
              notSky: 0,
            };
            if (isSky) row.sky += 1;
            if (isNotSky) row.notSky += 1;
            recordings.set(recordingId, row);
          }
        }
        return {
          profile: profile
            ? {
              id: input.profileId,
              name: profile.name,
              isPrimary: profile.is_primary === true,
              revision: profileRevision,
              embeddingSpaceId: profileEmbeddingSpaceId ?? null,
              sampleCount: Number(profile.sample_count ?? 0),
            }
            : null,
          labels: {
            sky,
            notSky,
            total: sky + notSky,
            recordings: recordings.size,
            byRecording: [...recordings.values()].map((row) => ({
              ...row,
              total: row.sky + row.notSky,
            })).sort((a, b) => b.total - a.total),
          },
          calibrations: describedCalibrations,
          usableCalibration,
          usablePilotCalibration,
          canClassify: blockers.length === 0,
          canRunFullClassification: blockers.length === 0 &&
            Boolean(usableFullCalibration),
          blockers,
          latestJob: latestJobs[0] ?? null,
          latestCampaign: latestCampaigns[0] ?? null,
        };
      }
      case "identity-classification": {
        const profileObjectId = new ObjectId(input.profileId);
        const [profile, calibrations] = await Promise.all([
          mongo({
            action: "findOne",
            collection: "speaker_profiles",
            query: { _id: profileObjectId },
            options: { projection: { revision: 1, embeddingSpaceId: 1 } },
          }),
          mongo({
            action: "find",
            collection: "speaker_calibrations",
            query: { profileId: input.profileId },
            options: { sort: { createdAt: -1 }, limit: 20 },
          }),
        ]) as [any, any[]];
        const profileRevision = Number(profile?.revision ?? 1);
        const embeddingSpaceId = profile?.embeddingSpaceId ?? null;
        const calibrationContext = {
          profileId: input.profileId,
          profileRevision,
          embeddingSpaceId,
        };
        const usableCalibration = profile
          ? findUsableCalibration(calibrations, {
            ...calibrationContext,
          })
          : null;
        const usablePolicy = usableCalibration
          ? normalizeCalibrationPolicy(usableCalibration)
          : null;
        const usableFullCalibration = profile
          ? findUsableFullCalibration(calibrations, calibrationContext)
          : null;
        const usablePilotCalibration = usablePolicy?.classificationPolicy ===
            "pilot"
          ? usableCalibration
          : null;
        const rawIdentityCounts = await mongo({
          action: "aggregate",
          collection: "diarizations",
          pipeline: [
            { $match: { lifecycleStatus: "active" } },
            {
              $group: {
                _id: "$speakerIdentity.identityState",
                count: { $sum: 1 },
              },
            },
          ],
          options: {
            maxTimeMS: 10_000,
            hint: "pipeline_speaker_identity_state",
          },
        }) as any[];
        const raw = Object.fromEntries(
          rawIdentityCounts.map((row) => [
            row._id ?? "unclassified",
            row.count,
          ]),
        );
        const verifiedCounts = usableFullCalibration
          ? await mongo({
            action: "aggregate",
            collection: "diarizations",
            pipeline: [
              {
                $match: {
                  lifecycleStatus: "active",
                  "speakerIdentity.calibrationId":
                    usableFullCalibration.calibrationId,
                  "speakerIdentity.profileRevision": profileRevision,
                  "speakerIdentity.embeddingSpaceId": embeddingSpaceId,
                  "speakerIdentity.source": "automatic",
                  "speakerIdentity.validity": "verified",
                },
              },
              {
                $group: {
                  _id: "$speakerIdentity.identityState",
                  count: { $sum: 1 },
                },
              },
            ],
            options: {
              maxTimeMS: 10_000,
              hint: SPEAKER_IDENTITY_SNAPSHOT_INDEX,
            },
          }) as any[]
          : [];
        const provisionalCounts = usablePilotCalibration
          ? await mongo({
            action: "aggregate",
            collection: "diarizations",
            pipeline: [
              {
                $match: {
                  lifecycleStatus: "active",
                  "speakerIdentity.calibrationId":
                    usablePilotCalibration.calibrationId,
                  "speakerIdentity.profileRevision": profileRevision,
                  "speakerIdentity.embeddingSpaceId": embeddingSpaceId,
                  "speakerIdentity.source": "automatic",
                  "speakerIdentity.validity": "provisional",
                },
              },
              {
                $group: {
                  _id: "$speakerIdentity.identityState",
                  count: { $sum: 1 },
                },
              },
            ],
            options: {
              maxTimeMS: 10_000,
              hint: SPEAKER_IDENTITY_SNAPSHOT_INDEX,
            },
          }) as any[]
          : [];
        const verified = Object.fromEntries(
          verifiedCounts.map((row) => [row._id, row.count]),
        );
        const provisional = Object.fromEntries(
          provisionalCounts.map((row) => [row._id, row.count]),
        );
        const rawClassified = Number(raw.identified ?? 0) +
          Number(raw.unknown ?? 0) + Number(raw.uncertain ?? 0);
        const verifiedTotal = Number(verified.identified ?? 0) +
          Number(verified.unknown ?? 0) + Number(verified.uncertain ?? 0);
        const provisionalTotal = Number(provisional.identified ?? 0) +
          Number(provisional.unknown ?? 0) +
          Number(provisional.uncertain ?? 0);
        return {
          asOf: new Date(),
          classification: {
            identified: verified.identified ?? 0,
            unknown: verified.unknown ?? 0,
            uncertain: verified.uncertain ?? 0,
            provisional: {
              identified: provisional.identified ?? 0,
              unknown: provisional.unknown ?? 0,
              uncertain: provisional.uncertain ?? 0,
            },
            stale: Math.max(
              0,
              rawClassified - verifiedTotal - provisionalTotal,
            ),
            unclassified: raw.unclassified ?? 0,
          },
          calibrationId: usableCalibration?.calibrationId ?? null,
          classificationPolicy: usablePolicy?.classificationPolicy ?? null,
          maxRangeHours: usablePolicy?.maxRangeHours ?? null,
          canRunFullClassification: Boolean(usableFullCalibration),
        };
      }
      case "list-identity-campaigns": {
        const query: Record<string, unknown> = {};
        if (input.profileId) query.profileId = input.profileId;
        if (input.runId) query.runId = input.runId;
        return await mongo({
          action: "find",
          collection: "speaker_identity_campaigns",
          query,
          options: { sort: { updatedAt: -1 }, limit: input.limit },
        });
      }
      case "save-calibration": {
        const calibrationIds = new Set(input.calibrationRecordingIds);
        if (input.validationRecordingIds.some((id) => calibrationIds.has(id))) {
          throw new Error(
            "Calibration and validation must use different recordings",
          );
        }
        const preview = await computeCalibrationPreview(
          mongo,
          input.profileId,
          input.calibrationRecordingIds,
          input.validationRecordingIds,
          input.targetPrecision,
          input.positiveThresholdOverride,
        );
        if (!preview.thresholds) {
          throw new Error(
            "Calibration data does not produce a safe auto-Sky threshold",
          );
        }
        if (!preview.canValidate) {
          throw new Error(
            `Calibration is blocked: ${preview.blockers.join("; ")}`,
          );
        }
        if (preview.profile.embeddingSpaceId === "legacy-unknown") {
          throw new Error(
            "Legacy embeddings require an explicit compatibility validation before calibration",
          );
        }
        const now = new Date();
        const classificationPolicy = preview.targetPrecision <
            SPEAKER_CALIBRATION_TARGET_PRECISION
          ? "pilot"
          : "full";
        const calibrationId =
          `voice-r${preview.profile.revision}-${Date.now()}-${
            crypto.randomUUID().slice(0, 8)
          }`;
        const record = {
          calibrationId,
          profileId: input.profileId,
          profileRevision: preview.profile.revision,
          embeddingSpaceId: preview.profile.embeddingSpaceId,
          positiveThreshold: preview.thresholds.positiveThreshold,
          recommendedPositiveThreshold: preview.recommendedPositiveThreshold,
          positiveThresholdSource: preview.positiveThresholdSource,
          negativeThreshold: preview.thresholds.negativeThreshold,
          negativeDecisionMode: preview.thresholds.negativeDecisionMode,
          metrics: {
            precision: preview.validationMetrics.positivePrecision,
            recall: preview.validationMetrics.positiveRecall,
            sky: preview.counts.positive,
            notSky: preview.counts.negative,
            borderline: preview.calibrationMetrics.uncertain +
              preview.validationMetrics.uncertain,
          },
          calibrationMetrics: preview.calibrationMetrics,
          validationMetrics: preview.validationMetrics,
          targetPrecision: preview.targetPrecision,
          classificationPolicy,
          operatorAcceptedLowerPrecision: classificationPolicy === "pilot" &&
            input.acceptLowerPrecisionRisk === true,
          maxRangeHours: classificationPolicy === "pilot"
            ? SPEAKER_CALIBRATION_PILOT_MAX_RANGE_HOURS
            : null,
          serverComputed: true,
          contractVersion: SPEAKER_CALIBRATION_CONTRACT_VERSION,
          computedBy: SPEAKER_CALIBRATION_COMPUTED_BY,
          computedAt: now,
          calibrationAlgorithmVersion: "cosine-thresholds-v2",
          matcherVersion: "profile-candidates-v2",
          calibrationRecordingIds: input.calibrationRecordingIds,
          validationRecordingIds: input.validationRecordingIds,
          allowLegacyCompatibility: false,
          status: "validated",
          evidence: {
            compatibleLabels: preview.counts.total,
            positiveLabels: preview.counts.positive,
            negativeLabels: preview.counts.negative,
            recordings: preview.counts.recordings,
          },
          createdAt: now,
          updatedAt: now,
        };
        await mongo({
          action: "insertOne",
          collection: "speaker_calibrations",
          doc: record,
        });
        return record;
      }
      case "list-runs": {
        const [runs, campaigns] = await Promise.all([
          mongo({
            action: "find",
            collection: "diarization_runs",
            query: {},
            options: { sort: { createdAt: -1 } },
          }),
          mongo({
            action: "find",
            collection: "diarization_campaigns",
            query: {},
            options: { sort: { updatedAt: -1 }, limit: 100 },
          }),
        ]) as [any[], any[]];
        return runs.map((run) => ({
          ...run,
          status: getObservedRunStatus(run, campaigns),
          campaign: campaigns.find((campaign) => campaign.runId === run.runId),
        }));
      }
      case "list-campaigns":
        return await mongo({
          action: "find",
          collection: "diarization_campaigns",
          query: input.runId ? { runId: input.runId } : {},
          options: { sort: { updatedAt: -1 }, limit: input.limit },
        });
      case "create-run": {
        const existing = await mongo({
          action: "findOne",
          collection: "diarization_runs",
          query: { runId: input.runId },
        });
        if (existing) return existing;
        const doc = {
          ...input,
          action: undefined,
          status: "building",
          range: { start: input.start, end: input.end },
          errors: [],
          createdAt: new Date(),
        };
        const { action: _action, start: _start, end: _end, ...stored } = doc;
        await mongo({
          action: "insertOne",
          collection: "diarization_runs",
          doc: stored,
        });
        return stored;
      }
      case "mark-run-ready": {
        const result = await mongo({
          action: "updateOne",
          collection: "diarization_runs",
          query: { runId: input.runId, status: "building" },
          update: {
            $set: {
              status: "ready",
              coverage: input.coverage,
              errors: input.errors,
              readyAt: new Date(),
            },
          },
        });
        if ((result as any).matchedCount !== 1) {
          throw new Error("Only a building run can become ready");
        }
        return result;
      }
      case "compare-run": {
        const run = await mongo({
          action: "findOne",
          collection: "diarization_runs",
          query: { runId: input.runId },
        }) as any;
        if (!run) throw new Error("Run not found");
        const [stats] = await mongo({
          action: "aggregate",
          collection: "diarizations",
          pipeline: [
            { $match: { runId: input.runId } },
            {
              $group: {
                _id: "$speakerIdentity.state",
                segments: { $sum: 1 },
                durationMs: { $sum: { $subtract: ["$end", "$start"] } },
              },
            },
          ],
        }) as any[];
        const distribution = await mongo({
          action: "aggregate",
          collection: "diarizations",
          pipeline: [{ $match: { runId: input.runId } }, {
            $group: { _id: "$speakerIdentity.state", count: { $sum: 1 } },
          }],
        });
        return {
          run,
          stats: stats ?? null,
          identityDistribution: distribution,
        };
      }
      case "mark-run-failed": {
        const result = await mongo({
          action: "updateOne",
          collection: "diarization_runs",
          query: { runId: input.runId, status: "building" },
          update: {
            $set: {
              status: "failed",
              failedAt: new Date(),
              failureReason: "Marked failed by operator after interruption",
            },
          },
        });
        if ((result as any).matchedCount !== 1) {
          throw new Error(
            "Only a building/interrupted run can be marked failed",
          );
        }
        return { success: true, runId: input.runId };
      }
      case "activate-run": {
        const run = await mongo({
          action: "findOne",
          collection: "diarization_runs",
          query: { runId: input.runId },
        }) as any;
        if (
          !run || !["ready", "active", "superseded"].includes(run.status) ||
          run.purgedAt
        ) {
          throw new Error(
            "Only a ready or retained superseded run can be activated",
          );
        }
        const windowStart = new Date(run.range.start);
        const windowEnd = new Date(run.range.end);
        // Superseded runs are discovered from the segments they actually own.
        // A run document's recorded range goes stale — legacy-v0 keeps
        // accumulating segments long after migration 0035 wrote its range — so
        // an overlap test against that field leaves live coverage active.
        const supersededRunIds = ((await mongo({
          action: "aggregate",
          collection: "diarizations",
          pipeline: [
            {
              $match: {
                lifecycleStatus: "active",
                runId: { $ne: input.runId },
                start: { $lt: windowEnd },
                end: { $gt: windowStart },
              },
            },
            { $group: { _id: "$runId" } },
          ],
        })) as Array<{ _id?: string }>)
          .map((row) => row._id)
          .filter((runId): runId is string => Boolean(runId));

        // Supersede before activating. Without a transaction one of the two
        // states is visible mid-flight: a brief gap renders as missing
        // coverage, whereas a brief overlap reports two generations as active
        // for the same instant and doubles every downstream count.
        if (supersededRunIds.length > 0) {
          await mongo({
            action: "updateMany",
            collection: "diarizations",
            query: {
              runId: { $in: supersededRunIds },
              lifecycleStatus: "active",
              start: { $lt: windowEnd },
              end: { $gt: windowStart },
            },
            update: { $set: { lifecycleStatus: "superseded" } },
          });
        }

        const [activation] = buildActivationUpdates(input.runId);
        await mongo({
          action: "updateMany",
          collection: "diarizations",
          query: { runId: activation.runId },
          update: { $set: { lifecycleStatus: "active" } },
        });
        await mongo({
          action: "updateOne",
          collection: "diarization_runs",
          query: { runId: activation.runId },
          update: { $set: { status: "active", activatedAt: new Date() } },
        });
        for (const oldRunId of supersededRunIds) {
          // Whether the old generation is finished is answered by what is left
          // of it, not by comparing two recorded ranges.
          const remainingActive = await mongo({
            action: "count",
            collection: "diarizations",
            query: { runId: oldRunId, lifecycleStatus: "active" },
          }) as number;
          const fullyReplaced = remainingActive === 0;
          await mongo({
            action: "updateOne",
            collection: "diarization_runs",
            query: { runId: oldRunId },
            update: fullyReplaced
              ? {
                $set: {
                  status: "superseded",
                  supersededAt: new Date(),
                  supersededBy: input.runId,
                },
              }
              : {
                $push: {
                  partialSupersessions: {
                    runId: input.runId,
                    start: run.range.start,
                    end: run.range.end,
                    activatedAt: new Date(),
                  },
                },
              },
          });
        }
        return { success: true, runId: input.runId };
      }
      case "preview-purge": {
        const run = await mongo({
          action: "findOne",
          collection: "diarization_runs",
          query: { runId: input.runId },
        }) as any;
        if (!run) throw new Error("Run not found");
        assertPurgeAllowed(run);
        const [documents, embeddings] = await Promise.all([
          mongo({
            action: "count",
            collection: "diarizations",
            query: { runId: input.runId },
          }),
          mongo({
            action: "count",
            collection: "diarizations",
            query: { runId: input.runId, embedding: { $exists: true } },
          }),
        ]);
        return {
          runId: input.runId,
          documents,
          embeddings,
          confirmation: `PURGE ${input.runId}`,
        };
      }
      case "purge-superseded": {
        const run = await mongo({
          action: "findOne",
          collection: "diarization_runs",
          query: { runId: input.runId },
        }) as any;
        if (!run) throw new Error("Run not found");
        assertPurgeAllowed(run);
        if (input.confirmation !== `PURGE ${input.runId}`) {
          throw new Error("Confirmation does not match purge preview");
        }
        const deleted = await mongo({
          action: "deleteMany",
          collection: "diarizations",
          query: { runId: input.runId, lifecycleStatus: { $ne: "active" } },
        });
        await mongo({
          action: "updateOne",
          collection: "diarization_runs",
          query: { runId: input.runId },
          update: {
            $set: {
              purgedAt: new Date(),
              purgedDocuments: (deleted as any).deletedCount ?? 0,
            },
          },
        });
        return deleted;
      }
    }
  }
}
