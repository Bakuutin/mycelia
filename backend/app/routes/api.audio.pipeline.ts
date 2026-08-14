import type { Request, Response } from "express";
import { authenticateOr401 } from "@/lib/auth/core.server.ts";
import { getMongoResource } from "@/lib/mongo/core.server.ts";
import { EJSON } from "bson";
import { ObjectId } from "mongodb";
import { getServerConfig } from "@/lib/config/serverConfig.server.ts";

const PIPELINE_STAGES = [
  { type: "ingestion", label: "Ingestion" },
  { type: "vad", label: "Voice activity" },
  { type: "transcription_sequence_creator", label: "Sequence creation" },
  { type: "transcription", label: "Transcription" },
  { type: "conversation_chunk_creator", label: "Conversation chunks" },
  { type: "conversation_extractor_merged", label: "Conversation extraction" },
  { type: "summarization", label: "Summarization" },
  { type: "diarization", label: "Speaker diarization" },
  { type: "speakerMatching", label: "Legacy speaker matching" },
  { type: "speakerIdentity", label: "Speaker identity" },
  { type: "enrollment", label: "Voice enrollment" },
] as const;

const PIPELINE_STATS_MAX_TIME_MS = 6_000;
const PIPELINE_DETAILS_MAX_TIME_MS = 2_000;
const MAX_AUDIO_CHUNK_SECONDS = 10;

function isMissingIndexHint(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes(
    "hint provided does not correspond to an existing index",
  );
}

async function aggregatePipelineStats(
  mongo: ReturnType<typeof getMongoResource>,
  collection: string,
  pipeline: Record<string, unknown>[],
  hint: string,
  maxTimeMS = PIPELINE_STATS_MAX_TIME_MS,
): Promise<any[]> {
  try {
    return await mongo({
      action: "aggregate",
      collection,
      pipeline,
      options: { hint, maxTimeMS },
    });
  } catch (error) {
    if (!isMissingIndexHint(error)) throw error;

    console.warn(
      `[audio-pipeline] Statistics index ${hint} is unavailable; retrying without a hint`,
    );
    return await mongo({
      action: "aggregate",
      collection,
      pipeline,
      options: { maxTimeMS },
    });
  }
}

function countPipelineStats(
  mongo: ReturnType<typeof getMongoResource>,
  collection: string,
  query: Record<string, unknown>,
): Promise<number> {
  return mongo({
    action: "count" as const,
    collection,
    query,
    options: { maxTimeMS: PIPELINE_STATS_MAX_TIME_MS },
  }) as Promise<number>;
}

async function getDiarizationBacklog(
  mongo: ReturnType<typeof getMongoResource>,
): Promise<number> {
  const request = {
    action: "count" as const,
    collection: "audio_chunks",
    query: {
      "vad.has_speech": true,
      diarized_at: null,
      processing_by: null,
      "diarizationFailure.status": { $ne: "needs_attention" },
      "diarizationFailure.retryAt": { $not: { $gt: new Date() } },
    },
    options: {
      hint: "audio_chunks_diarization_ready_backlog_v1",
      maxTimeMS: PIPELINE_STATS_MAX_TIME_MS,
    },
  };
  try {
    return await mongo(request) as number;
  } catch (error) {
    if (!isMissingIndexHint(error)) throw error;
    return await mongo({
      ...request,
      options: { maxTimeMS: PIPELINE_STATS_MAX_TIME_MS },
    }) as number;
  }
}

interface PipelineSession {
  _id: string;
  start?: Date;
  lastActivityAt?: Date;
  path?: string;
  sourceKind: string;
  ingested: boolean;
  ingestionError?: string;
  client_id?: string;
  device?: string;
  metadata?: {
    format?: string;
    rate?: number;
    width?: number;
    channels?: number;
    source?: string;
    codec?: string;
  };
  processing_status?: string;
  chunks: {
    total: number;
    vadProcessed: number;
    withSpeech: number;
  };
  sequences: Array<{
    _id: string;
    state: string;
    chunk_count: number;
    fromIndex: number;
    toIndex: number;
    updatedAt?: Date;
    error?: string;
  }>;
  transcriptions: number;
  conversationChunks: Array<{
    _id: string;
    state: string;
    mode?: string;
    transcriptionCount: number;
    totalTextLength: number;
    start?: Date;
    end?: Date;
    updatedAt?: Date;
    error?: string;
    emptyReason?: string;
    segmentsFound?: number;
    conversationsCreated?: number;
  }>;
  transcriptionDetails: Array<{
    _id: string;
    start: Date;
    end: Date;
    text: string;
  }>;
  conversations: Array<{
    _id: string;
    name: string;
    icon?: { text?: string };
    timeRanges?: Array<{ start: string; end: string }>;
    createdAt?: Date;
  }>;
}

interface PipelineStats {
  warnings?: string[];
  totalSessions: number;
  totalChunks: number;
  chunksVadProcessed: number;
  chunksAwaitingVad: number;
  vadProcessedLast15Minutes: number;
  vadRatePerMinute: number;
  vadEtaSeconds?: number;
  vadLastProcessedAt?: Date;
  vadJobs: {
    active: number;
    waiting: number;
    delayed: number;
    completed: number;
    failed: number;
    cancelled: number;
    latestFailure?: string;
    latestFailureAt?: Date;
    recentFailures: Array<{
      id: string;
      failedAt?: Date;
      reason?: string;
    }>;
  };
  sequencesReady: number;
  sequencesProcessing: number;
  sequencesError: number;
  transcriptionPendingChunks: number;
  transcriptionPendingMaximumHours: number;
  convChunksReady: number;
  convChunksProcessing: number;
  convChunksError: number;
  totalConversations: number;
  sourceFiles: {
    total: number;
    ingested: number;
    pending: number;
    errors: number;
    byKind: Array<{ kind: string; count: number }>;
  };
  stages: Array<{
    type: string;
    label: string;
    backlog: number;
    errors: number;
    paused: boolean;
    active: number;
    waiting: number;
    delayed: number;
    failed: number;
    latestJob?: {
      id: string;
      state: string;
      updatedAt?: Date;
      failedReason?: string;
    };
  }>;
  recentJobs: Array<{
    id: string;
    type: string;
    state: string;
    createdAt?: Date;
    updatedAt?: Date;
    startedAt?: Date;
    finishedAt?: Date;
    failedReason?: string;
    progress?: Record<string, unknown>;
    result?: Record<string, unknown>;
  }>;
}

function sourceKind(sourceFile: any): string {
  return sourceFile.metadata?.source ?? sourceFile.importer ??
    sourceFile.platform?.importer ?? sourceFile.platform?.system ?? "unknown";
}

function ingestionError(sourceFile: any): string | undefined {
  // Older daemon versions retained the cached error after a successful retry.
  // The completed state is authoritative; do not present stale history as a
  // current pipeline failure.
  if (sourceFile.ingested === true) return undefined;
  const error = sourceFile.ingestion?.error;
  if (!error) return undefined;
  if (typeof error === "string") return error;
  return error.message ?? JSON.stringify(error);
}

type VadPipelineStats = Pick<
  PipelineStats,
  | "totalChunks"
  | "chunksVadProcessed"
  | "chunksAwaitingVad"
  | "vadProcessedLast15Minutes"
  | "vadRatePerMinute"
  | "vadEtaSeconds"
  | "vadLastProcessedAt"
  | "vadJobs"
>;

type VadChunkStats = Pick<
  PipelineStats,
  "totalChunks" | "chunksVadProcessed" | "chunksAwaitingVad"
>;

const VAD_CHUNK_STATS_CACHE_MS = 30_000;
let vadChunkStatsCache:
  | { expiresAt: number; value: VadChunkStats }
  | undefined;
let vadChunkStatsInFlight: Promise<VadChunkStats> | undefined;

async function getVadChunkStats(
  mongo: ReturnType<typeof getMongoResource>,
): Promise<VadChunkStats> {
  if (vadChunkStatsCache && vadChunkStatsCache.expiresAt > Date.now()) {
    return vadChunkStatsCache.value;
  }

  if (!vadChunkStatsInFlight) {
    vadChunkStatsInFlight = (async () => {
      const processedVadPipeline = [
        { $match: { "vad.ran_at": { $lte: new Date() } } },
        { $count: "count" },
      ];
      const loadProcessedVadStats = async () => {
        try {
          return await mongo({
            action: "aggregate",
            collection: "audio_chunks",
            pipeline: processedVadPipeline,
            options: {
              hint: "audio_chunks_vad_processed",
              maxTimeMS: PIPELINE_STATS_MAX_TIME_MS,
            },
          });
        } catch (error) {
          const message = error instanceof Error
            ? error.message
            : String(error);
          if (
            !message.includes(
              "hint provided does not correspond to an existing index",
            )
          ) {
            throw error;
          }

          console.warn(
            "[audio-pipeline] VAD statistics index is unavailable; retrying without a hint",
          );
          return await mongo({
            action: "aggregate",
            collection: "audio_chunks",
            pipeline: processedVadPipeline,
            options: { maxTimeMS: PIPELINE_STATS_MAX_TIME_MS },
          });
        }
      };

      const [totalChunkStats, processedVadStats] = await Promise.all([
        mongo({
          action: "aggregate",
          collection: "audio_chunks",
          pipeline: [
            { $collStats: { count: {} } },
            { $project: { _id: 0, count: "$count" } },
          ],
        }),
        loadProcessedVadStats(),
      ]);

      const totalChunks = totalChunkStats[0]?.count ?? 0;
      const chunksVadProcessed = processedVadStats[0]?.count ?? 0;
      const chunksAwaitingVad = Math.max(totalChunks - chunksVadProcessed, 0);

      const value: VadChunkStats = {
        totalChunks,
        chunksVadProcessed,
        chunksAwaitingVad,
      };

      vadChunkStatsCache = {
        expiresAt: Date.now() + VAD_CHUNK_STATS_CACHE_MS,
        value,
      };
      return value;
    })().finally(() => {
      vadChunkStatsInFlight = undefined;
    });
  }

  return vadChunkStatsInFlight;
}

async function getVadPipelineStats(
  mongo: ReturnType<typeof getMongoResource>,
): Promise<VadPipelineStats> {
  const vadRateWindowMinutes = 15;
  const vadRateWindowStart = new Date(
    Date.now() - vadRateWindowMinutes * 60 * 1000,
  );
  const [chunkStats, vadJobStatsResult, recentFailedVadJobs] = await Promise
    .all([
      getVadChunkStats(mongo),
      mongo({
        action: "aggregate",
        collection: "jobs",
        pipeline: [
          {
            $match: {
              type: "vad",
              dismissedAt: { $exists: false },
            },
          },
          {
            $group: {
              _id: null,
              active: {
                $sum: { $cond: [{ $eq: ["$state", "active"] }, 1, 0] },
              },
              waiting: {
                $sum: { $cond: [{ $eq: ["$state", "waiting"] }, 1, 0] },
              },
              delayed: {
                $sum: { $cond: [{ $eq: ["$state", "delayed"] }, 1, 0] },
              },
              completed: {
                $sum: { $cond: [{ $eq: ["$state", "completed"] }, 1, 0] },
              },
              failed: {
                $sum: { $cond: [{ $eq: ["$state", "failed"] }, 1, 0] },
              },
              cancelled: {
                $sum: { $cond: [{ $eq: ["$state", "cancelled"] }, 1, 0] },
              },
              vadProcessedLast15Minutes: {
                $sum: {
                  $cond: [
                    { $gte: ["$finishedAt", vadRateWindowStart] },
                    { $ifNull: ["$result.processed", 0] },
                    0,
                  ],
                },
              },
              vadLastProcessedAt: { $max: "$finishedAt" },
            },
          },
          { $project: { _id: 0 } },
        ],
      }),
      mongo({
        action: "find",
        collection: "jobs",
        query: {
          type: "vad",
          state: "failed",
          dismissedAt: { $exists: false },
        },
        options: {
          projection: { failedReason: 1, finishedAt: 1, createdAt: 1 },
          sort: { finishedAt: -1, createdAt: -1 },
          limit: 5,
        },
      }),
    ]);

  const vadJobStats = vadJobStatsResult[0] ?? {};
  const vadProcessedLast15Minutes = vadJobStats.vadProcessedLast15Minutes ?? 0;
  const vadRatePerMinute = vadProcessedLast15Minutes / vadRateWindowMinutes;
  const vadEtaSeconds = vadRatePerMinute > 0 && chunkStats.chunksAwaitingVad > 0
    ? Math.ceil(chunkStats.chunksAwaitingVad / vadRatePerMinute * 60)
    : undefined;
  const recentFailures = recentFailedVadJobs.map((job: any) => ({
    id: job._id.toString(),
    failedAt: job.finishedAt ?? job.createdAt,
    reason: job.failedReason,
  }));

  return {
    ...chunkStats,
    vadProcessedLast15Minutes,
    vadRatePerMinute,
    vadEtaSeconds,
    vadLastProcessedAt: vadJobStats.vadLastProcessedAt,
    vadJobs: {
      active: vadJobStats.active ?? 0,
      waiting: vadJobStats.waiting ?? 0,
      delayed: vadJobStats.delayed ?? 0,
      completed: vadJobStats.completed ?? 0,
      failed: vadJobStats.failed ?? 0,
      cancelled: vadJobStats.cancelled ?? 0,
      latestFailure: recentFailures[0]?.reason,
      latestFailureAt: recentFailures[0]?.failedAt,
      recentFailures,
    },
  };
}

export async function apiAudioPipelineHandler(req: Request, res: Response) {
  try {
    const auth = await authenticateOr401(req, res);

    const limit = Math.min(parseInt(req.query.limit as string) || 10, 100);
    const mongo = getMongoResource(auth);
    const warnings: string[] = [];
    const safeStat = async <T>(
      label: string,
      promise: Promise<T>,
      fallback: T,
    ): Promise<T> => {
      try {
        return await promise;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        warnings.push(`${label}: ${message}`);
        console.warn(`[audio-pipeline] ${label} unavailable: ${message}`);
        return fallback;
      }
    };

    // Source activity and recording time are different. Imported recordings can
    // be old while their processing is happening now, so order by the newest
    // known activity timestamp and include every source kind.
    const sourceFiles = await safeStat("recent audio sources", mongo({
      action: "find",
      collection: "source_files",
      query: {},
      options: {
        sort: { updatedAt: -1, start: -1 },
        limit: limit + 1,
        maxTimeMS: PIPELINE_DETAILS_MAX_TIME_MS,
      },
    }) as Promise<any[]>, []);

    const hasMore = sourceFiles.length > limit;
    const filesToProcess = sourceFiles.slice(0, limit);

    const sourceIds = filesToProcess.map((sourceFile) => sourceFile._id);
    const [
      chunkGroups,
      sequenceDocs,
      transcriptionGroups,
      conversationChunkDocs,
    ] = sourceIds.length > 0
      ? await Promise.all([
        safeStat("recent source chunk coverage", aggregatePipelineStats(
          mongo,
          "audio_chunks",
          [
            { $match: { original_id: { $in: sourceIds } } },
            {
              $group: {
                _id: "$original_id",
                total: { $sum: 1 },
                vadProcessed: {
                  $sum: { $cond: [{ $ne: ["$vad.ran_at", null] }, 1, 0] },
                },
                withSpeech: {
                  $sum: { $cond: [{ $eq: ["$vad.has_speech", true] }, 1, 0] },
                },
              },
            },
          ],
          "audio_chunks_pipeline_source_stats",
          PIPELINE_DETAILS_MAX_TIME_MS,
        ), []),
        safeStat("recent transcription sequences", mongo({
          action: "find",
          collection: "transcription_sequences",
          query: { original_id: { $in: sourceIds } },
          options: { sort: { start: -1 }, limit: 5000, maxTimeMS: PIPELINE_DETAILS_MAX_TIME_MS },
        }) as Promise<any[]>, []),
        safeStat("recent transcriptions", mongo({
          action: "aggregate",
          collection: "transcriptions",
          pipeline: [
            { $match: { original: { $in: sourceIds } } },
            { $sort: { start: 1 } },
            {
              $group: {
                _id: "$original",
                count: { $sum: 1 },
                details: {
                  $push: {
                    _id: "$_id",
                    start: "$start",
                    end: "$end",
                    text: "$text",
                    segments: "$segments",
                  },
                },
              },
            },
            { $project: { count: 1, details: { $slice: ["$details", 20] } } },
          ],
          options: { maxTimeMS: PIPELINE_DETAILS_MAX_TIME_MS },
        }) as Promise<any[]>, []),
        safeStat("recent conversation chunks", mongo({
          action: "find",
          collection: "conversation_chunks",
          query: { original_id: { $in: sourceIds } },
          options: { sort: { createdAt: -1 }, limit: 5000, maxTimeMS: PIPELINE_DETAILS_MAX_TIME_MS },
        }) as Promise<any[]>, []),
      ])
      : [[], [], [], []];

    const chunkIds = conversationChunkDocs.map((chunk: any) =>
      chunk._id.toString()
    );
    const conversationDocs = chunkIds.length > 0
      ? await safeStat("recent conversations", mongo({
        action: "find",
        collection: "objects",
        query: {
          isConversation: true,
          "metadata.extractedWith.chunkId": { $in: chunkIds },
        },
        options: { sort: { createdAt: -1 }, limit: 5000, maxTimeMS: PIPELINE_DETAILS_MAX_TIME_MS },
      }) as Promise<any[]>, [])
      : [];

    const groupBy = (docs: any[], field: string) => {
      const grouped = new Map<string, any[]>();
      for (const doc of docs) {
        const key = doc[field]?.toString();
        if (!key) continue;
        grouped.set(key, [...(grouped.get(key) ?? []), doc]);
      }
      return grouped;
    };
    const chunkStatsBySource = new Map<string, any>(
      chunkGroups.map((group: any) => [group._id.toString(), group]),
    );
    const sequencesBySource = groupBy(sequenceDocs, "original_id");
    const transcriptionBySource = new Map<string, any>(
      transcriptionGroups.map((group: any) => [group._id.toString(), group]),
    );
    const conversationChunksBySource = groupBy(
      conversationChunkDocs,
      "original_id",
    );
    const conversationsByChunk = groupBy(
      conversationDocs.map((conversation: any) => ({
        ...conversation,
        chunkId: conversation.metadata?.extractedWith?.chunkId,
      })),
      "chunkId",
    );

    const sessions: PipelineSession[] = filesToProcess.map((sf) => {
      const id = sf._id.toString();
      const chunkStats = chunkStatsBySource.get(id) ?? {};
      const sequences = sequencesBySource.get(id) ?? [];
      const transcriptionGroup = transcriptionBySource.get(id) ?? {
        count: 0,
        details: [],
      };
      const conversationChunks = conversationChunksBySource.get(id) ?? [];
      const conversations = conversationChunks.flatMap((chunk: any) =>
        conversationsByChunk.get(chunk._id.toString()) ?? []
      );

      return {
        _id: sf._id.toString(),
        start: sf.start,
        lastActivityAt: sf.updatedAt ?? sf.ingested_at ??
          sf.ingestion?.last_attempt ?? sf.createdAt ?? sf.start,
        path: sf.path,
        sourceKind: sourceKind(sf),
        ingested: sf.ingested === true,
        ingestionError: ingestionError(sf),
        client_id: sf.client_id,
        device: sf.device,
        metadata: sf.metadata,
        processing_status: sf.processing_status,
        chunks: {
          total: chunkStats.total ?? 0,
          vadProcessed: chunkStats.vadProcessed ?? 0,
          withSpeech: chunkStats.withSpeech ?? 0,
        },
        sequences: sequences.map((s: any) => ({
          _id: s._id.toString(),
          state: s.state,
          chunk_count: s.chunk_count,
          fromIndex: s.fromIndex,
          toIndex: s.toIndex,
          updatedAt: s.updatedAt,
          error: s.error,
        })),
        transcriptions: transcriptionGroup.count,
        conversationChunks: conversationChunks.map((c: any) => ({
          _id: c._id.toString(),
          state: c.state,
          mode: c.mode,
          transcriptionCount: c.transcriptionCount || 0,
          totalTextLength: c.totalTextLength || 0,
          start: c.start,
          end: c.end,
          updatedAt: c.updatedAt,
          error: c.error,
          emptyReason: c.emptyReason,
          segmentsFound: c.segmentsFound,
          conversationsCreated: c.conversationsCreated,
        })),
        transcriptionDetails: transcriptionGroup.details.map((t: any) => ({
          _id: t._id.toString(),
          start: t.start,
          end: t.end,
          text: t.segments?.map((s: any) => s.text).join("") || t.text || "",
        })),
        conversations: conversations.map((c: any) => ({
          _id: c._id.toString(),
          name: c.name,
          icon: c.icon,
          timeRanges: c.timeRanges,
          createdAt: c.createdAt,
        })),
      };
    });

    // Get global stats in parallel. VAD stats are cached because this endpoint
    // auto-refreshes and the chunk collection can contain hundreds of thousands
    // of documents.
    const [
      vadStats,
      sequencesReady,
      sequencesProcessing,
      sequencesError,
      transcriptionPendingChunkStatsResult,
      convChunksReady,
      convChunksProcessing,
      convChunksError,
      totalConversations,
      sourceStatsResult,
      sourceKinds,
      pendingSequenceChunkStatsResult,
      unassignedTranscriptions,
      conversationsAwaitingSummary,
      diarizationBacklog,
      speakerMatchingBacklog,
      speakerIdentityBacklog,
      enrollmentBacklog,
      jobStatsResult,
      recentJobsResult,
      serverConfig,
    ] = await Promise.all([
      safeStat("VAD coverage", getVadPipelineStats(mongo), {
        totalChunks: 0,
        chunksVadProcessed: 0,
        chunksAwaitingVad: 0,
        vadProcessedLast15Minutes: 0,
        vadRatePerMinute: 0,
        vadJobs: {
          active: 0, waiting: 0, delayed: 0, completed: 0,
          failed: 0, cancelled: 0, recentFailures: [],
        },
      }),
      countPipelineStats(mongo, "transcription_sequences", { state: "ready" }),
      countPipelineStats(mongo, "transcription_sequences", { state: "processing" }),
      countPipelineStats(mongo, "transcription_sequences", { state: "error" }),
      safeStat("transcription backlog", aggregatePipelineStats(
        mongo,
        "audio_chunks",
        [
          {
            $match: {
              transcribed_at: null,
              processing_by: null,
              "vad.has_speech": true,
            },
          },
          { $count: "count" },
        ],
        "audio_chunks_pending_work",
      ), []),
      countPipelineStats(mongo, "conversation_chunks", { state: "ready" }),
      countPipelineStats(mongo, "conversation_chunks", { state: "processing" }),
      countPipelineStats(mongo, "conversation_chunks", { state: "error" }),
      countPipelineStats(mongo, "objects", { isConversation: true }),
      mongo({
        action: "aggregate",
        collection: "source_files",
        pipeline: [{
          $group: {
            _id: null,
            total: { $sum: 1 },
            ingested: {
              $sum: { $cond: [{ $eq: ["$ingested", true] }, 1, 0] },
            },
            errors: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $ne: ["$ingested", true] },
                      {
                        $ne: [
                          { $ifNull: ["$ingestion.error", null] },
                          null,
                        ],
                      },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            pending: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $ne: ["$ingested", true] },
                      {
                        $eq: [
                          { $ifNull: ["$ingestion.error", null] },
                          null,
                        ],
                      },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
          },
        }],
        options: { maxTimeMS: PIPELINE_STATS_MAX_TIME_MS },
      }),
      mongo({
        action: "aggregate",
        collection: "source_files",
        pipeline: [
          {
            $project: {
              kind: {
                $ifNull: [
                  "$metadata.source",
                  {
                    $ifNull: [
                      "$importer",
                      {
                        $ifNull: [
                          "$platform.importer",
                          { $ifNull: ["$platform.system", "unknown"] },
                        ],
                      },
                    ],
                  },
                ],
              },
            },
          },
          { $group: { _id: "$kind", count: { $sum: 1 } } },
          { $sort: { count: -1 } },
        ],
        options: { maxTimeMS: PIPELINE_STATS_MAX_TIME_MS },
      }),
      safeStat("sequence creation backlog", aggregatePipelineStats(
        mongo,
        "audio_chunks",
        [
          {
            $match: {
              "vad.has_speech": true,
              transcribed_at: null,
              transcription_sequence_id: { $exists: false },
            },
          },
          { $count: "count" },
        ],
        "audio_chunks_sequence_pending_stats",
      ), []),
      countPipelineStats(mongo, "transcriptions", {
        chunk_id: { $exists: false },
      }),
      countPipelineStats(mongo, "objects",
        // Subfield predicate matches the conversation_missing_summary index.
        { isConversation: true, "summaries.0.date": { $exists: false } },
      ),
      safeStat(
        "diarization backlog",
        getDiarizationBacklog(mongo),
        0,
      ),
      Promise.resolve(0),
      safeStat("speaker identity backlog", countPipelineStats(mongo, "diarizations", {
        lifecycleStatus: "active", embedding: { $exists: true },
        speakerIdentity: { $exists: false },
      }), 0),
      safeStat("voice enrollment backlog", countPipelineStats(mongo, "voice_samples.files", {
        "metadata.profile_id": { $exists: false },
      }), 0),
      safeStat("pipeline job state", mongo({
        action: "aggregate",
        collection: "jobs",
        pipeline: [
          {
            $match: {
              type: { $in: PIPELINE_STAGES.map((stage) => stage.type) },
              dismissedAt: { $exists: false },
            },
          },
          { $sort: { updatedAt: -1, createdAt: -1 } },
          {
            $group: {
              _id: "$type",
              active: {
                $sum: { $cond: [{ $eq: ["$state", "active"] }, 1, 0] },
              },
              waiting: {
                $sum: { $cond: [{ $eq: ["$state", "waiting"] }, 1, 0] },
              },
              delayed: {
                $sum: { $cond: [{ $eq: ["$state", "delayed"] }, 1, 0] },
              },
              failed: {
                $sum: { $cond: [{ $eq: ["$state", "failed"] }, 1, 0] },
              },
              latestJob: {
                $first: {
                  id: "$_id",
                  state: "$state",
                  updatedAt: { $ifNull: ["$updatedAt", "$createdAt"] },
                  failedReason: "$failedReason",
                },
              },
            },
          },
        ],
        options: { maxTimeMS: PIPELINE_STATS_MAX_TIME_MS },
      }) as Promise<any[]>, []),
      safeStat("recent pipeline jobs", mongo({
        action: "find",
        collection: "jobs",
        query: {
          type: { $in: PIPELINE_STAGES.map((stage) => stage.type) },
          dismissedAt: { $exists: false },
        },
        options: {
          sort: { updatedAt: -1, createdAt: -1 },
          limit: 12,
          projection: {
            type: 1,
            state: 1,
            createdAt: 1,
            updatedAt: 1,
            startedAt: 1,
            finishedAt: 1,
            failedReason: 1,
            progress: 1,
            result: 1,
          },
          maxTimeMS: PIPELINE_STATS_MAX_TIME_MS,
        },
      }) as Promise<any[]>, []),
      getServerConfig().catch((error: unknown) => {
        console.warn("[apiAudioPipelineHandler] config unavailable:", error);
        return { workers: {} } as any;
      }),
    ]);

    const pendingSequenceChunks = pendingSequenceChunkStatsResult[0]?.count ??
      0;
    const transcriptionPendingChunks =
      transcriptionPendingChunkStatsResult[0]?.count ?? 0;
    const sourceTotals = sourceStatsResult[0] ?? {};
    const sourceFilesStats = {
      total: sourceTotals.total ?? 0,
      ingested: sourceTotals.ingested ?? 0,
      pending: sourceTotals.pending ?? 0,
      errors: sourceTotals.errors ?? 0,
      byKind: sourceKinds.map((row: any) => ({
        kind: row._id ?? "unknown",
        count: row.count,
      })),
    };
    const jobStats = new Map<string, any>(
      jobStatsResult.map((row: any) => [row._id, row]),
    );
    const backlogs: Record<string, number> = {
      ingestion: sourceFilesStats.pending + sourceFilesStats.errors,
      vad: vadStats.chunksAwaitingVad,
      transcription_sequence_creator: pendingSequenceChunks,
      transcription: sequencesReady + sequencesProcessing + sequencesError,
      conversation_chunk_creator: unassignedTranscriptions,
      conversation_extractor_merged: convChunksReady + convChunksProcessing +
        convChunksError,
      summarization: conversationsAwaitingSummary,
      diarization: diarizationBacklog,
      speakerMatching: speakerMatchingBacklog,
      speakerIdentity: speakerIdentityBacklog,
      enrollment: enrollmentBacklog,
    };
    const stageErrors: Record<string, number> = {
      ingestion: sourceFilesStats.errors,
      vad: vadStats.vadJobs.failed,
      transcription: sequencesError,
      conversation_extractor_merged: convChunksError,
    };
    const stages = PIPELINE_STAGES.map(({ type, label }) => {
      const jobs = jobStats.get(type) ?? {};
      const latestJob = jobs.latestJob
        ? {
          ...jobs.latestJob,
          id: jobs.latestJob.id.toString(),
        }
        : undefined;
      return {
        type,
        label,
        backlog: backlogs[type] ?? 0,
        errors: stageErrors[type] ?? 0,
        paused: serverConfig.workers?.[type]?.paused === true,
        active: jobs.active ?? 0,
        waiting: jobs.waiting ?? 0,
        delayed: jobs.delayed ?? 0,
        failed: jobs.failed ?? 0,
        latestJob,
      };
    });

    const stats: PipelineStats = {
      warnings,
      totalSessions: sourceFilesStats.total,
      ...vadStats,
      sequencesReady,
      sequencesProcessing,
      sequencesError,
      transcriptionPendingChunks,
      transcriptionPendingMaximumHours: transcriptionPendingChunks *
        MAX_AUDIO_CHUNK_SECONDS / 3600,
      convChunksReady,
      convChunksProcessing,
      convChunksError,
      totalConversations,
      sourceFiles: sourceFilesStats,
      stages,
      recentJobs: recentJobsResult.map((job: any) => ({
        id: job._id.toString(),
        type: job.type,
        state: job.state,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        startedAt: job.startedAt,
        finishedAt: job.finishedAt,
        failedReason: job.failedReason,
        progress: job.progress,
        result: job.result,
      })),
    };

    // Serialize dates properly
    const response = EJSON.serialize({
      sessions,
      hasMore,
      stats,
    });

    res.json(response);
  } catch (error) {
    console.error("[apiAudioPipelineHandler] error:", error);
    throw error;
  }
}
