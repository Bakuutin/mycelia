import type { Db } from "mongodb";
import { ensureIndexExists } from "@/utils/migrations.ts";

const INDEX_NAME = "audio_chunks_terminal_marker_repair";

export const up = async (db: Db) => {
  await ensureIndexExists(
    db,
    "audio_chunks",
    { transcription_sequence_id: 1, transcribed_at: 1 },
    {
      name: INDEX_NAME,
    },
  );
};

export const down = async (db: Db) => {
  const collection = db.collection("audio_chunks");
  if (await collection.indexExists(INDEX_NAME)) {
    await collection.dropIndex(INDEX_NAME);
  }
};
