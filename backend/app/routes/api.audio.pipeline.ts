import type { Request, Response } from "express";
import { authenticateOr401 } from "@/lib/auth/core.server.ts";
import { getMongoResource } from "@/lib/mongo/core.server.ts";
import { EJSON } from "bson";
import { ObjectId } from "mongodb";

interface PipelineSession {
  _id: string;
  start: Date;
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
  totalSessions: number;
  totalChunks: number;
  chunksVadProcessed: number;
  chunksAwaitingVad: number;
  chunksWithSpeech: number;
  chunksWithoutSpeech: number;
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
  };
  sequencesReady: number;
  sequencesProcessing: number;
  sequencesError: number;
  convChunksReady: number;
  convChunksProcessing: number;
  totalConversations: number;
}

export async function apiAudioPipelineHandler(req: Request, res: Response) {
  try {
    const auth = await authenticateOr401(req, res);

    const limit = Math.min(parseInt(req.query.limit as string) || 10, 100);
    const mongo = getMongoResource(auth);

    // Fetch source files
    const sourceFiles = await mongo({
      action: "find",
      collection: "source_files",
      query: { "metadata.source": "websocket" },
      options: {
        sort: { start: -1 },
        limit: limit + 1,
      },
    }) as any[];

    const hasMore = sourceFiles.length > limit;
    const filesToProcess = sourceFiles.slice(0, limit);

    // Process all sessions in parallel
    const sessions: PipelineSession[] = await Promise.all(
      filesToProcess.map(async (sf) => {
        const sourceFileId = sf._id;

        // Aggregate all data for this session in parallel
        const [
          totalChunks,
          vadProcessed,
          withSpeech,
          sequences,
          transcriptionDocs,
          conversationChunks,
        ] = await Promise.all([
          // Count queries
          mongo({
            action: "count",
            collection: "audio_chunks",
            query: { original_id: sourceFileId },
          }),
          mongo({
            action: "count",
            collection: "audio_chunks",
            query: {
              original_id: sourceFileId,
              "vad.ran_at": { $exists: true },
            },
          }),
          mongo({
            action: "count",
            collection: "audio_chunks",
            query: {
              original_id: sourceFileId,
              "vad.has_speech": true,
            },
          }),
          // Find queries
          mongo({
            action: "find",
            collection: "transcription_sequences",
            query: { original_id: sourceFileId },
            options: { sort: { start: -1 } },
          }),
          mongo({
            action: "find",
            collection: "transcriptions",
            query: { original: sourceFileId },
            options: { sort: { start: 1 }, limit: 20 },
          }),
          mongo({
            action: "find",
            collection: "conversation_chunks",
            query: { original_id: sourceFileId },
            options: { sort: { createdAt: -1 } },
          }),
        ]);

        // Get conversations for this session via conversation chunks
        const chunkIds = conversationChunks.map((c: any) => c._id.toString());
        const conversations = chunkIds.length > 0
          ? await mongo({
            action: "find",
            collection: "objects",
            query: {
              isConversation: true,
              "metadata.extractedWith.chunkId": { $in: chunkIds },
            },
            options: { sort: { createdAt: -1 } },
          })
          : [];

        return {
          _id: sf._id.toString(),
          start: sf.start,
          client_id: sf.client_id,
          device: sf.device,
          metadata: sf.metadata,
          processing_status: sf.processing_status,
          chunks: {
            total: totalChunks,
            vadProcessed,
            withSpeech,
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
          transcriptions: transcriptionDocs.length,
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
          transcriptionDetails: transcriptionDocs.map((t: any) => ({
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
      }),
    );

    // Get global stats in parallel
    const vadRateWindowMinutes = 15;
    const vadRateWindowStart = new Date(
      Date.now() - vadRateWindowMinutes * 60 * 1000,
    );
    const [
      vadChunkStatsResult,
      vadJobStatsResult,
      latestFailedVadJobs,
      sequencesReady,
      sequencesProcessing,
      sequencesError,
      convChunksReady,
      convChunksProcessing,
      totalConversations,
    ] = await Promise.all([
      mongo({
        action: "aggregate",
        collection: "audio_chunks",
        pipeline: [
          {
            $group: {
              _id: null,
              totalChunks: { $sum: 1 },
              chunksVadProcessed: {
                $sum: {
                  $cond: [
                    { $ne: [{ $ifNull: ["$vad.ran_at", null] }, null] },
                    1,
                    0,
                  ],
                },
              },
              chunksWithSpeech: {
                $sum: { $cond: [{ $eq: ["$vad.has_speech", true] }, 1, 0] },
              },
              vadProcessedLast15Minutes: {
                $sum: {
                  $cond: [
                    { $gte: ["$vad.ran_at", vadRateWindowStart] },
                    1,
                    0,
                  ],
                },
              },
              vadLastProcessedAt: { $max: "$vad.ran_at" },
            },
          },
          { $project: { _id: 0 } },
        ],
      }),
      mongo({
        action: "aggregate",
        collection: "jobs",
        pipeline: [
          { $match: { type: "vad" } },
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
            },
          },
          { $project: { _id: 0 } },
        ],
      }),
      mongo({
        action: "find",
        collection: "jobs",
        query: { type: "vad", state: "failed" },
        options: {
          projection: { failedReason: 1 },
          sort: { finishedAt: -1, createdAt: -1 },
          limit: 1,
        },
      }),
      mongo({
        action: "count",
        collection: "transcription_sequences",
        query: { state: "ready" },
      }),
      mongo({
        action: "count",
        collection: "transcription_sequences",
        query: { state: "processing" },
      }),
      mongo({
        action: "count",
        collection: "transcription_sequences",
        query: { state: "error" },
      }),
      mongo({
        action: "count",
        collection: "conversation_chunks",
        query: { state: "ready" },
      }),
      mongo({
        action: "count",
        collection: "conversation_chunks",
        query: { state: "processing" },
      }),
      mongo({
        action: "count",
        collection: "objects",
        query: { isConversation: true },
      }),
    ]);

    const vadChunkStats = vadChunkStatsResult[0] ?? {};
    const totalChunks = vadChunkStats.totalChunks ?? 0;
    const chunksVadProcessed = vadChunkStats.chunksVadProcessed ?? 0;
    const chunksAwaitingVad = Math.max(totalChunks - chunksVadProcessed, 0);
    const chunksWithSpeech = vadChunkStats.chunksWithSpeech ?? 0;
    const chunksWithoutSpeech = Math.max(
      chunksVadProcessed - chunksWithSpeech,
      0,
    );
    const vadProcessedLast15Minutes = vadChunkStats.vadProcessedLast15Minutes ??
      0;
    const vadRatePerMinute = vadProcessedLast15Minutes / vadRateWindowMinutes;
    const vadEtaSeconds = vadRatePerMinute > 0 && chunksAwaitingVad > 0
      ? Math.ceil(chunksAwaitingVad / vadRatePerMinute * 60)
      : undefined;
    const vadJobStats = vadJobStatsResult[0] ?? {};

    const stats: PipelineStats = {
      totalSessions: sessions.length,
      totalChunks,
      chunksVadProcessed,
      chunksAwaitingVad,
      chunksWithSpeech,
      chunksWithoutSpeech,
      vadProcessedLast15Minutes,
      vadRatePerMinute,
      vadEtaSeconds,
      vadLastProcessedAt: vadChunkStats.vadLastProcessedAt,
      vadJobs: {
        active: vadJobStats.active ?? 0,
        waiting: vadJobStats.waiting ?? 0,
        delayed: vadJobStats.delayed ?? 0,
        completed: vadJobStats.completed ?? 0,
        failed: vadJobStats.failed ?? 0,
        cancelled: vadJobStats.cancelled ?? 0,
        latestFailure: latestFailedVadJobs[0]?.failedReason,
      },
      sequencesReady,
      sequencesProcessing,
      sequencesError,
      convChunksReady,
      convChunksProcessing,
      totalConversations,
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
