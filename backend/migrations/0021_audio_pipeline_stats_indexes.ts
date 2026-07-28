import type { Db } from "mongodb";
import { ensureIndexExists } from "@/utils/migrations.ts";

export const up = async (db: Db) => {
  console.log("Creating audio pipeline statistics indexes...");

  await ensureIndexExists(
    db,
    "audio_chunks",
    {
      "vad.has_speech": 1,
      transcribed_at: 1,
      transcription_sequence_id: 1,
    },
    {
      name: "audio_chunks_sequence_pending_stats",
      partialFilterExpression: {
        "vad.has_speech": true,
        transcribed_at: null,
      },
    },
  );

  await ensureIndexExists(
    db,
    "audio_chunks",
    {
      original_id: 1,
      "vad.ran_at": 1,
      "vad.has_speech": 1,
    },
    { name: "audio_chunks_pipeline_source_stats" },
  );

  console.log("Created audio pipeline statistics indexes");
};

export const down = async (db: Db) => {
  const collection = db.collection("audio_chunks");

  for (
    const name of [
      "audio_chunks_sequence_pending_stats",
      "audio_chunks_pipeline_source_stats",
    ]
  ) {
    if (await collection.indexExists(name)) {
      await collection.dropIndex(name);
    }
  }
};
