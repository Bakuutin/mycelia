import { Db, MongoClient } from "mongodb";

import { z } from "zod";
import { Resource } from "@/lib/auth/resources.ts";
import { permissionDenied } from "../auth/utils.ts";

import createDefaultQueryTester from "sift";

import { Filter } from "mongodb";
import { Auth } from "../auth/index.ts";

let client: MongoClient | null = null;

interface CursorEntry {
  cursor: any;
  expiresAt: number;
}

const cursorMap = new Map<string, CursorEntry>();

const CURSOR_TTL_MS = 30 * 60 * 1000;

let cursorIdCounter = 0;

function generateCursorId(principal: string): string {
  return `${principal}:${Date.now()}:${++cursorIdCounter}`;
}

function cleanupExpiredCursors(): void {
  const now = Date.now();
  for (const [key, entry] of cursorMap.entries()) {
    if (entry.expiresAt < now) {
      cursorMap.delete(key);
      entry.cursor.close().catch(() => {});
    }
  }
}

export const getRootDB = async (): Promise<Db> => {
  if (!client) {
    client = new MongoClient(Deno.env.get("MONGO_URL") as string);
  }
  await client.connect();
  return client.db(Deno.env.get("DATABASE_NAME"));
};

export function sift(query: Filter<unknown>): (item: unknown) => boolean {
  const tester = (createDefaultQueryTester as any)(query);
  return (item: unknown) => tester(item);
}

const findSchema = z.object({
  action: z.enum(["find", "findOne"]),
  collection: z.string(),
  query: z.record(z.string(), z.any()),
  options: z.object({
    projection: z.record(z.string(), z.any()).optional(),
    sort: z.record(z.string(), z.any()).optional(),
    limit: z.number().optional(),
    skip: z.number().optional(),
  }).optional(),
});

const getFirstBatchSchema = z.object({
  action: z.literal("getFirstBatch"),
  collection: z.string(),
  query: z.record(z.string(), z.any()),
  options: z.object({
    projection: z.record(z.string(), z.any()).optional(),
    sort: z.record(z.string(), z.any()).optional(),
    limit: z.number().optional(),
    skip: z.number().optional(),
  }).optional(),
  batchSize: z.number(),
});

const getMoreSchema = z.object({
  action: z.literal("getMore"),
  collection: z.string(),
  cursorId: z.string(),
  batchSize: z.number(),
});

const countSchema = z.object({
  action: z.literal("count"),
  collection: z.string(),
  query: z.record(z.string(), z.any()),
});

const insertOneSchema = z.object({
  action: z.literal("insertOne"),
  collection: z.string(),
  doc: z.record(z.string(), z.any()),
});

const insertManySchema = z.object({
  action: z.literal("insertMany"),
  collection: z.string(),
  docs: z.array(z.record(z.string(), z.any())),
});

const updateSchema = z.object({
  action: z.enum(["updateOne", "updateMany"]),
  collection: z.string(),
  query: z.record(z.string(), z.any()),
  update: z.record(z.string(), z.any()),
  options: z.object({
    upsert: z.boolean().optional(),
    // arrayFilters is not supported yet
  }).optional(),
});

const deleteSchema = z.object({
  action: z.enum(["deleteOne", "deleteMany"]),
  collection: z.string(),
  query: z.record(z.string(), z.any()),
});

const aggregateSchema = z.object({
  action: z.literal("aggregate"),
  collection: z.string(),
  pipeline: z.array(z.record(z.string(), z.any())),
  options: z.record(z.string(), z.any()).optional(),
});

const bulkWriteSchema = z.object({
  action: z.literal("bulkWrite"),
  collection: z.string(),
  operations: z.array(z.record(z.string(), z.any())),
  options: z.object({
    ordered: z.boolean().optional(),
  }).optional(),
});

const createIndexSchema = z.object({
  action: z.literal("createIndex"),
  collection: z.string(),
  index: z.record(z.string(), z.any()),
  options: z.record(z.string(), z.any()).optional(),
});

const listIndexesSchema = z.object({
  action: z.literal("listIndexes"),
  collection: z.string(),
});

const mongoRequestSchema = z.discriminatedUnion("action", [
  findSchema,
  insertOneSchema,
  insertManySchema,
  updateSchema,
  deleteSchema,
  countSchema,
  aggregateSchema,
  bulkWriteSchema,
  createIndexSchema,
  listIndexesSchema,
  getFirstBatchSchema,
  getMoreSchema,
]);

export type MongoRequest = z.infer<typeof mongoRequestSchema>;
export type MongoResponse = any;

const actionMap = {
  count: ["read"],
  find: ["read"],
  findOne: ["read"],
  insertOne: ["write"],
  insertMany: ["write"],
  updateOne: ["update"],
  updateMany: ["update"],
  deleteOne: ["delete"],
  deleteMany: ["delete"],
  aggregate: ["read", "write", "update", "delete"],
  bulkWrite: ["write", "update", "delete"],
  createIndex: ["write"],
  listIndexes: ["read"],
  getFirstBatch: ["read"],
  getMore: ["read"],
} satisfies { [K in MongoRequest["action"]]: string[] };

export class MongoResource implements Resource<MongoRequest, MongoResponse> {
  code = "tech.mycelia.mongo";
  description =
    "MongoDB database operations including CRUD operations, aggregation, indexing, and bulk operations with query filtering and permission controls";
  schemas = {
    request: mongoRequestSchema,
    response: z.any(),
  };

  private collectionExistsCache = new Set<string>();

  clearCollectionCache(): void {
    this.collectionExistsCache.clear();
  }

  private async executeFindWithCursor(
    collection: any,
    query: Record<string, any>,
    options: any,
    batchSize: number,
    principal: string,
  ): Promise<{ cursorId: string; data: any[]; hasMore: boolean }> {
    cleanupExpiredCursors();

    const cursorOptions: any = {
      ...options,
      batchSize,
    };
    delete cursorOptions.maxTimeMS;

    const cursor = collection.find(query, cursorOptions);

    const results: any[] = [];
    let count = 0;
    while (count < batchSize && await cursor.hasNext()) {
      const doc = await cursor.next();
      if (doc) {
        results.push(doc);
        count++;
      }
    }

    const hasMore = await cursor.hasNext();

    if (!hasMore) {
      await cursor.close();
      return {
        cursorId: "",
        data: results,
        hasMore: false,
      };
    }

    const cursorId = generateCursorId(principal);
    cursorMap.set(cursorId, {
      cursor,
      expiresAt: Date.now() + CURSOR_TTL_MS,
    });

    return { cursorId, data: results, hasMore };
  }

  private async continueCursor(
    collection: string,
    cursorId: string,
    batchSize: number,
    principal: string,
  ): Promise<{ data: any[]; hasMore: boolean }> {
    cleanupExpiredCursors();

    const cursorEntry = cursorMap.get(cursorId);

    if (!cursorEntry) {
      return { data: [], hasMore: false };
    }

    if (cursorEntry.expiresAt < Date.now()) {
      cursorMap.delete(cursorId);
      await cursorEntry.cursor.close();
      return { data: [], hasMore: false };
    }

    const cursor = cursorEntry.cursor;

    try {
      const results: any[] = [];
      let count = 0;
      while (count < batchSize && await cursor.hasNext()) {
        const doc = await cursor.next();
        if (doc) {
          results.push(doc);
          count++;
        }
      }

      const hasMore = await cursor.hasNext();

      if (!hasMore) {
        cursorMap.delete(cursorId);
        await cursor.close();
      } else {
        cursorEntry.expiresAt = Date.now() + CURSOR_TTL_MS;
      }

      return { data: results, hasMore };
    } catch (error) {
      cursorMap.delete(cursorId);
      try {
        await cursor.close();
      } catch {
      }
      throw error;
    }
  }
  async getRootDB(): Promise<Db> {
    return getRootDB();
  }

  async ensureCollectionExists(db: Db, collectionName: string): Promise<void> {
    // Check cache first - if we've already verified this collection exists, skip the check
    if (this.collectionExistsCache.has(collectionName)) {
      return;
    }

    try {
      const collections = await db.listCollections({ name: collectionName })
        .toArray();

      if (collections.length === 0) {
        await db.createCollection(collectionName);
        console.log(`Auto-created collection: ${collectionName}`);
      }

      // Add to cache after successful verification/creation
      this.collectionExistsCache.add(collectionName);
    } catch (error) {
      console.error(
        `Failed to ensure collection ${collectionName} exists:`,
        error,
      );
      // Don't add to cache on error - we'll try again next time
      // Don't throw the error - let the operation continue
      // The operation will fail gracefully if the collection truly doesn't exist
    }
  }
  async use(input: MongoRequest, auth: Auth): Promise<MongoResponse> {
    const db = await this.getRootDB();

    await this.ensureCollectionExists(db, input.collection);

    const collection = db.collection(input.collection);

    try {
      switch (input.action) {
        case "find":
          return collection.find(input.query, input.options).toArray();
        case "findOne":
          return collection.findOne(input.query, input.options);
        case "getFirstBatch": {
          return this.executeFindWithCursor(
            collection,
            input.query,
            input.options,
            input.batchSize,
            auth.principal,
          );
        }
        case "getMore": {
          return this.continueCursor(
            input.collection,
            input.cursorId,
            input.batchSize,
            auth.principal,
          );
        }
        case "insertOne":
          return collection.insertOne(input.doc);
        case "insertMany":
          return collection.insertMany(input.docs);
        case "updateOne":
          return collection.updateOne(input.query, input.update);
        case "updateMany":
          return collection.updateMany(
            input.query,
            input.update,
            input.options,
          );
        case "deleteOne":
          return collection.deleteOne(input.query);
        case "deleteMany":
          return collection.deleteMany(input.query);
        case "count":
          return collection.countDocuments(input.query);
        case "aggregate":
          return collection.aggregate(input.pipeline, input.options).toArray();
        case "bulkWrite":
          return collection.bulkWrite(input.operations as any, input.options);
        case "createIndex":
          return collection.createIndex(input.index, input.options);
        case "listIndexes":
          if (
            !(await db.listCollections({ name: input.collection }).hasNext())
          ) {
            return [];
          }
          return collection.indexes();
        default:
          throw new Error("Unknown action");
      }
    } catch (error) {
      console.error(
        `MongoDB operation failed on collection ${input.collection}:`,
        error,
      );
      throw new Error(
        `Database operation failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
    }
  }

  extractActions(input: MongoRequest) {
    const actions = [...actionMap[input.action]];
    if (
      (input.action === "updateOne" || input.action === "updateMany") &&
      input.options?.upsert
    ) {
      actions.push("update");
    }
    
    return [
      {
        path: ["db", input.collection],
        actions,
      },
    ];
  }

  modifiers = {
    filter: {
      schema: z.object({
        filter: z.record(z.string(), z.any()),
      }),
      use: async (
        { arg, auth, input }: {
          arg: { filter: Filter<unknown> };
          auth: Auth;
          input: MongoRequest;
        },
        next: (input: MongoRequest, auth: Auth) => Promise<MongoResponse>,
      ) => {
        if (input.action === "insertOne") {
          const matcher = sift(arg.filter);
          if (!matcher(input.doc)) {
            permissionDenied();
          }
          return next(input, auth);
        }
        if (input.action === "insertMany") {
          const matcher = sift(arg.filter);
          if (input.docs.some((doc) => !matcher(doc))) {
            permissionDenied();
          }
          return next(input, auth);
        }

        if ("query" in input) {
          const query = {
            $and: [
              input.query,
              arg.filter,
            ],
          };

          const result = await next({
            ...input,
            query,
          }, auth);
          return result;
        } else {
          // For actions without query (like aggregate), just pass through
          const result = await next(input, auth);
          return result;
        }
      },
    },
  };
}

export function getMongoResource(
  auth: Auth,
): Promise<(input: MongoRequest) => Promise<MongoResponse>> {
  return auth.getResource("tech.mycelia.mongo");
}
