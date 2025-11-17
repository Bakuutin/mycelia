import { Db } from "mongodb";
import type { CreateIndexesOptions, IndexSpecification } from "mongodb";
import { getRootDB } from "./core.server.ts";
import type { Resolution } from "@/types/resolution.ts";
import { RESOLUTION_ORDER } from "@/types/resolution.ts";

export const REGULAR_COLLECTIONS = [
  "api_keys",
  "audio_chunks",
  "transcriptions",
  "diarizations",
  "source_files",
  "objects",
  "object_history",
] as const;

export const GRIDFS_BUCKETS = [
  "audio-files",
] as const;

function getHistogramCollections(): string[] {
  return RESOLUTION_ORDER.map((resolution: Resolution) =>
    `histogram_${resolution}`
  );
}

export function getAllExpectedCollections(): string[] {
  return [
    ...REGULAR_COLLECTIONS,
    ...getHistogramCollections(),
  ];
}

export function getAllExpectedGridFSBuckets(): string[] {
  return [...GRIDFS_BUCKETS];
}

async function ensureCollectionExists(
  db: Db,
  collectionName: string,
): Promise<void> {
  const collections = await db.listCollections({ name: collectionName })
    .toArray();

  if (collections.length === 0) {
    await db.createCollection(collectionName);
    console.log(`Created collection: ${collectionName}`);
  }
}

async function ensureGridFSBucketExists(
  db: Db,
  bucketName: string,
): Promise<void> {
  const filesCollectionName = `${bucketName}.files`;
  const chunksCollectionName = `${bucketName}.chunks`;

  await ensureCollectionExists(db, filesCollectionName);
  await ensureCollectionExists(db, chunksCollectionName);
}

async function ensureIndexExists(
  db: Db,
  collectionName: string,
  indexSpec: IndexSpecification,
  options: CreateIndexesOptions = {},
): Promise<void> {
  await ensureCollectionExists(db, collectionName);

  const collection = db.collection(collectionName);
  const indexes = await collection.listIndexes().toArray();
  const indexName = options.name;

  const indexExists = indexes.some((index) => {
    if (indexName) {
      return index.name === indexName;
    }
    // Compare index keys
    return JSON.stringify(index.key) === JSON.stringify(indexSpec);
  });

  if (!indexExists) {
    await collection.createIndex(indexSpec, options);
    console.log(
      `Created index on ${collectionName}: ${
        indexName || JSON.stringify(indexSpec)
      }`,
    );
  }
}

async function ensureAudioChunksIndexes(db: Db): Promise<void> {
  await ensureIndexExists(
    db,
    "audio_chunks",
    {
      transcribed_at: 1,
      processing_by: 1,
      "vad.has_speech": 1,
      start: -1,
    },
    {
      name: "audio_chunks_pending_work",
      partialFilterExpression: {
        transcribed_at: null,
        processing_by: null,
        "vad.has_speech": true,
      },
    },
  );

  await ensureIndexExists(
    db,
    "audio_chunks",
    { processing_by: 1 },
    { name: "audio_chunks_processing_by" },
  );

  await ensureIndexExists(
    db,
    "audio_chunks",
    { transcribed_at: 1 },
    { name: "audio_chunks_transcribed_at" },
  );
}

async function ensureObjectsIndexes(db: Db): Promise<void> {
  await ensureIndexExists(
    db,
    "objects",
    {
      name: "text",
      aliases: "text",
      details: "text",
    },
    { name: "text_search_index" },
  );
  await ensureIndexExists(
    db,
    "object_history",
    {
      "objectId": 1,
      "timestamp": -1,
    },
    { name: "object_id" },
  );
}

async function ensureLLMModelsIndexes(db: Db): Promise<void> {
  // Ensure alias is unique - each model must have a unique alias
  await ensureIndexExists(
    db,
    "llm_models",
    { alias: 1 },
    { name: "llm_models_alias_unique", unique: true },
  );
}

export async function ensureAllCollectionsExist(): Promise<void> {
  const db = await getRootDB();

  console.log("Ensuring all MongoDB collections exist...");

  const regularCollections = getAllExpectedCollections();
  for (const collectionName of regularCollections) {
    await ensureCollectionExists(db, collectionName);
  }

  const gridFSBuckets = getAllExpectedGridFSBuckets();
  for (const bucketName of gridFSBuckets) {
    await ensureGridFSBucketExists(db, bucketName);
  }

  console.log("Ensuring indexes exist...");

  // Ensure indexes for specific collections
  await ensureObjectsIndexes(db);
  await ensureAudioChunksIndexes(db);
  await ensureLLMModelsIndexes(db);

  console.log(
    `All collections and indexes verified (${regularCollections.length} regular collections, ${gridFSBuckets.length} GridFS buckets)`,
  );
}
