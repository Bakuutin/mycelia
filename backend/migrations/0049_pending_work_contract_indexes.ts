import type { Db, IndexSpecification } from "mongodb";
import { ensureIndexExists } from "@/utils/migrations.ts";

const INDEXES: Array<{
  collection: string;
  keys: IndexSpecification;
  name: string;
  partialFilterExpression?: Record<string, unknown>;
}> = [
  {
    collection: "transcriptions",
    keys: { chunk_id: 1, start: -1 },
    name: "transcriptions_unassigned_start_v1",
  },
  {
    collection: "transcription_sequences",
    keys: { state: 1, updatedAt: 1, start: -1 },
    name: "transcription_sequences_claimable_work_v1",
  },
  {
    collection: "conversation_chunks",
    keys: { state: 1, extractionRetryAfter: 1, start: -1 },
    name: "conversation_chunks_retryable_extraction_v1",
  },
  {
    collection: "conversation_chunks",
    keys: { state: 1, processingStartedAt: 1, start: -1 },
    name: "conversation_chunks_stale_extraction_v1",
  },
  {
    collection: "objects",
    keys: {
      isConversation: 1,
      "metadata.aiProvenance.taggingRuns.0.generatedAt": 1,
    },
    name: "conversation_missing_tagging_marker_v1",
    partialFilterExpression: { isConversation: true },
  },
];

export async function up(db: Db): Promise<void> {
  for (const index of INDEXES) {
    await ensureIndexExists(db, index.collection, index.keys, {
      name: index.name,
      ...(index.partialFilterExpression
        ? { partialFilterExpression: index.partialFilterExpression }
        : {}),
    });
  }
}

export async function down(db: Db): Promise<void> {
  for (const index of [...INDEXES].reverse()) {
    if (await db.collection(index.collection).indexExists(index.name)) {
      await db.collection(index.collection).dropIndex(index.name);
    }
  }
}
