import type { Db } from "mongodb";
import { ensureIndexExists } from "@/utils/migrations.ts";

const INDEXES = [
  ["source_files", { updatedAt: -1, start: -1 }, "pipeline_recent_sources"],
  ["transcriptions", { original: 1, start: 1 }, "pipeline_source_transcriptions"],
  [
    "objects",
    { isConversation: 1, "metadata.extractedWith.chunkId": 1, createdAt: -1 },
    "pipeline_source_conversations",
  ],
  [
    "jobs",
    { type: 1, dismissedAt: 1, updatedAt: -1, createdAt: -1 },
    "pipeline_job_state",
  ],
  [
    "diarizations",
    { lifecycleStatus: 1, "speakerIdentity.identityState": 1 },
    "pipeline_speaker_identity_state",
  ],
] as const;

export async function up(db: Db): Promise<void> {
  for (const [collection, keys, name] of INDEXES) {
    await ensureIndexExists(db, collection, keys, { name });
  }
}

export async function down(db: Db): Promise<void> {
  for (const [collection, _keys, name] of [...INDEXES].reverse()) {
    if (await db.collection(collection).indexExists(name)) {
      await db.collection(collection).dropIndex(name);
    }
  }
}
