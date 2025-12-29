import type { Db } from "mongodb";
import type { CreateIndexesOptions, IndexSpecification } from "mongodb";

async function ensureIndexExists(
  db: Db,
  collectionName: string,
  indexSpec: IndexSpecification,
  options: CreateIndexesOptions = {},
): Promise<void> {
  const collection = db.collection(collectionName);
  const indexName: string = options.name as string;

  const exists = await collection.indexExists(indexName);

  if (exists) {
    return;
  }

  try {
    await collection.createIndex(indexSpec, options);
    console.log(
      `Created index on ${collectionName}: ${
        indexName || JSON.stringify(indexSpec)
      }`,
    );
  } catch (error) {
    if (
      error instanceof Error && error.message.includes("Index already exists")
    ) {
      return;
    }
    throw error;
  }
}

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

