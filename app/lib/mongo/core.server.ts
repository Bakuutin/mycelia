import { Db, MongoClient } from "mongodb";

import { z } from "zod";
import { Resource } from "@/lib/auth/resources.ts";
import { permissionDenied } from "../auth/utils.ts";

import createDefaultQueryTester from "sift";

import { Filter } from "mongodb";
import { Auth } from "../auth/index.ts";

let client: MongoClient | null = null;

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
]);

type MongoRequest = z.infer<typeof mongoRequestSchema>;
type MongoResponse = any;

const actionMap = {
  count: "read",
  find: "read",
  findOne: "read",
  insertOne: "write",
  insertMany: "write",
  updateOne: "update",
  updateMany: "update",
  deleteOne: "delete",
  deleteMany: "delete",
  aggregate: "read",
  bulkWrite: "write",
  createIndex: "write",
  listIndexes: "read",
} satisfies { [K in MongoRequest["action"]]: string };

export class MongoResource implements Resource<MongoRequest, MongoResponse> {
  code = "tech.mycelia.mongo";
  description = "MongoDB database operations including CRUD operations, aggregation, indexing, and bulk operations with query filtering and permission controls";
  schemas = {
    request: mongoRequestSchema,
    response: z.any(),
  };
  async getRootDB(): Promise<Db> {
    return getRootDB();
  }
  async use(input: MongoRequest): Promise<MongoResponse> {
    const db = await this.getRootDB();
    const collection = db.collection(input.collection);
    switch (input.action) {
      case "find":
        return collection.find(input.query, input.options).toArray();
      case "findOne":
        return collection.findOne(input.query, input.options);
      case "insertOne":
        return collection.insertOne(input.doc);
      case "insertMany":
        return collection.insertMany(input.docs);
      case "updateOne":
        return collection.updateOne(input.query, input.update);
      case "updateMany":
        return collection.updateMany(input.query, input.update, input.options);
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
        if (!(await db.listCollections({ name: input.collection }).hasNext())) {
          return [];
        }
        return collection.indexes();
      default:
        throw new Error("Unknown action");
    }
  }

  extractActions(input: MongoRequest) {
    const actions = [actionMap[input.action]];
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
