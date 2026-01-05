import { Db, MongoClient } from "mongodb";

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
  console.log("Running migration 0006: Adding jobs collection and indexes...");

  await ensureCollectionExists(db, "jobs");

  await ensureIndexExists(
    db,
    "jobs",
    { type: 1, state: 1, createdAt: -1 },
    { name: "type_state" },
  );

  await ensureIndexExists(
    db,
    "jobs",
    { createdAt: -1 },
    { name: "created_at_desc" },
  );

  await ensureIndexExists(
    db,
    "jobs",
    { state: 1, createdAt: -1 },
    { name: "state" },
  );
}

export async function down(db: Db, _client: MongoClient): Promise<void> {
  console.log("Rolling back migration 0006: Removing jobs collection...");
  await db.dropCollection("jobs");
}



