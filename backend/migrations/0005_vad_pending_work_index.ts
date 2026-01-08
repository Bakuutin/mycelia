import type { Db } from "mongodb";
import { ensureIndexExists } from "@/utils/migrations.ts";

export const up = async (db: Db) => {
  console.log("Creating VAD pending work index on audio_chunks...");

  await ensureIndexExists(
    db,
    "audio_chunks",
    {
      start: -1,
    },
    {
      name: "audio_chunks_vad_pending_work",
      partialFilterExpression: {
        vad: null,
      },
    },
  );

  console.log("Created VAD pending work index");
};

export const down = async (db: Db) => {
  const collection = db.collection("audio_chunks");
  const exists = await collection.indexExists("audio_chunks_vad_pending_work");

  if (exists) {
    await collection.dropIndex("audio_chunks_vad_pending_work");
  }
};
