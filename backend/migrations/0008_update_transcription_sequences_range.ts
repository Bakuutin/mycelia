import { Db, MongoClient } from "mongodb";

async function ensureIndexExists(
  db: Db,
  collectionName: string,
  indexSpec: any,
  options: any = {},
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

export async function up(db: Db, _client: MongoClient): Promise<void> {
  console.log("Running migration 0008: Updating transcription_sequences to use range indices...");

  // We are switching from chunk_ids array to fromIndex/toIndex range
  // Existing data in transcription_sequences can be dropped or migrated. 
  // Since this is likely still in development, we'll just ensure the new indexes exist.
  
  await ensureIndexExists(
    db,
    "transcription_sequences",
    { original_id: 1, fromIndex: 1, toIndex: 1 },
    { name: "original_id_range" },
  );

  // Remove old index if it exists
  try {
    await db.collection("transcription_sequences").dropIndex("original_id_state_start");
  } catch (e) {
    // Ignore if not found
  }
}

export async function down(db: Db, _client: MongoClient): Promise<void> {
  console.log("Rolling back migration 0008: Removing range index...");
  await db.collection("transcription_sequences").dropIndex("original_id_range");
}


