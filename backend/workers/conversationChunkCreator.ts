import { z } from "zod";
import { ObjectId } from "bson";
import type { JobCapability } from "@/lib/jobs/job-registry.ts";
import { callResource } from "@myceliasdk/resources.ts";
import { zDateOrString } from "@myceliasdk/zod-json-schema.ts";
import { mongoCursor } from "@/lib/mongo/cursor.ts";
import { createHash } from "node:crypto";
import { getTriggerTiming } from "@/lib/jobs/trigger-config.ts";
import { hasIndexedPendingWork } from "@/lib/jobs/pending-work.ts";

// ============================================================================
// Constants
// ============================================================================

const GAP_TIMEOUT_MS = 60 * 1000; // 60s silence = finalize open chunk
const RECENT_WINDOW_MS = 5 * 60 * 1000; // Last 5 min = "recent" (streaming mode)
const CHUNK_END_STALENESS_MS = 5 * 60 * 1000; // If chunk.end is >5min old, finalize immediately
const BACKFILL_BATCH_SIZE = 100; // Max transcriptions per backfill batch
const MAX_OPEN_CHUNKS_PER_RUN = 10; // Max open chunks to finalize per run
const MAX_STREAMING_PER_RUN = 50; // Max transcriptions to stream per run

// ============================================================================
// Types
// ============================================================================

interface Utterance {
  _id: ObjectId;
  original?: ObjectId;
  start: Date;
  end: Date;
  text: string;
  createdAt?: Date;
}

interface PendingChunk {
  start: Date;
  end: Date;
  transcriptionIds: ObjectId[];
  totalTextLength: number;
}

interface OpenChunk {
  _id: ObjectId;
  original_id?: ObjectId;
  start: Date;
  end: Date;
  transcriptionIds: ObjectId[];
  totalTextLength: number;
  lastActivityAt: Date;
}

type ChunkState =
  | "open"
  | "ready"
  | "processing"
  | "completed"
  | "error"
  | "empty";
type ChunkMode = "streaming" | "backfill";

// ============================================================================
// Schema
// ============================================================================

const gapThresholdsSchema = z.object({
  sparse: z.number().default(45 * 60 * 1000), // 45 min
  normal: z.number().default(5 * 60 * 1000), // 5 min
  dense: z.number().default(40 * 1000), // 40 sec
});

const charThresholdsSchema = z.object({
  sparseMax: z.number().default(500),
  normalMax: z.number().default(20000),
});

export const schema = z.object({
  type: z.literal("conversation_chunk_creator"),
  // Manual range override (for explicit reprocessing)
  start: zDateOrString().optional(),
  end: zDateOrString().optional(),
  // Thresholds
  gapThresholds: gapThresholdsSchema.optional(),
  charThresholds: charThresholdsSchema.optional(),
  // Processing options
  policyVersion: z.string().optional(),
  model: z.string().optional(),
  force: z.boolean().optional(),
  // Limits
  maxChunks: z.number().optional(),
  // Mode override (for testing/manual runs)
  mode: z.string().optional(),
});

export type ConversationChunkCreatorJobData = z.infer<typeof schema>;

// ============================================================================
// Pure Functions
// ============================================================================

function allowedGap(
  totalTextLength: number,
  gapThresholds: { sparse: number; normal: number; dense: number },
  charThresholds: { sparseMax: number; normalMax: number },
): number {
  if (totalTextLength < charThresholds.sparseMax) return gapThresholds.sparse;
  if (totalTextLength < charThresholds.normalMax) return gapThresholds.normal;
  return gapThresholds.dense;
}

function generateChunkKey(
  policyVersion: string,
  start: Date,
  end: Date,
): string {
  const input = `${policyVersion}:${start.toISOString()}:${end.toISOString()}`;
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}

// ============================================================================
// Chunking Engine (for backfill batch processing)
// ============================================================================

class ChunkingEngine {
  private buffer: Utterance[] = [];
  private totalTextLength = 0;
  private lastTimestamp: Date | null = null;
  private processedCount = 0;

  constructor(
    private gapThresholds: { sparse: number; normal: number; dense: number },
    private charThresholds: { sparseMax: number; normalMax: number },
  ) {
    console.log(
      `[ChunkingEngine] Initialized with gapThresholds=${
        JSON.stringify(gapThresholds)
      }, charThresholds=${JSON.stringify(charThresholds)}`,
    );
  }

  /**
   * Process a transcription (coming in reverse chronological order).
   * Returns a chunk if one should be finalized, otherwise null.
   */
  process(utterance: Utterance): PendingChunk | null {
    let result: PendingChunk | null = null;
    this.processedCount++;

    if (this.buffer.length > 0 && this.lastTimestamp) {
      // Gap is from current utterance's end to the last buffered utterance's start
      // Since we're going backwards: lastTimestamp is more recent, utterance is older
      const gap = this.lastTimestamp.getTime() -
        new Date(utterance.end).getTime();
      const threshold = allowedGap(
        this.totalTextLength,
        this.gapThresholds,
        this.charThresholds,
      );

      console.log(
        `[ChunkingEngine] Processing #${this.processedCount}: gap=${gap}ms, threshold=${threshold}ms, bufferTextLen=${this.totalTextLength}, bufferCount=${this.buffer.length}`,
      );

      if (this.totalTextLength > 100 && gap > threshold) {
        console.log(
          `[ChunkingEngine] Gap threshold exceeded (${gap} > ${threshold}), finalizing chunk with ${this.buffer.length} items`,
        );
        result = this.finalize();
      } else if (this.totalTextLength <= 100) {
        console.log(
          `[ChunkingEngine] Buffer too small (${this.totalTextLength} <= 100 chars), continuing to buffer`,
        );
      } else {
        console.log(
          `[ChunkingEngine] Gap within threshold (${gap} <= ${threshold}), continuing to buffer`,
        );
      }
    } else {
      console.log(
        `[ChunkingEngine] Processing #${this.processedCount}: first item or no lastTimestamp, starting buffer`,
      );
    }

    this.buffer.push(utterance);
    this.totalTextLength += utterance.text.length;
    this.lastTimestamp = new Date(utterance.start);

    return result;
  }

  /** Finalize current buffer into a chunk */
  finalize(): PendingChunk | null {
    console.log(
      `[ChunkingEngine] finalize() called: bufferLen=${this.buffer.length}, totalTextLen=${this.totalTextLength}`,
    );

    if (this.buffer.length === 0) {
      console.log(
        `[ChunkingEngine] finalize() returning null: buffer is empty`,
      );
      return null;
    }

    // Buffer is in reverse chronological order, sort to chronological
    const sorted = [...this.buffer].sort((a, b) =>
      new Date(a.start).getTime() - new Date(b.start).getTime()
    );

    const chunk: PendingChunk = {
      start: new Date(sorted[0].start),
      end: new Date(sorted[sorted.length - 1].end),
      transcriptionIds: sorted.map((u) => u._id),
      totalTextLength: this.totalTextLength,
    };

    console.log(
      `[ChunkingEngine] finalize() created chunk: transcriptionIds=${chunk.transcriptionIds.length}, textLen=${chunk.totalTextLength}, start=${chunk.start.toISOString()}, end=${chunk.end.toISOString()}`,
    );

    this.buffer = [];
    this.totalTextLength = 0;
    this.lastTimestamp = null;

    return chunk;
  }

  hasContent(): boolean {
    const hasContent = this.buffer.length > 0;
    console.log(
      `[ChunkingEngine] hasContent()=${hasContent}, bufferLen=${this.buffer.length}, totalTextLen=${this.totalTextLength}`,
    );
    return hasContent;
  }
}

// ============================================================================
// Database Operations
// ============================================================================

type MongoFn = (input: any) => Promise<any>;

export const unassignedTranscriptionQuery = { chunk_id: null } as const;

export function buildStaleOpenChunkQuery(now = new Date()) {
  return {
    state: "open",
    $or: [
      {
        lastActivityAt: {
          $lt: new Date(now.getTime() - GAP_TIMEOUT_MS),
        },
      },
      {
        end: {
          $lt: new Date(now.getTime() - CHUNK_END_STALENESS_MS),
        },
      },
    ],
  };
}

/**
 * Keep the 30-second safety poll without creating a durable Job for every
 * empty tick. New transcriptions still trigger immediately, while stale open
 * chunks become eligible after the same timeout as before.
 */
export async function hasPendingConversationChunkWork(
  mongo: MongoFn,
  now = new Date(),
): Promise<boolean> {
  const unassigned = await hasIndexedPendingWork(mongo, {
    collection: "transcriptions",
    query: unassignedTranscriptionQuery,
    hint: "transcriptions_unassigned_start_v1",
  });
  if (unassigned) return true;

  return await hasIndexedPendingWork(mongo, {
    collection: "conversation_chunks",
    query: buildStaleOpenChunkQuery(now),
  });
}

async function findStaleOpenChunks(mongo: MongoFn): Promise<OpenChunk[]> {
  const now = Date.now();
  // Find chunks that are stale either by:
  // 1. lastActivityAt is old (no recent worker activity)
  // 2. end timestamp is old (chunk content is from the past)
  return await mongo({
    action: "find",
    collection: "conversation_chunks",
    query: buildStaleOpenChunkQuery(new Date(now)),
    options: { limit: MAX_OPEN_CHUNKS_PER_RUN },
  }) as OpenChunk[];
}

async function findRecentUnassignedTranscriptions(
  mongo: MongoFn,
): Promise<Utterance[]> {
  const cutoffDate = new Date(Date.now() - RECENT_WINDOW_MS);

  const docs = await mongo({
    action: "find",
    collection: "transcriptions",
    query: {
      ...unassignedTranscriptionQuery,
      createdAt: { $gte: cutoffDate },
    },
    options: {
      sort: { start: 1 }, // Oldest first within recent window
      limit: MAX_STREAMING_PER_RUN,
    },
  }) as any[];

  return docs.map((doc) => ({
    _id: doc._id,
    original: doc.original,
    start: new Date(doc.start),
    end: new Date(doc.end),
    text: doc.segments?.map((s: any) => s.text).join("").trim() ?? doc.text ??
      "",
    createdAt: doc.createdAt ? new Date(doc.createdAt) : undefined,
  }));
}

export async function findHistoricalUnassignedTranscriptions(
  mongo: MongoFn,
): Promise<Utterance[]> {
  const docs = await mongo({
    action: "find",
    collection: "transcriptions",
    // The recent path always runs first. Once it is drained, every remaining
    // unassigned record is historical — including legacy rows with no
    // createdAt field at all.
    query: unassignedTranscriptionQuery,
    options: {
      sort: { start: -1 }, // Newest historical first (work backwards)
      limit: BACKFILL_BATCH_SIZE,
    },
  }) as any[];

  const results = docs.map((doc) => {
    const text = doc.segments?.map((s: any) => s.text).join("").trim() ??
      doc.text ?? "";
    return {
      _id: doc._id,
      original: doc.original,
      start: new Date(doc.start),
      end: new Date(doc.end),
      text,
      createdAt: doc.createdAt ? new Date(doc.createdAt) : undefined,
    };
  });

  if (results.length > 0) {
    console.log(
      `[ChunkCreator] First transcription: id=${results[0]._id}, start=${
        results[0].start.toISOString()
      }, textLen=${results[0].text.length}`,
    );
    console.log(
      `[ChunkCreator] Last transcription: id=${
        results[results.length - 1]._id
      }, start=${results[results.length - 1].start.toISOString()}, textLen=${
        results[results.length - 1].text.length
      }`,
    );
    const totalText = results.reduce((sum, r) => sum + r.text.length, 0);
    console.log(
      `[ChunkCreator] Total text across all transcriptions: ${totalText} chars`,
    );
  }

  return results;
}

async function findOrCreateOpenChunk(
  mongo: MongoFn,
  originalId: ObjectId | undefined,
  policyVersion: string,
): Promise<OpenChunk> {
  // Find existing open chunk for this recording
  const query: any = { state: "open" };
  if (originalId) {
    query.original_id = originalId;
  } else {
    query.original_id = { $exists: false };
  }

  let chunk = await mongo({
    action: "findOne",
    collection: "conversation_chunks",
    query,
  }) as OpenChunk | null;

  if (!chunk) {
    const newId = new ObjectId();
    const now = new Date();
    const doc: any = {
      _id: newId,
      state: "open",
      mode: "streaming" as ChunkMode,
      transcriptionIds: [],
      transcriptionCount: 0,
      totalTextLength: 0,
      lastActivityAt: now,
      createdAt: now,
      policyVersion,
      params: { force: false },
    };
    if (originalId) {
      doc.original_id = originalId;
    }

    await mongo({
      action: "insertOne",
      collection: "conversation_chunks",
      doc,
    });

    chunk = {
      _id: newId,
      original_id: originalId,
      start: now,
      end: now,
      transcriptionIds: [],
      totalTextLength: 0,
      lastActivityAt: now,
    };
  }

  return chunk;
}

async function appendToChunk(
  mongo: MongoFn,
  chunk: OpenChunk,
  transcription: Utterance,
): Promise<void> {
  const update: any = {
    $push: { transcriptionIds: transcription._id },
    $inc: {
      totalTextLength: transcription.text.length,
      transcriptionCount: 1,
    },
    $min: { start: transcription.start },
    $max: { end: transcription.end },
    $set: { lastActivityAt: new Date() },
  };

  await mongo({
    action: "updateOne",
    collection: "conversation_chunks",
    query: { _id: chunk._id },
    update,
  });

  // Mark transcription as assigned
  await mongo({
    action: "updateOne",
    collection: "transcriptions",
    query: { _id: transcription._id },
    update: { $set: { chunk_id: chunk._id } },
  });

  // Update local state
  chunk.transcriptionIds.push(transcription._id);
  chunk.totalTextLength += transcription.text.length;
  if (transcription.start < chunk.start) chunk.start = transcription.start;
  if (transcription.end > chunk.end) chunk.end = transcription.end;
}

async function finalizeChunk(
  mongo: MongoFn,
  chunk: OpenChunk,
  policyVersion: string,
): Promise<boolean> {
  if (chunk.transcriptionIds.length === 0) {
    // Empty chunk, just delete it
    await mongo({
      action: "deleteOne",
      collection: "conversation_chunks",
      query: { _id: chunk._id },
    });
    return false;
  }

  const chunkKey = generateChunkKey(policyVersion, chunk.start, chunk.end);

  await mongo({
    action: "updateOne",
    collection: "conversation_chunks",
    query: { _id: chunk._id },
    update: {
      $set: {
        state: "ready",
        chunkKey,
        finalizedAt: new Date(),
      },
    },
  });

  return true;
}

async function createBackfillChunk(
  mongo: MongoFn,
  chunk: PendingChunk,
  params: {
    policyVersion: string;
    jobId?: string;
  },
): Promise<ObjectId> {
  const chunkKey = generateChunkKey(
    params.policyVersion,
    chunk.start,
    chunk.end,
  );
  console.log(
    `[ChunkCreator] createBackfillChunk: chunkKey=${chunkKey}, transcriptionIds=${chunk.transcriptionIds.length}, textLen=${chunk.totalTextLength}`,
  );

  // Check if chunk already exists
  const existing = await mongo({
    action: "findOne",
    collection: "conversation_chunks",
    query: { chunkKey },
  });

  if (existing) {
    console.log(
      `[ChunkCreator] createBackfillChunk: Chunk already exists with id=${existing._id}, reusing`,
    );
    // Mark transcriptions as belonging to existing chunk
    await mongo({
      action: "updateMany",
      collection: "transcriptions",
      query: { _id: { $in: chunk.transcriptionIds } },
      update: { $set: { chunk_id: existing._id } },
    });
    return existing._id;
  }

  console.log(`[ChunkCreator] createBackfillChunk: Creating new chunk`);
  const doc = {
    _id: new ObjectId(),
    chunkKey,
    policyVersion: params.policyVersion,
    start: chunk.start,
    end: chunk.end,
    transcriptionIds: chunk.transcriptionIds,
    transcriptionCount: chunk.transcriptionIds.length,
    totalTextLength: chunk.totalTextLength,
    state: "ready" as ChunkState,
    mode: "backfill" as ChunkMode,
    params: { force: false },
    createdAt: new Date(),
    createdByJobId: params.jobId,
  };

  await mongo({
    action: "insertOne",
    collection: "conversation_chunks",
    doc,
  });
  console.log(
    `[ChunkCreator] createBackfillChunk: Inserted chunk id=${doc._id}`,
  );

  // Mark transcriptions as assigned
  const updateResult = await mongo({
    action: "updateMany",
    collection: "transcriptions",
    query: { _id: { $in: chunk.transcriptionIds } },
    update: { $set: { chunk_id: doc._id } },
  });
  console.log(
    `[ChunkCreator] createBackfillChunk: Marked ${
      updateResult?.modifiedCount ?? "unknown"
    } transcriptions as assigned`,
  );

  return doc._id;
}

// ============================================================================
// Processing Functions
// ============================================================================

async function processStalOpenChunks(
  mongo: MongoFn,
  policyVersion: string,
): Promise<number> {
  const now = Date.now();
  const staleChunks = await findStaleOpenChunks(mongo);

  if (staleChunks.length === 0) {
    return 0;
  }

  console.log(
    `[ChunkCreator] Found ${staleChunks.length} stale chunks to finalize`,
  );
  let finalized = 0;

  for (const chunk of staleChunks) {
    const endAge = chunk.end ? now - chunk.end.getTime() : 0;
    const activityAge = chunk.lastActivityAt
      ? now - chunk.lastActivityAt.getTime()
      : 0;
    console.log(
      `[ChunkCreator] Finalizing chunk ${chunk._id}: ${chunk.transcriptionIds.length} transcriptions (endAge=${
        Math.round(endAge / 1000)
      }s, activityAge=${Math.round(activityAge / 1000)}s)`,
    );
    const wasFinalized = await finalizeChunk(mongo, chunk, policyVersion);
    if (wasFinalized) finalized++;
  }

  return finalized;
}

async function processStreamingTranscriptions(
  mongo: MongoFn,
  gapThresholds: { sparse: number; normal: number; dense: number },
  charThresholds: { sparseMax: number; normalMax: number },
  policyVersion: string,
): Promise<{ streamed: number; chunksFinalized: number }> {
  const transcriptions = await findRecentUnassignedTranscriptions(mongo);
  let streamed = 0;
  let chunksFinalized = 0;
  const now = Date.now();

  if (transcriptions.length === 0) {
    return { streamed: 0, chunksFinalized: 0 };
  }

  console.log(
    `[ChunkCreator] Processing ${transcriptions.length} recent transcriptions...`,
  );

  // Group by original_id for efficient processing
  const byOriginal = new Map<string, Utterance[]>();
  for (const t of transcriptions) {
    const key = t.original?.toString() ?? "__none__";
    if (!byOriginal.has(key)) byOriginal.set(key, []);
    byOriginal.get(key)!.push(t);
  }

  for (const [originalKey, utterances] of byOriginal) {
    const originalId = originalKey === "__none__"
      ? undefined
      : new ObjectId(originalKey);
    console.log(
      `[ChunkCreator] Processing original ${originalKey} with ${utterances.length} utterances`,
    );

    // Sort by start time within this recording
    utterances.sort((a, b) => a.start.getTime() - b.start.getTime());

    let openChunk = await findOrCreateOpenChunk(
      mongo,
      originalId,
      policyVersion,
    );
    console.log(
      `[ChunkCreator] Open chunk for ${originalKey}: id=${openChunk._id}, transcriptions=${openChunk.transcriptionIds.length}, end=${openChunk.end?.toISOString()}`,
    );

    // Check if open chunk is stale by end timestamp (content is old)
    if (openChunk.transcriptionIds.length > 0 && openChunk.end) {
      const chunkAge = now - openChunk.end.getTime();
      if (chunkAge > CHUNK_END_STALENESS_MS) {
        console.log(
          `[ChunkCreator] Open chunk ${openChunk._id} is stale (end is ${
            Math.round(chunkAge / 1000)
          }s old), finalizing before adding new transcriptions`,
        );
        const wasFinalized = await finalizeChunk(
          mongo,
          openChunk,
          policyVersion,
        );
        if (wasFinalized) chunksFinalized++;
        openChunk = await findOrCreateOpenChunk(
          mongo,
          originalId,
          policyVersion,
        );
      }
    }

    for (const transcription of utterances) {
      // Check if gap threshold exceeded → finalize current, create new
      if (openChunk.transcriptionIds.length > 0) {
        const gap = transcription.start.getTime() - openChunk.end.getTime();
        const threshold = allowedGap(
          openChunk.totalTextLength,
          gapThresholds,
          charThresholds,
        );

        console.log(
          `[ChunkCreator] Streaming gap check: gap=${gap}ms, threshold=${threshold}ms, textLen=${openChunk.totalTextLength}`,
        );

        if (gap > threshold) {
          console.log(
            `[ChunkCreator] Gap exceeded, finalizing chunk ${openChunk._id}`,
          );
          const wasFinalized = await finalizeChunk(
            mongo,
            openChunk,
            policyVersion,
          );
          if (wasFinalized) chunksFinalized++;
          openChunk = await findOrCreateOpenChunk(
            mongo,
            originalId,
            policyVersion,
          );
        }
      }

      await appendToChunk(mongo, openChunk, transcription);
      streamed++;
    }
  }

  console.log(
    `[ChunkCreator] processStreamingTranscriptions complete: streamed=${streamed}, chunksFinalized=${chunksFinalized}`,
  );
  return { streamed, chunksFinalized };
}

async function processBackfillBatch(
  mongo: MongoFn,
  gapThresholds: { sparse: number; normal: number; dense: number },
  charThresholds: { sparseMax: number; normalMax: number },
  policyVersion: string,
  jobId?: string,
): Promise<{ backfilled: number; chunksCreated: number }> {
  console.log(`[ChunkCreator] processBackfillBatch starting...`);
  const transcriptions = await findHistoricalUnassignedTranscriptions(mongo);

  if (transcriptions.length === 0) {
    console.log(
      `[ChunkCreator] processBackfillBatch: No unassigned transcriptions found, returning early`,
    );
    return { backfilled: 0, chunksCreated: 0 };
  }

  console.log(
    `[ChunkCreator] processBackfillBatch: Processing ${transcriptions.length} transcriptions`,
  );

  const engine = new ChunkingEngine(gapThresholds, charThresholds);
  let chunksCreated = 0;
  let midLoopChunks = 0;

  for (const t of transcriptions) {
    const pendingChunk = engine.process(t);
    if (pendingChunk) {
      console.log(
        `[ChunkCreator] Mid-loop chunk created with ${pendingChunk.transcriptionIds.length} transcriptions`,
      );
      await createBackfillChunk(mongo, pendingChunk, {
        policyVersion,
        jobId,
      });
      chunksCreated++;
      midLoopChunks++;
    }
  }

  console.log(
    `[ChunkCreator] processBackfillBatch: Loop complete, midLoopChunks=${midLoopChunks}, calling finalize()`,
  );

  // Finalize remaining buffer
  const final = engine.finalize();
  if (final) {
    console.log(
      `[ChunkCreator] Final chunk created with ${final.transcriptionIds.length} transcriptions, textLen=${final.totalTextLength}`,
    );
    await createBackfillChunk(mongo, final, { policyVersion, jobId });
    chunksCreated++;
  } else {
    console.log(
      `[ChunkCreator] finalize() returned null - no remaining content`,
    );
  }

  console.log(
    `[ChunkCreator] processBackfillBatch complete: backfilled=${transcriptions.length}, chunksCreated=${chunksCreated}`,
  );
  return { backfilled: transcriptions.length, chunksCreated };
}

// ============================================================================
// Legacy: Manual Range Processing (for explicit reprocessing)
// ============================================================================

async function* iterateTranscriptionsInRange(
  mongo: MongoFn,
  start: Date,
  end: Date,
): AsyncIterableIterator<Utterance> {
  const cursor = mongoCursor(
    mongo,
    "transcriptions",
    {
      start: { $gte: start, $lt: end },
    },
    {
      sort: { start: -1, _id: -1 }, // Newest first for backwards iteration
      projection: { _id: 1, start: 1, end: 1, segments: 1, original: 1 },
    },
    200,
  );

  for await (const doc of cursor) {
    const text = doc.segments?.map((s: any) => s.text).join("").trim() ?? "";
    yield {
      _id: doc._id,
      original: doc.original,
      start: new Date(doc.start),
      end: new Date(doc.end),
      text,
    };
  }
}

async function processManualRange(
  mongo: MongoFn,
  start: Date,
  end: Date,
  gapThresholds: { sparse: number; normal: number; dense: number },
  charThresholds: { sparseMax: number; normalMax: number },
  policyVersion: string,
  force: boolean,
  maxChunks: number,
  jobId?: string,
): Promise<
  { chunksCreated: number; transcriptionsProcessed: number; hasMore: boolean }
> {
  const engine = new ChunkingEngine(gapThresholds, charThresholds);
  let chunksCreated = 0;
  let transcriptionsProcessed = 0;
  let hasMore = false;

  for await (
    const utterance of iterateTranscriptionsInRange(mongo, start, end)
  ) {
    if (chunksCreated >= maxChunks) {
      hasMore = true;
      break;
    }

    const chunk = engine.process(utterance);

    if (chunk) {
      const chunkKey = generateChunkKey(policyVersion, chunk.start, chunk.end);

      const existing = await mongo({
        action: "findOne",
        collection: "conversation_chunks",
        query: { chunkKey },
      });

      if (!existing || force) {
        if (existing && force) {
          await mongo({
            action: "deleteMany",
            collection: "conversation_chunks",
            query: { chunkKey },
          });
        }

        await createBackfillChunk(mongo, chunk, {
          policyVersion,
          jobId,
        });
        chunksCreated++;
      }
    }

    transcriptionsProcessed++;
  }

  // Finalize remaining buffer
  if (engine.hasContent() && chunksCreated < maxChunks) {
    const chunk = engine.finalize();
    if (chunk) {
      const chunkKey = generateChunkKey(policyVersion, chunk.start, chunk.end);
      const existing = await mongo({
        action: "findOne",
        collection: "conversation_chunks",
        query: { chunkKey },
      });

      if (!existing || force) {
        if (existing && force) {
          await mongo({
            action: "deleteMany",
            collection: "conversation_chunks",
            query: { chunkKey },
          });
        }
        await createBackfillChunk(mongo, chunk, {
          policyVersion,
          jobId,
        });
        chunksCreated++;
      }
    }
  }

  return { chunksCreated, transcriptionsProcessed, hasMore };
}

// ============================================================================
// Main Worker
// ============================================================================

const capability: JobCapability = {
  name: "conversation_chunk_creator",
  inputSchema: z.toJSONSchema(schema, { io: "input" }),
  outputSchema: z.toJSONSchema(z.object({
    status: z.literal("success"),
    finalized: z.number(),
    streamed: z.number(),
    backfilled: z.number(),
    chunksCreated: z.number(),
    processed: z.number(),
    hasMore: z.boolean(),
  })),
  policies: [
    { resource: "db/transcriptions", action: "read", effect: "allow" },
    { resource: "db/transcriptions", action: "update", effect: "allow" },
    { resource: "db/conversation_chunks", action: "read", effect: "allow" },
    { resource: "db/conversation_chunks", action: "write", effect: "allow" },
    { resource: "db/conversation_chunks", action: "update", effect: "allow" },
    { resource: "db/conversation_chunks", action: "delete", effect: "allow" },
  ],
  maxConcurrency: 1,
  hasPendingWork: ({ mongo }) => hasPendingConversationChunkWork(mongo),
  use: async (job) => {
    const data = job.data as ConversationChunkCreatorJobData;

    const jwt = Deno.env.get("MYCELIA_JWT")!;
    const myceliaUrl = Deno.env.get("MYCELIA_URL")!;
    const mongo: MongoFn = (input: any) =>
      callResource("mongo", input, { jwt, myceliaUrl });

    const gapThresholds = data.gapThresholds ??
      { sparse: 45 * 60 * 1000, normal: 5 * 60 * 1000, dense: 40 * 1000 };
    const charThresholds = data.charThresholds ??
      { sparseMax: 500, normalMax: 20000 };
    const policyVersion = data.policyVersion ?? "v1";
    // `model` remains accepted for historical job restart compatibility, but
    // chunk creation performs no inference and intentionally ignores it.
    const mode = data.mode ?? "auto";
    const force = data.force ?? false;

    // ─────────────────────────────────────────────────────────────────────────
    // Manual range mode: explicit reprocessing of a time range
    // ─────────────────────────────────────────────────────────────────────────
    if (data.start && data.end) {
      console.log(
        `[ChunkCreator] Using MANUAL RANGE mode: ${data.start} to ${data.end}`,
      );
      const result = await processManualRange(
        mongo,
        new Date(data.start),
        new Date(data.end),
        gapThresholds,
        charThresholds,
        policyVersion,
        force,
        data.maxChunks ?? Infinity,
        job.id,
      );

      console.log(`[ChunkCreator] Manual range result:`, result);
      return {
        status: "success" as const,
        finalized: 0,
        streamed: 0,
        backfilled: result.transcriptionsProcessed,
        chunksCreated: result.chunksCreated,
        processed: result.transcriptionsProcessed,
        hasMore: result.hasMore,
      };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Auto mode: Priority-based streaming + backfill
    // ─────────────────────────────────────────────────────────────────────────
    let totalFinalized = 0;
    let totalStreamed = 0;
    let totalBackfilled = 0;
    let totalChunksCreated = 0;

    // Priority 1: Finalize stale open chunks (gap timeout reached)
    await job.updateProgress({ stage: "finalizing_stale" });
    const finalized = await processStalOpenChunks(mongo, policyVersion);
    totalFinalized = finalized;
    totalChunksCreated += finalized;
    if (finalized > 0) {
      console.log(`[ChunkCreator] Finalized ${finalized} stale chunks`);
    }

    // Priority 2: Stream recent unassigned transcriptions
    if (mode === "auto" || mode === "streaming") {
      await job.updateProgress({
        stage: "streaming",
        finalized: totalFinalized,
      });
      const streamResult = await processStreamingTranscriptions(
        mongo,
        gapThresholds,
        charThresholds,
        policyVersion,
      );
      totalStreamed = streamResult.streamed;
      totalChunksCreated += streamResult.chunksFinalized;
      if (streamResult.streamed > 0 || streamResult.chunksFinalized > 0) {
        console.log(
          `[ChunkCreator] Streamed ${streamResult.streamed} transcriptions, finalized ${streamResult.chunksFinalized} chunks`,
        );
      }
    }

    // Priority 3: Backfill historical data (only if streaming is caught up)
    const shouldBackfill = (mode === "auto" && totalStreamed === 0) ||
      mode === "backfill";

    if (shouldBackfill) {
      await job.updateProgress({
        stage: "backfilling",
        finalized: totalFinalized,
        streamed: totalStreamed,
      });
      const backfillResult = await processBackfillBatch(
        mongo,
        gapThresholds,
        charThresholds,
        policyVersion,
        job.id,
      );
      totalBackfilled = backfillResult.backfilled;
      totalChunksCreated += backfillResult.chunksCreated;
      if (backfillResult.backfilled > 0 || backfillResult.chunksCreated > 0) {
        console.log(
          `[ChunkCreator] Backfilled ${backfillResult.backfilled} transcriptions, created ${backfillResult.chunksCreated} chunks`,
        );
      }
    }

    const hasMore = await hasPendingConversationChunkWork(mongo);

    const result = {
      status: "success" as const,
      finalized: totalFinalized,
      streamed: totalStreamed,
      backfilled: totalBackfilled,
      chunksCreated: totalChunksCreated,
      processed: totalFinalized + totalStreamed + totalBackfilled,
      hasMore,
    };

    // Only log if there was actual work done
    if (
      totalFinalized > 0 || totalStreamed > 0 || totalBackfilled > 0 ||
      totalChunksCreated > 0
    ) {
      console.log(
        `[ChunkCreator] Job ${job.id} complete: finalized=${totalFinalized}, streamed=${totalStreamed}, backfilled=${totalBackfilled}, chunks=${totalChunksCreated}`,
      );
    }

    return result;
  },
  triggers: {
    sources: [
      {
        channel: "mycelia:mongo:transcriptions",
        name: "new_transcription",
        filter: {
          event: "mongo.change",
          "data.operationType": "insert",
        },
      },
    ],
    ...getTriggerTiming("conversation_chunk_creator"),
  },
};

export default capability;
