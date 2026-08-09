import { ObjectId } from "bson";
import { z } from "zod";
import { type Auth } from "@/lib/auth/core.server.ts";
import { type Resource } from "@/lib/auth/resources.ts";
import { getMongoResource } from "@/lib/mongo/core.server.ts";
import { zDateOrString } from "@myceliasdk/zod-json-schema.ts";
import {
  assertPurgeAllowed,
  buildActivationUpdates,
  projectAnnotationState,
} from "./run-lifecycle.ts";

const objectId = z.string().refine(ObjectId.isValid, "Invalid ObjectId");
const range = { start: zDateOrString(), end: zDateOrString() };

export const speakerSegmentsRequestSchema = z.discriminatedUnion("action", [
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
    action: z.literal("review-queue"),
    ...range,
    state: z.enum(["matched", "rejected", "uncertain"]).default("uncertain"),
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
  z.object({ action: z.literal("activate-run"), runId: z.string().min(1) }),
  z.object({ action: z.literal("preview-purge"), runId: z.string().min(1) }),
  z.object({
    action: z.literal("purge-superseded"),
    runId: z.string().min(1),
    confirmation: z.string(),
  }),
]);

type SpeakerSegmentsRequest = z.input<typeof speakerSegmentsRequestSchema>;

function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return -1;
  let dot = 0;
  let aa = 0;
  let bb = 0;
  for (let index = 0; index < a.length; index++) {
    dot += a[index] * b[index];
    aa += a[index] * a[index];
    bb += b[index] * b[index];
  }
  return aa && bb ? dot / Math.sqrt(aa * bb) : -1;
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
      case "review-queue":
        return await mongo({
          action: "find",
          collection: "diarizations",
          query: {
            lifecycleStatus: "active",
            start: { $lt: input.end },
            end: { $gt: input.start },
            "speakerIdentity.state": input.state,
          },
          options: {
            sort: { "speakerIdentity.primaryScore": 1 },
            limit: input.limit,
          },
        });
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
          score: cosine(source.embedding, segment.embedding),
        })).sort((a, b) => b.score - a.score).slice(0, input.topN);
      }
      case "list-calibrations":
        return await mongo({
          action: "find",
          collection: "speaker_calibrations",
          query: input.profileId ? { profileId: input.profileId } : {},
          options: { sort: { createdAt: -1 } },
        });
      case "save-calibration": {
        if (input.negativeThreshold >= input.positiveThreshold) {
          throw new Error(
            "Negative threshold must be lower than positive threshold",
          );
        }
        const calibrationIds = new Set(input.calibrationRecordingIds);
        if (input.validationRecordingIds.some((id) => calibrationIds.has(id))) {
          throw new Error(
            "Calibration and validation must use different recordings",
          );
        }
        if (input.status === "validated") {
          if (input.metrics.precision < 0.98) {
            throw new Error(
              "Validated auto-Sky precision must be at least 98%",
            );
          }
          if (
            input.metrics.sky < 40 || input.metrics.notSky < 40 ||
            input.metrics.sky + input.metrics.notSky +
                  input.metrics.borderline < 100
          ) {
            throw new Error(
              "Validation requires at least 100 labels including 40 Sky and 40 not-Sky",
            );
          }
        }
        const now = new Date();
        const { action: _action, ...record } = input;
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
      case "list-runs":
        return await mongo({
          action: "find",
          collection: "diarization_runs",
          query: {},
          options: { sort: { createdAt: -1 } },
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
