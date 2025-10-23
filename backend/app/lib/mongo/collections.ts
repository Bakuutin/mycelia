import { Db } from "mongodb";
import { getRootDB } from "./core.server.ts";
import type { Resolution } from "@/types/resolution.ts";
import { RESOLUTION_ORDER } from "@/types/resolution.ts";

export const REGULAR_COLLECTIONS = [
  "api_keys",
  "events",
  "audio_chunks",
  "transcriptions",
  "diarizations",
  "source_files",
  "people",
  "conversations",
  "objects",
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

  console.log(
    `All collections verified (${regularCollections.length} regular collections, ${gridFSBuckets.length} GridFS buckets)`,
  );
}
