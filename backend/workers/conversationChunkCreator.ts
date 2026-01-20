import { z } from "zod";
import { ObjectId } from "bson";
import type { JobCapability } from "@/lib/jobs/job-registry.ts";
import { callResource } from "@myceliasdk/resources.ts";
import { zDateOrString } from "@myceliasdk/zod-json-schema.ts";
import { mongoCursor } from "@/lib/mongo/cursor.ts";
import { createHash } from "node:crypto";

// ============================================================================
// Types
// ============================================================================

interface Utterance {
  _id: ObjectId;
  start: Date;
  end: Date;
  text: string;
}

interface PendingChunk {
  start: Date;
  end: Date;
  transcriptionIds: ObjectId[];
  totalTextLength: number;
}

type ChunkState = "open" | "ready" | "processing" | "completed" | "error" | "empty";

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

const scanSpecSchema = z.object({
  mode: z.enum(["range", "cursor"]).default("range"),
  after: z.object({
    start: zDateOrString(),
    _id: z.string(),
  }).optional(),
  maxLookbackMs: z.number().default(5 * 60 * 1000),      // 5 min
  watermarkDelayMs: z.number().default(60 * 1000),       // 60 sec
});

export const schema = z.object({
  type: z.literal("conversation_chunk_creator"),
  start: zDateOrString().optional(),
  end: zDateOrString().optional(),
  scan: scanSpecSchema.default({
    mode: "range",
    maxLookbackMs: 5 * 60 * 1000,
    watermarkDelayMs: 60 * 1000,
  }),
  gapThresholds: gapThresholdsSchema.default({
    sparse: 45 * 60 * 1000,
    normal: 5 * 60 * 1000,
    dense: 40 * 1000,
  }),
  charThresholds: charThresholdsSchema.default({
    sparseMax: 500,
    normalMax: 20000,
  }),
  policyVersion: z.string().default("v1"),
  model: z.enum(["small", "medium", "large"]).default("small"),
  force: z.boolean().default(false),
  maxChunks: z.number().optional(),
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
// Chunking Engine
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

async function checkChunkExists(
  mongo: (input: any) => Promise<any>,
  chunkKey: string,
): Promise<boolean> {
  const existing = await mongo({
    action: "findOne",
    collection: "conversation_chunks",
    query: { chunkKey },
  });
  return existing !== null;
}

async function createChunk(
  mongo: (input: any) => Promise<any>,
  chunk: PendingChunk,
  params: {
    chunkKey: string;
    policyVersion: string;
    model: string;
    force: boolean;
    jobId?: string;
    state: ChunkState;
  },
): Promise<ObjectId> {
  const doc = {
    _id: new ObjectId(),
    chunkKey: params.chunkKey,
    policyVersion: params.policyVersion,
    start: chunk.start,
    end: chunk.end,
    transcriptionIds: chunk.transcriptionIds,
    transcriptionCount: chunk.transcriptionIds.length,
    totalTextLength: chunk.totalTextLength,
    state: params.state,
    params: {
      model: params.model,
      force: params.force,
    },
    createdAt: new Date(),
    createdByJobId: params.jobId,
  };

  await mongo({
    action: "insertOne",
    collection: "conversation_chunks",
    doc,
  });

  return doc._id;
}

async function loadCheckpoint(
  mongo: (input: any) => Promise<any>,
  jobName: string,
): Promise<{ start: Date; _id: string } | null> {
  const doc = await mongo({
    action: "findOne",
    collection: "checkpoints",
    query: { _id: jobName },
  });
  return doc?.cursor ?? null;
}

async function saveCheckpoint(
  mongo: (input: any) => Promise<any>,
  jobName: string,
  cursor: { start: Date; _id: string },
): Promise<void> {
  await mongo({
    action: "updateOne",
    collection: "checkpoints",
    query: { _id: jobName },
    update: {
      $set: {
        cursor,
        updatedAt: new Date(),
      },
    },
    options: { upsert: true },
  });
}

// ============================================================================
// Main Worker
// ============================================================================

async function* iterateTranscriptions(
  mongo: (input: any) => Promise<any>,
  scan: z.infer<typeof scanSpecSchema>,
  start?: string | Date,
  end?: string | Date,
): AsyncIterableIterator<Utterance> {
  const query: any = {};
  
  if (scan.mode === "range") {
    if (start) query.start = { ...query.start, $gte: new Date(start) };
    if (end) query.start = { ...query.start, $lt: new Date(end) };
  } else if (scan.mode === "cursor" && scan.after) {
    // Cursor mode: resume from checkpoint
    query.$or = [
      { start: { $lt: new Date(scan.after.start) } },
      { start: new Date(scan.after.start), _id: { $lt: new ObjectId(scan.after._id) } },
    ];
  }

  const cursor = mongoCursor(
    mongo,
    "transcriptions",
    query,
    {
      sort: { start: -1, _id: -1 },  // Newest first for backwards iteration
      projection: { _id: 1, start: 1, end: 1, segments: 1 },
    },
    200,
  );

  for await (const doc of cursor) {
    const text = doc.segments?.map((s: any) => s.text).join("").trim() ?? "";
    yield {
      _id: doc._id,
      start: new Date(doc.start),
      end: new Date(doc.end),
      text,
    };
  }
}

const capability: JobCapability = {
  name: "conversation_chunk_creator",
  inputSchema: z.toJSONSchema(schema),
  outputSchema: z.toJSONSchema(z.object({
    status: z.literal("success"),
    chunksCreated: z.number(),
    transcriptionsProcessed: z.number(),
    hasMore: z.boolean(),
  })),
  policies: [
    { resource: "db/transcriptions", action: "read", effect: "allow" },
    { resource: "db/conversation_chunks", action: "read", effect: "allow" },
    { resource: "db/conversation_chunks", action: "write", effect: "allow" },
    { resource: "db/checkpoints", action: "read", effect: "allow" },
    { resource: "db/checkpoints", action: "write", effect: "allow" },
  ],
  maxConcurrency: 1,
  use: async (job) => {
    const data = job.data as ConversationChunkCreatorJobData;
    const jwt = Deno.env.get("MYCELIA_JWT")!;
    const myceliaUrl = Deno.env.get("MYCELIA_URL")!;
    const mongo = (input: any) => callResource("mongo", input, { jwt, myceliaUrl });

    // Resolve scan spec
    const scan = { ...data.scan };
    if (scan.mode === "cursor" && !scan.after) {
      const checkpoint = await loadCheckpoint(mongo, "conversation_chunk_creator");
      if (checkpoint) {
        scan.after = checkpoint;
      }
    }

    const engine = new ChunkingEngine(
      data.gapThresholds ?? { sparse: 45 * 60 * 1000, normal: 5 * 60 * 1000, dense: 40 * 1000 },
      data.charThresholds ?? { sparseMax: 500, normalMax: 20000 },
    );

    let chunksCreated = 0;
    let transcriptionsProcessed = 0;
    let lastUtterance: Utterance | null = null;
    let hasMore = false;

    const hasRange = Boolean(data.start || data.end);
    const maxChunks = data.maxChunks ?? (hasRange ? Infinity : 5);

    for await (const utterance of iterateTranscriptions(mongo, scan, data.start, data.end)) {
      if (chunksCreated >= maxChunks) {
        hasMore = true;
        break;
      }

      const chunk = engine.process(utterance);
      
      if (chunk) {
        const chunkKey = generateChunkKey(data.policyVersion, chunk.start, chunk.end);
        
        // Check idempotency
        const exists = await checkChunkExists(mongo, chunkKey);
        if (!exists || data.force) {
          if (exists && data.force) {
            // Delete existing chunk if force
            await mongo({
              action: "deleteMany",
              collection: "conversation_chunks",
              query: { chunkKey },
            });
          }
          
          await createChunk(mongo, chunk, {
            chunkKey,
            policyVersion: data.policyVersion,
            model: data.model,
            force: data.force,
            jobId: job.id,
            state: "ready",
          });
          chunksCreated++;
        }
      }

      transcriptionsProcessed++;
      lastUtterance = utterance;

      if (transcriptionsProcessed % 100 === 0) {
        await job.updateProgress({
          stage: "scanning",
          transcriptionsProcessed,
          chunksCreated,
        });
      }
    }

    // Finalize remaining buffer
    if (engine.hasContent()) {
      const chunk = engine.finalize();
      if (chunk && chunksCreated < maxChunks) {
        const chunkKey = generateChunkKey(data.policyVersion, chunk.start, chunk.end);
        const exists = await checkChunkExists(mongo, chunkKey);
        if (!exists || data.force) {
          if (exists && data.force) {
            await mongo({
              action: "deleteMany",
              collection: "conversation_chunks",
              query: { chunkKey },
            });
          }
          await createChunk(mongo, chunk, {
            chunkKey,
            policyVersion: data.policyVersion,
            model: data.model,
            force: data.force,
            jobId: job.id,
            state: "ready",
          });
          chunksCreated++;
        }
      }
    }

    // Save checkpoint for cursor mode
    if (scan.mode === "cursor" && lastUtterance) {
      await saveCheckpoint(mongo, "conversation_chunk_creator", {
        start: lastUtterance.start,
        _id: lastUtterance._id.toString(),
      });
    }

    return {
      status: "success",
      chunksCreated,
      transcriptionsProcessed,
      hasMore,
    };
  },
  // No triggers - manual only by default
};

export default capability;
