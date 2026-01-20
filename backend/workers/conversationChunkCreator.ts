import { z } from "zod";
import { ObjectId } from "bson";
import type { JobCapability } from "@/lib/jobs/job-registry.ts";
import { callResource } from "@myceliasdk/resources.ts";
import { zDateOrString } from "@myceliasdk/zod-json-schema.ts";
import { mongoCursor } from "@/lib/mongo/cursor.ts";
import { createHash } from "node:crypto";

// ============================================================================
// Constants
// ============================================================================

const GAP_TIMEOUT_MS = 60 * 1000;           // 60s silence = finalize open chunk
const RECENT_WINDOW_MS = 5 * 60 * 1000;     // Last 5 min = "recent" (streaming mode)
const BACKFILL_BATCH_SIZE = 100;            // Max transcriptions per backfill batch
const MAX_OPEN_CHUNKS_PER_RUN = 10;         // Max open chunks to finalize per run
const MAX_STREAMING_PER_RUN = 50;           // Max transcriptions to stream per run

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

type ChunkState = "open" | "ready" | "processing" | "completed" | "error" | "empty";
type ChunkMode = "streaming" | "backfill";

// ============================================================================
// Schema
// ============================================================================

const gapThresholdsSchema = z.object({
  sparse: z.number().default(45 * 60 * 1000),  // 45 min
  normal: z.number().default(5 * 60 * 1000),   // 5 min
  dense: z.number().default(40 * 1000),        // 40 sec
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
  
  constructor(
    private gapThresholds: { sparse: number; normal: number; dense: number },
    private charThresholds: { sparseMax: number; normalMax: number },
  ) {}

  /** 
   * Process a transcription (coming in reverse chronological order).
   * Returns a chunk if one should be finalized, otherwise null.
   */
  process(utterance: Utterance): PendingChunk | null {
    let result: PendingChunk | null = null;

    if (this.buffer.length > 0 && this.lastTimestamp) {
      // Gap is from current utterance's end to the last buffered utterance's start
      // Since we're going backwards: lastTimestamp is more recent, utterance is older
      const gap = this.lastTimestamp.getTime() - new Date(utterance.end).getTime();
      const threshold = allowedGap(this.totalTextLength, this.gapThresholds, this.charThresholds);

      if (this.totalTextLength > 100 && gap > threshold) {
        result = this.finalize();
      }
    }

    this.buffer.push(utterance);
    this.totalTextLength += utterance.text.length;
    this.lastTimestamp = new Date(utterance.start);

    return result;
  }

  /** Finalize current buffer into a chunk */
  finalize(): PendingChunk | null {
    if (this.buffer.length === 0) return null;

    // Buffer is in reverse chronological order, sort to chronological
    const sorted = [...this.buffer].sort((a, b) => 
      new Date(a.start).getTime() - new Date(b.start).getTime()
    );

    const chunk: PendingChunk = {
      start: new Date(sorted[0].start),
      end: new Date(sorted[sorted.length - 1].end),
      transcriptionIds: sorted.map(u => u._id),
      totalTextLength: this.totalTextLength,
    };

    this.buffer = [];
    this.totalTextLength = 0;
    this.lastTimestamp = null;

    return chunk;
  }

  hasContent(): boolean {
    return this.buffer.length > 0;
  }
}

// ============================================================================
// Database Operations
// ============================================================================

type MongoFn = (input: any) => Promise<any>;

async function findStaleOpenChunks(mongo: MongoFn): Promise<OpenChunk[]> {
  return await mongo({
    action: "find",
    collection: "conversation_chunks",
    query: {
      state: "open",
      lastActivityAt: { $lt: new Date(Date.now() - GAP_TIMEOUT_MS) },
    },
    options: { limit: MAX_OPEN_CHUNKS_PER_RUN },
  }) as OpenChunk[];
}

async function findRecentUnassignedTranscriptions(mongo: MongoFn): Promise<Utterance[]> {
  const docs = await mongo({
    action: "find",
    collection: "transcriptions",
    query: {
      chunk_id: { $exists: false },
      createdAt: { $gte: new Date(Date.now() - RECENT_WINDOW_MS) },
    },
    options: { 
      sort: { start: 1 },  // Oldest first within recent window
      limit: MAX_STREAMING_PER_RUN,
    },
  }) as any[];
  
  return docs.map(doc => ({
    _id: doc._id,
    original: doc.original,
    start: new Date(doc.start),
    end: new Date(doc.end),
    text: doc.segments?.map((s: any) => s.text).join("").trim() ?? doc.text ?? "",
    createdAt: doc.createdAt ? new Date(doc.createdAt) : undefined,
  }));
}

async function findHistoricalUnassignedTranscriptions(mongo: MongoFn): Promise<Utterance[]> {
  const docs = await mongo({
    action: "find",
    collection: "transcriptions",
    query: {
      chunk_id: { $exists: false },
      createdAt: { $lt: new Date(Date.now() - RECENT_WINDOW_MS) },
    },
    options: { 
      sort: { start: -1 },  // Newest historical first (work backwards)
      limit: BACKFILL_BATCH_SIZE,
    },
  }) as any[];
  
  return docs.map(doc => ({
    _id: doc._id,
    original: doc.original,
    start: new Date(doc.start),
    end: new Date(doc.end),
    text: doc.segments?.map((s: any) => s.text).join("").trim() ?? doc.text ?? "",
    createdAt: doc.createdAt ? new Date(doc.createdAt) : undefined,
  }));
}

async function findOrCreateOpenChunk(
  mongo: MongoFn,
  originalId: ObjectId | undefined,
  policyVersion: string,
  model: string,
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
      params: { model, force: false },
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
  const isFirst = chunk.transcriptionIds.length === 0;
  
  const update: any = {
    $push: { transcriptionIds: transcription._id },
    $inc: { 
      totalTextLength: transcription.text.length,
      transcriptionCount: 1,
    },
    $set: { 
      end: transcription.end,
      lastActivityAt: new Date(),
    },
  };
  
  if (isFirst) {
    update.$set.start = transcription.start;
  }

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
  chunk.end = transcription.end;
  if (isFirst) {
    chunk.start = transcription.start;
  }
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
    model: string;
    jobId?: string;
  },
): Promise<ObjectId> {
  const chunkKey = generateChunkKey(params.policyVersion, chunk.start, chunk.end);
  
  // Check if chunk already exists
  const existing = await mongo({
    action: "findOne",
    collection: "conversation_chunks",
    query: { chunkKey },
  });
  
  if (existing) {
    // Mark transcriptions as belonging to existing chunk
    await mongo({
      action: "updateMany",
      collection: "transcriptions",
      query: { _id: { $in: chunk.transcriptionIds } },
      update: { $set: { chunk_id: existing._id } },
    });
    return existing._id;
  }

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
    params: {
      model: params.model,
      force: false,
    },
    createdAt: new Date(),
    createdByJobId: params.jobId,
  };

  await mongo({
    action: "insertOne",
    collection: "conversation_chunks",
    doc,
  });

  // Mark transcriptions as assigned
  await mongo({
    action: "updateMany",
    collection: "transcriptions",
    query: { _id: { $in: chunk.transcriptionIds } },
    update: { $set: { chunk_id: doc._id } },
  });

  return doc._id;
}

// ============================================================================
// Processing Functions
// ============================================================================

async function processStalOpenChunks(
  mongo: MongoFn,
  policyVersion: string,
): Promise<number> {
  const staleChunks = await findStaleOpenChunks(mongo);
  let finalized = 0;
  
  for (const chunk of staleChunks) {
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
  model: string,
): Promise<{ streamed: number; chunksFinalized: number }> {
  const transcriptions = await findRecentUnassignedTranscriptions(mongo);
  let streamed = 0;
  let chunksFinalized = 0;
  
  // Group by original_id for efficient processing
  const byOriginal = new Map<string, Utterance[]>();
  for (const t of transcriptions) {
    const key = t.original?.toString() ?? "__none__";
    if (!byOriginal.has(key)) byOriginal.set(key, []);
    byOriginal.get(key)!.push(t);
  }
  
  for (const [originalKey, utterances] of byOriginal) {
    const originalId = originalKey === "__none__" ? undefined : new ObjectId(originalKey);
    
    // Sort by start time within this recording
    utterances.sort((a, b) => a.start.getTime() - b.start.getTime());
    
    let openChunk = await findOrCreateOpenChunk(mongo, originalId, policyVersion, model);
    
    for (const transcription of utterances) {
      // Check if gap threshold exceeded → finalize current, create new
      if (openChunk.transcriptionIds.length > 0) {
        const gap = transcription.start.getTime() - openChunk.end.getTime();
        const threshold = allowedGap(openChunk.totalTextLength, gapThresholds, charThresholds);
        
        if (gap > threshold) {
          const wasFinalized = await finalizeChunk(mongo, openChunk, policyVersion);
          if (wasFinalized) chunksFinalized++;
          openChunk = await findOrCreateOpenChunk(mongo, originalId, policyVersion, model);
        }
      }
      
      await appendToChunk(mongo, openChunk, transcription);
      streamed++;
    }
  }
  
  return { streamed, chunksFinalized };
}

async function processBackfillBatch(
  mongo: MongoFn,
  gapThresholds: { sparse: number; normal: number; dense: number },
  charThresholds: { sparseMax: number; normalMax: number },
  policyVersion: string,
  model: string,
  jobId?: string,
): Promise<{ backfilled: number; chunksCreated: number }> {
  const transcriptions = await findHistoricalUnassignedTranscriptions(mongo);
  
  if (transcriptions.length === 0) {
    return { backfilled: 0, chunksCreated: 0 };
  }
  
  const engine = new ChunkingEngine(gapThresholds, charThresholds);
  let chunksCreated = 0;
  
  for (const t of transcriptions) {
    const pendingChunk = engine.process(t);
    if (pendingChunk) {
      await createBackfillChunk(mongo, pendingChunk, { policyVersion, model, jobId });
      chunksCreated++;
    }
  }
  
  // Finalize remaining buffer
  const final = engine.finalize();
  if (final) {
    await createBackfillChunk(mongo, final, { policyVersion, model, jobId });
    chunksCreated++;
  }
  
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
      sort: { start: -1, _id: -1 },  // Newest first for backwards iteration
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
  model: string,
  force: boolean,
  maxChunks: number,
  jobId?: string,
): Promise<{ chunksCreated: number; transcriptionsProcessed: number; hasMore: boolean }> {
  const engine = new ChunkingEngine(gapThresholds, charThresholds);
  let chunksCreated = 0;
  let transcriptionsProcessed = 0;
  let hasMore = false;

  for await (const utterance of iterateTranscriptionsInRange(mongo, start, end)) {
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
        
        await createBackfillChunk(mongo, chunk, { policyVersion, model, jobId });
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
        await createBackfillChunk(mongo, chunk, { policyVersion, model, jobId });
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
  inputSchema: z.toJSONSchema(schema),
  outputSchema: z.toJSONSchema(z.object({
    status: z.literal("success"),
    finalized: z.number(),
    streamed: z.number(),
    backfilled: z.number(),
    chunksCreated: z.number(),
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
  use: async (job) => {
    const data = job.data as ConversationChunkCreatorJobData;
    const jwt = Deno.env.get("MYCELIA_JWT")!;
    const myceliaUrl = Deno.env.get("MYCELIA_URL")!;
    const mongo: MongoFn = (input: any) => callResource("mongo", input, { jwt, myceliaUrl });

    const gapThresholds = data.gapThresholds ?? { sparse: 45 * 60 * 1000, normal: 5 * 60 * 1000, dense: 40 * 1000 };
    const charThresholds = data.charThresholds ?? { sparseMax: 500, normalMax: 20000 };
    const policyVersion = data.policyVersion ?? "v1";
    const model = data.model ?? "medium";
    const mode = data.mode ?? "auto";
    const force = data.force ?? false;

    // ─────────────────────────────────────────────────────────────────────────
    // Manual range mode: explicit reprocessing of a time range
    // ─────────────────────────────────────────────────────────────────────────
    if (data.start && data.end) {
      const result = await processManualRange(
        mongo,
        new Date(data.start),
        new Date(data.end),
        gapThresholds,
        charThresholds,
        policyVersion,
        model,
        force,
        data.maxChunks ?? Infinity,
        job.id,
      );
      
      return {
        status: "success" as const,
        finalized: 0,
        streamed: 0,
        backfilled: result.transcriptionsProcessed,
        chunksCreated: result.chunksCreated,
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

    // Priority 2: Stream recent unassigned transcriptions
    if (mode === "auto" || mode === "streaming") {
      await job.updateProgress({ stage: "streaming", finalized: totalFinalized });
      const streamResult = await processStreamingTranscriptions(
        mongo,
        gapThresholds,
        charThresholds,
        policyVersion,
        model,
      );
      totalStreamed = streamResult.streamed;
      totalChunksCreated += streamResult.chunksFinalized;
    }

    // Priority 3: Backfill historical data (only if streaming is caught up)
    if ((mode === "auto" && totalStreamed === 0) || mode === "backfill") {
      await job.updateProgress({ stage: "backfilling", finalized: totalFinalized, streamed: totalStreamed });
      const backfillResult = await processBackfillBatch(
        mongo,
        gapThresholds,
        charThresholds,
        policyVersion,
        model,
        job.id,
      );
      totalBackfilled = backfillResult.backfilled;
      totalChunksCreated += backfillResult.chunksCreated;
    }

    const hasMore = totalStreamed > 0 || totalBackfilled > 0 || totalFinalized > 0;

    return {
      status: "success" as const,
      finalized: totalFinalized,
      streamed: totalStreamed,
      backfilled: totalBackfilled,
      chunksCreated: totalChunksCreated,
      hasMore,
    };
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
    debounceMs: 2000,   // Quick response for streaming (2s)
    interval: 30,       // Also check every 30s for stale chunks & backfill
  },
};

export default capability;
