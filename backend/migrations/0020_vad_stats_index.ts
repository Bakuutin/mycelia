import type { Db } from "mongodb";
import { ensureIndexExists } from "@/utils/migrations.ts";

export const up = async (db: Db) => {
  console.log("Creating VAD processed statistics index on audio_chunks...");

  await ensureIndexExists(
    db,
    "audio_chunks",
    { "vad.ran_at": -1 },
    {
      name: "audio_chunks_vad_processed",
      partialFilterExpression: {
        "vad.ran_at": { $exists: true },
      },
    },
  );

  console.log("Created VAD processed statistics index");
};

export const down = async (db: Db) => {
  const collection = db.collection("audio_chunks");
  const exists = await collection.indexExists("audio_chunks_vad_processed");

  if (exists) {
    await collection.dropIndex("audio_chunks_vad_processed");
  }
};
