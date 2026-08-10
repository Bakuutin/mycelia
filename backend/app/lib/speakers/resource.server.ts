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
import { groupReviewSegments } from "./review-sessions.ts";
import {
  chooseCalibrationThresholds,
  cosineSimilarity,
  evaluateCalibration,
  splitCalibrationRecordings,
} from "./calibration.ts";

const objectId = z.string().refine(ObjectId.isValid, "Invalid ObjectId");
const range = { start: zDateOrString(), end: zDateOrString() };

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
  z.object({ action: z.literal("delete-annotation"), id: objectId }),
  z.object({
    action: z.literal("create-review-session"),
    name: z.string().max(120).optional(),
    targetProfileIds: z.array(objectId).min(1),
    embeddingSpaceIds: z.array(z.string().min(1)).default([]),
    runIds: z.array(z.string().min(1)).default([]),
    rangeMode: z.enum(["fixed", "all_before"]).default("fixed"),
    start: zDateOrString().optional(),
    end: zDateOrString().optional(),
    limit: z.number().int().min(1).max(100).default(100),
    preferences: z.object({
      autoPlay: z.boolean().default(true),
      groupMode: z.boolean().default(true),
      compactMode: z.boolean().default(true),
    }).default({ autoPlay: true, groupMode: true, compactMode: true }),
  }).refine(
    (value) => value.rangeMode === "all_before" || Boolean(value.start && value.end),
    "A fixed review session requires start and end",
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
    (value) => Boolean(value.profileId) !== (value.excludedProfileIds.length > 0),
    "Choose a profile or excluded profiles",
  ),
  z.object({
    action: z.literal("undo-review-decision"),
    decisionId: objectId,
  }),
  z.object({
    action: z.literal("complete-review-session"),
    sessionId: objectId,
  }),
  z.object({
    action: z.literal("review-queue"),
    ...range,
    state: z.enum(["matched", "rejected", "uncertain", "reviewable"]).default("reviewable"),
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
    targetPrecision: z.number().min(0.5).max(1).default(0.98),
  }),
  z.object({
    action: z.literal("identity-status"),
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
    calibrationId: z.string().min(1),
    profileId: objectId,
    profileRevision: z.number().int().positive(),
    embeddingSpaceId: z.string().min(1),
    positiveThreshold: z.number().min(-1).max(1),
    negativeThreshold: z.number().min(-1).max(1),
    metrics: z.object({
      precision: z.number().min(0).max(1),
      recall: z.number().min(0).max(1).optional(),
      sky: z.number().int().min(0),
      notSky: z.number().int().min(0),
      borderline: z.number().int().min(0).default(0),
    }),
    calibrationRecordingIds: z.array(z.string()).min(1),
    validationRecordingIds: z.array(z.string()).min(1),
    status: z.enum(["draft", "validated"]),
    allowLegacyCompatibility: z.boolean().default(false),
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

async function findReviewCandidates(
  mongo: any,
  start: Date,
  end: Date,
  limit: number,
  cursor?: { start: Date | string; segmentId: string } | null,
): Promise<any[]> {
  const identityFilter = {
    $or: [
      { "speakerIdentity.state": "uncertain" },
      { speakerIdentity: { $exists: false } },
      { "speakerIdentity.identityState": { $exists: false } },
    ],
  };
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
  const candidates = await mongo({
    action: "find",
    collection: "diarizations",
    query: {
      lifecycleStatus: "active",
      start: { $lt: end },
      end: { $gt: start },
      $and: cursorFilter ? [identityFilter, cursorFilter] : [identityFilter],
    },
    options: {
      sort: { start: 1, _id: 1 },
      limit: Math.min(Math.max(limit * 10, limit), 5_000),
      projection: { embedding: 0 },
    },
  }) as any[];
  const candidateIds = candidates.map((segment) => segment._id);
  if (candidateIds.length === 0) return [];
  const annotations = await mongo({
    action: "find",
    collection: "speaker_annotations",
    query: { segmentId: { $in: candidateIds } },
    options: { projection: { segmentId: 1 }, limit: candidateIds.length },
  }) as any[];
  const annotated = new Set(annotations.map((item) => String(item.segmentId)));
  return candidates.filter((segment) => !annotated.has(String(segment._id)));
}

async function hydrateReviewSession(
  mongo: any,
  session: any,
): Promise<any> {
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
  const byId = new Map(segments.map((segment) => [String(segment._id), segment]));
  return {
    ...session,
    segments: window.map((item: any) => byId.get(String(item.segmentId)))
      .filter(Boolean),
  };
}

function nextPendingSegmentId(window: any[], afterSegmentId?: string): string | null {
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
        segmentId: 1,
        originalId: 1,
        profileId: 1,
        excludedProfileIds: 1,
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
        start: 1,
        end: 1,
      },
      limit: segmentIds.length,
    },
  }) as any[];
  const segmentById = new Map(segments.map((segment) => [String(segment._id), segment]));
  const examples: Array<{
    segmentId: string;
    recordingId: string;
    label: "positive" | "negative";
    score: number;
    start: Date;
    end: Date;
  }> = [];
  let incompatible = 0;
  for (const [segmentId, annotation] of latestBySegment) {
    const segment = segmentById.get(segmentId);
    if (!segment?.embedding || segment.embeddingSpaceId !== profile.embeddingSpaceId) {
      incompatible += 1;
      continue;
    }
    const isPositive = String(annotation.profileId ?? "") === profileId;
    const isNegative = (annotation.excludedProfileIds ?? []).some((id: unknown) =>
      String(id) === profileId
    );
    if (!isPositive && !isNegative) continue;
    examples.push({
      segmentId,
      recordingId: String(annotation.originalId ?? segment.original_id ?? segment.original),
      label: isPositive ? "positive" : "negative",
      score: cosineSimilarity(profile.embedding, segment.embedding),
      start: new Date(segment.start),
      end: new Date(segment.end),
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
  const split = automaticSplit
    ? splitCalibrationRecordings(recordings)
    : {
      calibrationRecordingIds: requestedCalibrationIds,
      validationRecordingIds: requestedValidationIds,
    };
  const calibrationSet = new Set(split.calibrationRecordingIds);
  const validationSet = new Set(split.validationRecordingIds);
  const overlap = split.validationRecordingIds.filter((id: string) => calibrationSet.has(id));
  const calibrationExamples = examples.filter((item) => calibrationSet.has(item.recordingId));
  const validationExamples = examples.filter((item) => validationSet.has(item.recordingId));
  const thresholds = chooseCalibrationThresholds(calibrationExamples, targetPrecision);
  const calibrationMetrics = thresholds
    ? evaluateCalibration(
      calibrationExamples,
      thresholds.positiveThreshold,
      thresholds.negativeThreshold,
    )
    : null;
  const validationMetrics = thresholds
    ? evaluateCalibration(
      validationExamples,
      thresholds.positiveThreshold,
      thresholds.negativeThreshold,
    )
    : null;
  const positive = examples.filter((item) => item.label === "positive").length;
  const negative = examples.length - positive;
  const blockers: string[] = [];
  if (positive < 40) blockers.push(`${40 - positive} more compatible target labels needed`);
  if (negative < 40) blockers.push(`${40 - negative} more compatible not-target labels needed`);
  if (examples.length < 100) blockers.push(`${100 - examples.length} more compatible labels needed in total`);
  if (recordings.length < 2) blockers.push("Label at least two different source recordings");
  if (overlap.length > 0) blockers.push("Calibration and validation recordings overlap");
  if (calibrationExamples.every((item) => item.label !== "positive") ||
    calibrationExamples.every((item) => item.label !== "negative")) {
    blockers.push("Calibration set needs both target and not-target examples");
  }
  if (validationExamples.every((item) => item.label !== "positive") ||
    validationExamples.every((item) => item.label !== "negative")) {
    blockers.push("Validation set needs both target and not-target examples");
  }
  if (!thresholds) blockers.push("No threshold pair reaches the target precision on calibration audio");
  if (thresholds && (!validationMetrics || validationMetrics.identified === 0 ||
    validationMetrics.positivePrecision < targetPrecision)) {
    blockers.push(`Validation auto-match precision is below ${Math.round(targetPrecision * 100)}%`);
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
    calibrationMetrics,
    validationMetrics,
    scoreDistribution: {
      calibrationPositive: calibrationExamples.filter((item) => item.label === "positive").map((item) => item.score),
      calibrationNegative: calibrationExamples.filter((item) => item.label === "negative").map((item) => item.score),
      validationPositive: validationExamples.filter((item) => item.label === "positive").map((item) => item.score),
      validationNegative: validationExamples.filter((item) => item.label === "negative").map((item) => item.score),
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
      case "coverage": {
        const [rows, buildingRuns] = await Promise.all([
          mongo({
            action: "aggregate",
            collection: "audio_chunks",
            pipeline: [
              {
                $match: {
                  "vad.has_speech": true,
                  start: { $gte: input.start, $lt: input.end },
                },
              },
              {
                $project: {
                  bucket: {
                    $multiply: [{
                      $floor: {
                        $divide: [{ $toLong: "$start" }, input.bucketMs],
                      },
                    }, input.bucketMs],
                  },
                  state: {
                    $switch: {
                      branches: [
                        {
                          case: {
                            $eq: [
                              "$diarizationFailure.status",
                              "needs_attention",
                            ],
                          },
                          then: "needs_attention",
                        },
                        {
                          case: {
                            $ne: [{ $ifNull: ["$processing_by", null] }, null],
                          },
                          then: "processing",
                        },
                        {
                          case: {
                            $ne: [{ $ifNull: ["$diarized_at", null] }, null],
                          },
                          then: "diarized",
                        },
                      ],
                      default: "pending",
                    },
                  },
                },
              },
              {
                $group: {
                  _id: { bucket: "$bucket", state: "$state" },
                  count: { $sum: 1 },
                },
              },
              { $sort: { "_id.bucket": 1 } },
            ],
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
          },
        }) as any[];
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
        const candidatePool = await findReviewCandidates(
          mongo,
          snapshotStart,
          snapshotEnd,
          Math.max(input.limit, 500),
        );
        const candidates = candidatePool.slice(0, input.limit);
        const lastCandidate = candidates.at(-1);
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
          name: input.name ?? `Review ${snapshotEnd.toISOString().slice(0, 10)}`,
          status: "active",
          targetProfileIds: input.targetProfileIds.map((id) => new ObjectId(id)),
          embeddingSpaceIds: input.embeddingSpaceIds,
          runIds: input.runIds,
          querySnapshot: {
            identityState: "reviewable",
            rangeMode: input.rangeMode,
            start: snapshotStart,
            end: snapshotEnd,
            snapshotEnd,
            sort: { start: 1, _id: 1 },
          },
          window: candidates.map((segment) => ({
            segmentId: segment._id,
            groupId: groupBySegment.get(String(segment._id)),
            status: "pending",
          })),
          groups,
          windowNumber: 1,
          windowSize: input.limit,
          loadedCount: candidates.length,
          sessionLoadedCount: candidates.length,
          reviewedCount: 0,
          skippedCount: 0,
          windowReviewedCount: 0,
          windowSkippedCount: 0,
          backlogEstimate: candidatePool.length,
          backlogEstimateCapped: candidatePool.length >= 5_000,
          hasMore: candidatePool.length > candidates.length,
          nextCursor: lastCandidate
            ? { start: lastCandidate.start, segmentId: String(lastCandidate._id) }
            : null,
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
        return { ...doc, segments: candidates };
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
            projection: { window: 0, groups: 0 },
          },
        });
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
          throw new Error("Review session changed elsewhere; reload to continue");
        }
        if ((session.window ?? []).some((item: any) => item.status === "pending")) {
          throw new Error("Review or skip every item in this window first");
        }
        const snapshot = session.querySnapshot;
        const candidatePool = await findReviewCandidates(
          mongo,
          new Date(snapshot.start),
          new Date(snapshot.snapshotEnd ?? snapshot.end),
          Math.max(Number(session.windowSize ?? 100), 500),
          session.nextCursor,
        );
        const candidates = candidatePool.slice(0, Number(session.windowSize ?? 100));
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
        }));
        const lastCandidate = candidates.at(-1);
        const completed = candidates.length === 0;
        const result = await mongo({
          action: "updateOne",
          collection: "speaker_review_sessions",
          query: { _id: sessionId, revision: input.revision },
          update: {
            $set: {
              window,
              groups,
              activeSegmentId: candidates[0]?._id ?? null,
              loadedCount: candidates.length,
              sessionLoadedCount: Number(session.sessionLoadedCount ?? session.loadedCount ?? 0) +
                candidates.length,
              windowReviewedCount: 0,
              windowSkippedCount: 0,
              hasMore: candidatePool.length > candidates.length,
              nextCursor: lastCandidate
                ? { start: lastCandidate.start, segmentId: String(lastCandidate._id) }
                : session.nextCursor,
              status: completed ? "completed" : "active",
              ...(completed ? { completedAt: new Date() } : {}),
              updatedAt: new Date(),
              lastOpenedAt: new Date(),
            },
            $inc: { revision: 1, windowNumber: 1 },
          },
        }) as any;
        if (result.matchedCount !== 1) {
          throw new Error("Review session changed elsewhere; reload to continue");
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
          throw new Error("Review session changed elsewhere; reload to continue");
        }
        const window = [...(session.window ?? [])];
        let skippedDelta = 0;
        if (input.skipSegmentId) {
          const item = window.find((entry: any) =>
            String(entry.segmentId) === input.skipSegmentId
          );
          if (!item) throw new Error("Skipped segment is not in this review window");
          if (item.status === "reviewed") {
            throw new Error("Undo the saved decision before skipping this segment");
          }
          if (item.status !== "skipped") skippedDelta = 1;
          item.status = "skipped";
        }
        const validActive = input.activeSegmentId == null || window.some(
          (item: any) => String(item.segmentId) === input.activeSegmentId,
        );
        if (!validActive) throw new Error("Active segment is not in this review window");
        const preferences = {
          ...(session.preferences ?? {}),
          ...(input.preferences ?? {}),
        };
        const windowSkippedCount = window.filter((item: any) =>
          item.status === "skipped"
        ).length;
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
          throw new Error("Review session changed elsewhere; reload to continue");
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
          throw new Error("Review session changed elsewhere; reload to continue");
        }
        const segmentIds = [...new Set(input.segmentIds)];
        const allowed = new Set(
          (session.window ?? []).map((item: any) => String(item.segmentId)),
        );
        if (segmentIds.some((id) => !allowed.has(id))) {
          throw new Error("Every selected segment must belong to this review window");
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
              originalGroups: session.groups,
              profileId: input.profileId ? new ObjectId(input.profileId) : null,
              excludedProfileIds: input.excludedProfileIds.map((id) => new ObjectId(id)),
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
                profileId: input.profileId ? new ObjectId(input.profileId) : null,
                excludedProfileIds: input.excludedProfileIds.map((id) => new ObjectId(id)),
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
        const reviewedDelta = selectedItems.filter((item: any) =>
          item.status !== "reviewed"
        ).length;
        const skippedToReviewed = selectedItems.filter((item: any) =>
          item.status === "skipped"
        ).length;
        const window = (session.window ?? []).map((item: any) =>
          selected.has(String(item.segmentId))
            ? { ...item, status: "reviewed", decisionId }
            : item
        );
        const windowReviewedCount = window.filter((item: any) =>
          item.status === "reviewed"
        ).length;
        const windowSkippedCount = window.filter((item: any) =>
          item.status === "skipped"
        ).length;
        const reviewedCount = Number(session.reviewedCount ?? 0) + reviewedDelta;
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
              activeSegmentId: activeSegmentId ? new ObjectId(activeSegmentId) : null,
              updatedAt: new Date(),
              lastOpenedAt: new Date(),
            },
            $inc: { revision: 1 },
          },
        }) as any;
        if (updated.matchedCount !== 1) {
          throw new Error("Decision was saved; reload the session to refresh its position");
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
      case "undo-review-decision": {
        const decisionId = new ObjectId(input.decisionId);
        const decision = await mongo({
          action: "findOne",
          collection: "speaker_review_decisions",
          query: { _id: decisionId, author: auth.principal, status: "committed" },
        }) as any;
        if (!decision) throw new Error("Committed review decision not found");
        const session = await mongo({
          action: "findOne",
          collection: "speaker_review_sessions",
          query: { _id: decision.sessionId, owner: auth.principal },
        }) as any;
        if (!session) throw new Error("Review session not found");
        await mongo({
          action: "deleteMany",
          collection: "speaker_annotations",
          query: { decisionId },
        });
        await mongo({
          action: "updateOne",
          collection: "speaker_review_decisions",
          query: { _id: decisionId, status: "committed" },
          update: { $set: { status: "rolled_back", rolledBackAt: new Date(), updatedAt: new Date() } },
        });
        const restored = new Set((decision.segmentIds ?? []).map(String));
        const window = (session.window ?? []).map((item: any) =>
          restored.has(String(item.segmentId)) && String(item.decisionId) === input.decisionId
            ? { ...item, status: "pending", decisionId: null }
            : item
        );
        const firstRestored = (decision.segmentIds ?? [])[0] ?? null;
        const windowReviewedCount = window.filter((item: any) =>
          item.status === "reviewed"
        ).length;
        await mongo({
          action: "updateOne",
          collection: "speaker_review_sessions",
          query: { _id: session._id },
          update: {
            $set: {
              window,
              reviewedCount: Math.max(
                0,
                Number(session.reviewedCount ?? 0) -
                  Number((decision.segmentIds ?? []).length),
              ),
              windowReviewedCount,
              activeSegmentId: firstRestored,
              updatedAt: new Date(),
              lastOpenedAt: new Date(),
            },
            $inc: { revision: 1 },
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
            $set: { status: "completed", completedAt: new Date(), updatedAt: new Date() },
            $inc: { revision: 1 },
          },
        }) as any;
        if (result.matchedCount !== 1) throw new Error("Active review session not found");
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
        const annotated = new Set(annotations.map((item) => String(item.segmentId)));
        return candidates.filter((segment) => !annotated.has(String(segment._id)))
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
        );
      case "identity-status": {
        const profileId = new ObjectId(input.profileId);
        const [
          annotations,
          calibrations,
          identityCounts,
          latestJobs,
          latestCampaigns,
        ] = await Promise.all([
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
                originalId: 1,
                profileId: 1,
                excludedProfileIds: 1,
              },
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
            options: { maxTimeMS: 10_000 },
          }),
          mongo({
            action: "find",
            collection: "jobs",
            query: { type: "speakerIdentity" },
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
        ]) as [any[], any[], any[], any[], any[]];
        const recordings = new Map<string, { id: string; sky: number; notSky: number }>();
        let sky = 0;
        let notSky = 0;
        for (const annotation of annotations) {
          const recordingId = annotation.originalId ? String(annotation.originalId) : null;
          const isSky = String(annotation.profileId ?? "") === input.profileId;
          const isNotSky = (annotation.excludedProfileIds ?? []).some(
            (id: unknown) => String(id) === input.profileId
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
        const classified = Object.fromEntries(
          identityCounts.map((row) => [row._id ?? "unclassified", row.count]),
        );
        return {
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
          calibrations,
          classification: {
            identified: classified.identified ?? 0,
            unknown: classified.unknown ?? 0,
            uncertain: classified.uncertain ?? 0,
            unclassified: classified.unclassified ?? 0,
          },
          latestJob: latestJobs[0] ?? null,
          latestCampaign: latestCampaigns[0] ?? null,
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
          0.98,
        );
        if (preview.profile.revision !== input.profileRevision ||
          preview.profile.embeddingSpaceId !== input.embeddingSpaceId) {
          throw new Error("Profile revision changed; refresh the calibration preview");
        }
        if (!preview.thresholds) {
          throw new Error("Calibration data does not produce a safe threshold pair");
        }
        if (input.status === "validated") {
          if (!preview.canValidate) {
            throw new Error(`Calibration is blocked: ${preview.blockers.join("; ")}`);
          }
        }
        const now = new Date();
        const { action: _action, metrics: _clientMetrics, ...inputRecord } = input;
        const record = {
          ...inputRecord,
          positiveThreshold: preview.thresholds.positiveThreshold,
          negativeThreshold: preview.thresholds.negativeThreshold,
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
          serverComputed: true,
        };
        await mongo({
          action: "updateOne",
          collection: "speaker_calibrations",
          query: { calibrationId: input.calibrationId },
          update: {
            $set: { ...record, updatedAt: now },
            $setOnInsert: { createdAt: now },
          },
          options: { upsert: true },
        });
        return { ...record, updatedAt: now };
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
        const activeRuns = await mongo({
          action: "find",
          collection: "diarization_runs",
          query: {
            status: "active",
            runId: { $ne: input.runId },
            "range.start": { $lt: run.range.end },
            "range.end": { $gt: run.range.start },
          },
        }) as any[];
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
        for (const oldRun of activeRuns) {
          await mongo({
            action: "updateMany",
            collection: "diarizations",
            query: {
              runId: oldRun.runId,
              start: { $lt: run.range.end },
              end: { $gt: run.range.start },
            },
            update: { $set: { lifecycleStatus: "superseded" } },
          });
          const fullyReplaced =
            new Date(run.range.start) <= new Date(oldRun.range.start) &&
            new Date(run.range.end) >= new Date(oldRun.range.end);
          await mongo({
            action: "updateOne",
            collection: "diarization_runs",
            query: { runId: oldRun.runId },
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
