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
  chunksAwaitingVad: number;
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

    const limit = parseInt(req.query.limit as string) || 10;
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
        const conversations =
          chunkIds.length > 0
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
      })
    );

    // Get global stats in parallel
    const [
      chunksAwaitingVad,
      sequencesReady,
      sequencesProcessing,
      sequencesError,
      convChunksReady,
      convChunksProcessing,
      totalConversations,
    ] = await Promise.all([
      mongo({
        action: "count",
        collection: "audio_chunks",
        query: { vad: null },
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

    const stats: PipelineStats = {
      totalSessions: sessions.length,
      chunksAwaitingVad,
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
