import { Db, ObjectId } from "mongodb";
import type { CreateIndexesOptions, IndexSpecification } from "mongodb";
import { getRootDB } from "./core.server.ts";
import type { Resolution } from "@/types/resolution.ts";
import { RESOLUTION_ORDER } from "@/types/resolution.ts";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import * as path from "@std/path";

export const REGULAR_COLLECTIONS = [
  "api_keys",
  "audio_chunks",
  "transcriptions",
  "diarizations",
  "source_files",
  "objects",
  "object_history",
  "prompts",
  "configs",
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
    { name: "processing_by" },
  );

  await ensureIndexExists(
    db,
    "audio_chunks",
    { transcribed_at: 1 },
    { name: "transcribed_at" },
  );

  await ensureIndexExists(
    db,
    "audio_chunks",
    {
      start: 1,
    },
    { name: "start_1" },
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

const promptsYamlSchema = z.array(
  z.object({
    name: z.string(),
    text: z.string(),
    description: z.string().optional(),
  })
);

const configYamlSchema = z.object({
  prompts: z.record(z.string(), z.string()), // maps task key -> prompt name
  features: z.record(z.string(), z.boolean()),
});

const SERVER_CONFIG_ID = new ObjectId("000000000000000000000000");

async function ensureServerConfig(db: Db): Promise<void> {
  console.log("Ensuring server configuration...");

  try {
    // Load default prompts
    const promptsPath = path.resolve(Deno.cwd(), "defaults/prompts.yml");
    const promptsContent = await Deno.readTextFile(promptsPath);
    const promptsData = parseYaml(promptsContent);
    const defaultPrompts = promptsYamlSchema.parse(promptsData);

    const promptsCollection = db.collection("prompts");
    const promptNameMap = new Map<string, any>();

    // Ensure prompts exist
    for (const prompt of defaultPrompts) {
      const existing = await promptsCollection.findOne({ name: prompt.name });
      if (!existing) {
        const result = await promptsCollection.insertOne({
          ...prompt,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        promptNameMap.set(prompt.name, result.insertedId);
        console.log(`Created default prompt: ${prompt.name}`);
      } else {
        promptNameMap.set(prompt.name, existing._id);
      }
    }

    // Load default config
    const configPath = path.resolve(Deno.cwd(), "defaults/config.yml");
    const configContent = await Deno.readTextFile(configPath);
    const configData = parseYaml(configContent);
    const defaultConfig = configYamlSchema.parse(configData);

    const configsCollection = db.collection("configs");
    const serverConfig = await configsCollection.findOne({ _id: SERVER_CONFIG_ID });

    if (!serverConfig) {
      // Resolve prompt names to ObjectIds
      const promptsMap: Record<string, any> = {};
      for (const [key, promptName] of Object.entries(defaultConfig.prompts)) {
        const promptId = promptNameMap.get(promptName);
        if (promptId) {
          promptsMap[key] = promptId;
        } else {
          console.warn(`Warning: Default prompt '${promptName}' for key '${key}' not found.`);
        }
      }

      await configsCollection.insertOne({
        _id: SERVER_CONFIG_ID,
        prompts: promptsMap,
        features: defaultConfig.features,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      console.log("Created server_config with defaults");
    } else {
      // Patch missing keys in existing config
      let needsUpdate = false;
      const updates: any = {};

      // Check features
      for (const [key, value] of Object.entries(defaultConfig.features)) {
        if (serverConfig.features?.[key] === undefined) {
          updates[`features.${key}`] = value;
          needsUpdate = true;
        }
      }

      // Check prompt keys (only add if missing, don't overwrite user choices)
      for (const [key, promptName] of Object.entries(defaultConfig.prompts)) {
        if (serverConfig.prompts?.[key] === undefined) {
          const promptId = promptNameMap.get(promptName);
          if (promptId) {
            updates[`prompts.${key}`] = promptId;
            needsUpdate = true;
          }
        }
      }

      if (needsUpdate) {
        await configsCollection.updateOne(
          { _id: SERVER_CONFIG_ID },
          {
            $set: {
              ...updates,
              updatedAt: new Date(),
            },
          }
        );
        console.log("Updated server_config with new defaults");
      }
    }

  } catch (error) {
    console.error("Failed to ensure server configuration:", error);
    // Don't fail startup, just log error
  }
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

  // Ensure server configuration and prompts
  await ensureServerConfig(db);

  console.log(
    `All collections and indexes verified (${regularCollections.length} regular collections, ${gridFSBuckets.length} GridFS buckets)`,
  );
}
