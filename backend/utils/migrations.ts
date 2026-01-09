import { Db, type CreateIndexesOptions, type IndexSpecification } from "mongodb";

/**
 * Ensures that a collection exists in the database.
 */
export async function ensureCollectionExists(
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

/**
 * Ensures that a GridFS bucket (files and chunks collections) exists.
 */
export async function ensureGridFSBucketExists(
  db: Db,
  bucketName: string,
): Promise<void> {
  const filesCollectionName = `${bucketName}.files`;
  const chunksCollectionName = `${bucketName}.chunks`;

  await ensureCollectionExists(db, filesCollectionName);
  await ensureCollectionExists(db, chunksCollectionName);
}

/**
 * Ensures that an index exists on a collection.
 * If the index doesn't exist, it creates it.
 */
export async function ensureIndexExists(
  db: Db,
  collectionName: string,
  indexSpec: IndexSpecification,
  options: CreateIndexesOptions = {},
): Promise<void> {
  await ensureCollectionExists(db, collectionName);

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
    // Silently ignore if index already exists with a different name
    if (
      error instanceof Error && error.message.includes("Index already exists")
    ) {
      return;
    }
    throw error;
  }
}

