import type { Request, Response } from "express";
import { EJSON, ObjectId } from "bson";
import { authenticateOr401 } from "@/lib/auth/core.server.ts";
import { getMongoResource } from "@/lib/mongo/core.server.ts";

const LIST_MAX_TIME_MS = 3_000;
const DETAIL_MAX_TIME_MS = 2_000;
const MAX_LIST_LIMIT = 50;
const RECENT_SOURCES_CURSOR_INDEX = "pipeline_recent_sources_cursor_v1";

function isMissingIndexHint(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes(
    "hint provided does not correspond to an existing index",
  );
}

interface SourceCursor {
  updatedAt: string | null;
  start: string | null;
  id: string;
}

function sourceKind(sourceFile: any): string {
  return sourceFile.metadata?.source ?? sourceFile.importer ??
    sourceFile.platform?.importer ?? sourceFile.platform?.system ?? "unknown";
}

function ingestionError(sourceFile: any): string | undefined {
  if (sourceFile.ingested === true) return undefined;
  const error = sourceFile.ingestion?.error;
  if (!error) return undefined;
  if (typeof error === "string") return error;
  return error.message ?? JSON.stringify(error);
}

function encodeCursor(sourceFile: any): string | null {
  const cursor: SourceCursor = {
    updatedAt: sourceFile.updatedAt instanceof Date
      ? sourceFile.updatedAt.toISOString()
      : null,
    start: sourceFile.start instanceof Date
      ? sourceFile.start.toISOString()
      : null,
    id: sourceFile._id.toString(),
  };
  return btoa(JSON.stringify(cursor));
}

function decodeCursor(value: unknown): SourceCursor | null {
  if (typeof value !== "string" || value.length === 0) return null;
  try {
    const cursor = JSON.parse(atob(value)) as Partial<SourceCursor>;
    if (
      (cursor.updatedAt != null && typeof cursor.updatedAt !== "string") ||
      typeof cursor.id !== "string" ||
      !ObjectId.isValid(cursor.id) ||
      (cursor.updatedAt != null &&
        Number.isNaN(new Date(cursor.updatedAt).getTime())) ||
      (cursor.start != null && Number.isNaN(new Date(cursor.start).getTime()))
    ) {
      return null;
    }
    return {
      updatedAt: cursor.updatedAt ?? null,
      start: cursor.start ?? null,
      id: cursor.id,
    };
  } catch {
    return null;
  }
}

function cursorQuery(cursor: SourceCursor): Record<string, unknown> {
  const id = new ObjectId(cursor.id);
  if (cursor.updatedAt == null) {
    if (cursor.start == null) {
      return {
        updatedAt: null,
        start: null,
        _id: { $lt: id },
      };
    }
    const start = new Date(cursor.start);
    return {
      updatedAt: null,
      $or: [
        { start: { $lt: start } },
        { start, _id: { $lt: id } },
      ],
    };
  }
  const updatedAt = new Date(cursor.updatedAt);
  if (cursor.start == null) {
    return {
      $or: [
        { updatedAt: { $lt: updatedAt } },
        { updatedAt, start: null, _id: { $lt: id } },
        { updatedAt, start: { $exists: false }, _id: { $lt: id } },
        { updatedAt: null },
      ],
    };
  }
  const start = new Date(cursor.start);
  return {
    $or: [
      { updatedAt: { $lt: updatedAt } },
      { updatedAt, start: { $lt: start } },
      { updatedAt, start, _id: { $lt: id } },
      { updatedAt: null },
    ],
  };
}

export async function apiAudioPipelineSourcesHandler(
  req: Request,
  res: Response,
) {
  const auth = await authenticateOr401(req, res);
  const mongo = getMongoResource(auth);
  const limit = Math.min(
    Math.max(parseInt(String(req.query.limit ?? "10"), 10) || 10, 1),
    MAX_LIST_LIMIT,
  );
  const rawCursor = req.query.cursor;
  const cursor = decodeCursor(rawCursor);
  if (rawCursor && !cursor) {
    res.status(400).json({ error: "Invalid recent-source cursor" });
    return;
  }

  const request = {
    action: "find",
    collection: "source_files",
    query: cursor ? cursorQuery(cursor) : {},
    options: {
      hint: RECENT_SOURCES_CURSOR_INDEX,
      sort: { updatedAt: -1, start: -1, _id: -1 },
      limit: limit + 1,
      projection: {
        start: 1,
        updatedAt: 1,
        ingested_at: 1,
        createdAt: 1,
        path: 1,
        importer: 1,
        platform: 1,
        "metadata.format": 1,
        "metadata.rate": 1,
        "metadata.width": 1,
        "metadata.channels": 1,
        "metadata.source": 1,
        "metadata.codec": 1,
        ingested: 1,
        "ingestion.error": 1,
        client_id: 1,
        device: 1,
        processing_status: 1,
      },
      maxTimeMS: LIST_MAX_TIME_MS,
    },
  } as const;
  let docs: any[];
  try {
    docs = await mongo(request) as any[];
  } catch (error) {
    if (!isMissingIndexHint(error)) throw error;
    const { hint: _hint, ...optionsWithoutHint } = request.options;
    docs = await mongo({
      ...request,
      options: optionsWithoutHint,
    }) as any[];
  }

  const hasMore = docs.length > limit;
  const page = docs.slice(0, limit);
  const nextCursor = hasMore ? encodeCursor(page[page.length - 1]) : null;
  res.json(EJSON.serialize({
    items: page.map((sourceFile) => ({
      id: sourceFile._id.toString(),
      start: sourceFile.start,
      updatedAt: sourceFile.updatedAt,
      path: sourceFile.path,
      sourceKind: sourceKind(sourceFile),
      ingested: sourceFile.ingested === true,
      ingestionError: ingestionError(sourceFile),
      clientId: sourceFile.client_id,
      device: sourceFile.device,
      metadata: sourceFile.metadata,
      processingStatus: sourceFile.processing_status,
    })),
    hasMore: hasMore && nextCursor != null,
    nextCursor,
  }));
}

export async function apiAudioPipelineSourceDetailsHandler(
  req: Request,
  res: Response,
) {
  const auth = await authenticateOr401(req, res);
  if (!ObjectId.isValid(req.params.id)) {
    res.status(400).json({ error: "Invalid source id" });
    return;
  }
  const mongo = getMongoResource(auth);
  const sourceId = new ObjectId(req.params.id);
  const warnings: string[] = [];
  const safe = async <T>(label: string, operation: Promise<T>, fallback: T) => {
    try {
      return await operation;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`${label}: ${message}`);
      return fallback;
    }
  };

  const source = await mongo({
    action: "findOne",
    collection: "source_files",
    query: { _id: sourceId },
    options: { projection: { _id: 1 }, maxTimeMS: DETAIL_MAX_TIME_MS },
  });
  if (!source) {
    res.status(404).json({ error: "Source not found" });
    return;
  }

  const [
    chunkGroups,
    sequences,
    transcriptionCount,
    transcriptionDetails,
    conversationChunks,
  ] = await Promise.all([
    safe(
      "chunk coverage",
      mongo({
        action: "aggregate",
        collection: "audio_chunks",
        pipeline: [
          { $match: { original_id: sourceId } },
          {
            $group: {
              _id: null,
              total: { $sum: 1 },
              vadProcessed: {
                $sum: {
                  $cond: [
                    { $ne: [{ $ifNull: ["$vad.ran_at", null] }, null] },
                    1,
                    0,
                  ],
                },
              },
              withSpeech: {
                $sum: { $cond: [{ $eq: ["$vad.has_speech", true] }, 1, 0] },
              },
            },
          },
        ],
        options: { maxTimeMS: DETAIL_MAX_TIME_MS },
      }) as Promise<any[]>,
      [],
    ),
    safe(
      "transcription sequences",
      mongo({
        action: "find",
        collection: "transcription_sequences",
        query: { original_id: sourceId },
        options: {
          sort: { start: -1 },
          limit: 50,
          projection: {
            state: 1,
            chunk_count: 1,
            fromIndex: 1,
            toIndex: 1,
            updatedAt: 1,
            error: 1,
          },
          maxTimeMS: DETAIL_MAX_TIME_MS,
        },
      }) as Promise<any[]>,
      [],
    ),
    safe(
      "transcription count",
      mongo({
        action: "count",
        collection: "transcriptions",
        query: { original: sourceId },
        options: { maxTimeMS: DETAIL_MAX_TIME_MS },
      }) as Promise<number>,
      0,
    ),
    safe(
      "transcription preview",
      mongo({
        action: "find",
        collection: "transcriptions",
        query: { original: sourceId },
        options: {
          sort: { start: 1 },
          limit: 20,
          projection: { start: 1, end: 1, text: 1, "segments.text": 1 },
          maxTimeMS: DETAIL_MAX_TIME_MS,
        },
      }) as Promise<any[]>,
      [],
    ),
    safe(
      "conversation chunks",
      mongo({
        action: "find",
        collection: "conversation_chunks",
        query: { original_id: sourceId },
        options: {
          sort: { createdAt: -1 },
          limit: 50,
          projection: {
            state: 1,
            mode: 1,
            transcriptionCount: 1,
            totalTextLength: 1,
            start: 1,
            end: 1,
            updatedAt: 1,
            error: 1,
            emptyReason: 1,
            segmentsFound: 1,
            conversationsCreated: 1,
          },
          maxTimeMS: DETAIL_MAX_TIME_MS,
        },
      }) as Promise<any[]>,
      [],
    ),
  ]);

  const chunkIds = conversationChunks.map((chunk: any) => chunk._id.toString());
  const conversations = chunkIds.length > 0
    ? await safe(
      "conversation preview",
      mongo({
        action: "find",
        collection: "objects",
        query: {
          isConversation: true,
          "metadata.extractedWith.chunkId": { $in: chunkIds },
        },
        options: {
          sort: { createdAt: -1 },
          limit: 50,
          projection: { name: 1, icon: 1, timeRanges: 1, createdAt: 1 },
          maxTimeMS: DETAIL_MAX_TIME_MS,
        },
      }) as Promise<any[]>,
      [],
    )
    : [];

  const chunkCoverage = chunkGroups[0] ?? {};
  res.json(EJSON.serialize({
    warnings,
    chunks: {
      total: chunkCoverage.total ?? 0,
      vadProcessed: chunkCoverage.vadProcessed ?? 0,
      withSpeech: chunkCoverage.withSpeech ?? 0,
    },
    sequences: sequences.map((sequence: any) => ({
      ...sequence,
      _id: sequence._id.toString(),
    })),
    transcriptions: {
      count: transcriptionCount,
      preview: transcriptionDetails.map((transcription: any) => ({
        id: transcription._id.toString(),
        start: transcription.start,
        end: transcription.end,
        text: transcription.segments?.map((segment: any) =>
          segment.text
        ).join("") ||
          transcription.text || "",
      })),
    },
    conversationChunks: conversationChunks.map((chunk: any) => ({
      ...chunk,
      _id: chunk._id.toString(),
    })),
    conversations: conversations.map((conversation: any) => ({
      ...conversation,
      _id: conversation._id.toString(),
    })),
  }));
}
