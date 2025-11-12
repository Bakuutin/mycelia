import { z } from "zod";
import { ObjectId } from "mongodb";
import { Resource } from "@/lib/auth/resources.ts";
import { Auth } from "@/lib/auth/core.server.ts";
import { getMongoResource, getRootDB } from "@/lib/mongo/core.server.ts";

const zObjectId = z.instanceof(ObjectId).or(z.string().transform((val) => new ObjectId(val)));

const zIcon = z.union([
  z.object({ text: z.string() }),
  z.object({ base64: z.string() }),
]);

const zObjectInput = z.object({
  name: z.string().min(1),
  details: z.string().optional(),
  icon: zIcon.optional(),
  color: z.string().optional(),
  aliases: z.array(z.string()).optional(),
  isEvent: z.boolean().optional(),
  isPerson: z.boolean().optional(),
  isRelationship: z.boolean().optional(),
  isPromise: z.boolean().optional(),
  relationship: z.object({
    object: zObjectId,
    subject: zObjectId,
    symmetrical: z.boolean(),
  }).optional(),
  location: z.object({
    latitude: z.number(),
    longitude: z.number(),
  }).optional(),
  timeRanges: z.array(z.object({
    start: z.date(),
    end: z.date().optional(),
    name: z.string().optional(),
  })).optional(),
}).passthrough();

const createObjectSchema = z.object({
  action: z.literal("create"),
  object: zObjectInput,
});

const updateObjectSchema = z.object({
  action: z.literal("update"),
  id: z.string(),
  version: z.number(),
  field: z.string(),
  value: z.any(),
});

const deleteObjectSchema = z.object({
  action: z.literal("delete"),
  id: z.string(),
});

const getObjectSchema = z.object({
  action: z.literal("get"),
  id: z.string(),
});

const listObjectsSchema = z.object({
  action: z.literal("list"),
  filters: z.record(z.string(), z.any()).optional(),
  options: z.object({
    limit: z.number().optional(),
    skip: z.number().optional(),
    sort: z.record(z.string(), z.number()).optional(),
    includeRelationships: z.boolean().optional(),
    hasTimeRanges: z.boolean().optional(),
    searchTerm: z.union([z.string(), z.null()]).optional(),
  }).optional(),
});

const getRelationshipsSchema = z.object({
  action: z.literal("getRelationships"),
  id: z.string(),
});

const getHistorySchema = z.object({
  action: z.literal("getHistory"),
  id: z.string(),
  limit: z.number().max(500).optional(),
  skip: z.number().optional(),
});

const objectsRequestSchema = z.discriminatedUnion("action", [
  createObjectSchema,
  updateObjectSchema,
  deleteObjectSchema,
  getObjectSchema,
  listObjectsSchema,
  getRelationshipsSchema,
  getHistorySchema,
]);

export type ObjectsRequest = z.infer<typeof objectsRequestSchema>;
export type ObjectsResponse = any;

function getNestedValue(obj: any, path: string): any {
  const parts = path.split(".");
  let current = obj;
  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }
    current = current[part];
  }
  return current;
}

export class ObjectsResource
  implements Resource<ObjectsRequest, ObjectsResponse> {
  code = "tech.mycelia.objects";
  description =
    "Object management operations with optimistic locking and field-level updates";
  schemas = {
    request: objectsRequestSchema as z.ZodType<ObjectsRequest>,
    response: z.any(),
  };

  async getRootDB() {
    return getRootDB();
  }

  private async recordHistory(
    objectId: ObjectId,
    action: "create" | "update" | "delete",
    userId: string,
    version: number,
    field: string | null,
    oldValue: any,
    newValue: any,
  ): Promise<void> {
    try {
      const db = await this.getRootDB();
      await db.collection("object_history").insertOne({
        objectId,
        action,
        timestamp: new Date(),
        userId,
        version,
        field,
        oldValue,
        newValue,
      });
    } catch (error) {
      console.error("Failed to record object history:", error);
    }
  }

  async use(input: ObjectsRequest, auth: Auth): Promise<ObjectsResponse> {
    const mongo = await getMongoResource(auth);

    switch (input.action) {
      case "create": {
        const doc = {
          ...input.object,
          version: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        const result = await mongo({
          action: "insertOne",
          collection: "objects",
          doc,
        });

        await this.recordHistory(
          result.insertedId,
          "create",
          auth.principal,
          1,
          null,
          undefined,
          doc,
        );

        return { insertedId: result.insertedId };
      }

      case "get": {
        const objectId = new ObjectId(input.id as string);
        const object = await mongo({
          action: "findOne",
          collection: "objects",
          query: { _id: objectId },
        });
        if (!object) {
          throw new Error("Object not found");
        }
        if (object.version === undefined) {
          object.version = 0;
        }
        return object;
      }

      case "update": {
        const objectId = new ObjectId(input.id as string);

        const current = await mongo({
          action: "findOne",
          collection: "objects",
          query: { _id: objectId },
        });
        if (!current) {
          throw new Error("Object not found");
        }

        const currentVersion = current.version ?? 0;

        if (currentVersion !== input.version) {
          const error: any = new Error("Object was modified by another user");
          error.code = 409;
          error.current = currentVersion;
          error.expected = input.version;
          error.latestObject = { ...current, version: currentVersion };
          throw error;
        }

        const oldValue = getNestedValue(current, input.field);

        // If value is null, use $unset to remove the field, otherwise use $set
        const updateDoc: any = {};

        if (input.value === null || input.value === undefined) {
          // Remove the field using $unset, but still update timestamp and version
          updateDoc.$unset = { [input.field]: "" };
          updateDoc.$set = {
            updatedAt: new Date(),
            version: currentVersion + 1,
          };
        } else {
          // Set the field value using $set
          updateDoc.$set = {
            [input.field]: input.value,
            updatedAt: new Date(),
            version: currentVersion + 1,
          };
        }

        await mongo({
          action: "updateOne",
          collection: "objects",
          query: { _id: objectId },
          update: updateDoc,
        });

        const result = await mongo({
          action: "findOne",
          collection: "objects",
          query: { _id: objectId },
        });

        if (!result) {
          const error: any = new Error("Update failed");
          error.code = 500;
          throw error;
        }

        await this.recordHistory(
          objectId,
          "update",
          auth.principal,
          result.version,
          input.field,
          oldValue,
          input.value,
        );

        return result;
      }

      case "delete": {
        const objectId = new ObjectId(input.id as string);

        const current = await mongo({
          action: "findOne",
          collection: "objects",
          query: { _id: objectId },
        });
        if (!current) {
          throw new Error("Object not found");
        }

        const result = await mongo({
          action: "deleteOne",
          collection: "objects",
          query: { _id: objectId },
        });

        await this.recordHistory(
          objectId,
          "delete",
          auth.principal,
          current.version ?? 0,
          null,
          current,
          undefined,
        );

        return { deletedCount: result.deletedCount };
      }

      case "list": {
        let query = input.filters || {};

        if (input.options?.hasTimeRanges) {
          query = {
            ...query,
            timeRanges: { $exists: true, $ne: [] },
          };
        }

        if (input.options?.searchTerm && input.options.searchTerm.trim()) {
          const searchRegex = {
            $regex: input.options.searchTerm,
            $options: "i",
          };
          query = {
            ...query,
            $or: [
              { name: searchRegex },
              { aliases: searchRegex },
            ],
          };
        }

        if (input.options?.includeRelationships) {
          const pipeline: any[] = [
            {
              $addFields: {
                hasTimeRanges: {
                  $cond: {
                    if: { $isArray: "$timeRanges" },
                    then: true,
                    else: false,
                  },
                },
              },
            },
            { $match: query },
            {
              $lookup: {
                from: "objects",
                localField: "relationship.subject",
                foreignField: "_id",
                as: "subjectObject",
              },
            },
            {
              $lookup: {
                from: "objects",
                localField: "relationship.object",
                foreignField: "_id",
                as: "objectObject",
              },
            },
            {
              $unwind: {
                path: "$subjectObject",
                preserveNullAndEmptyArrays: true,
              },
            },
            {
              $unwind: {
                path: "$objectObject",
                preserveNullAndEmptyArrays: true,
              },
            },
            {
              $addFields: {
                earliestStart: {
                  $min: {
                    $map: {
                      input: "$timeRanges",
                      as: "r",
                      in: "$$r.start",
                    },
                  },
                },
                latestEnd: {
                  $max: {
                    $map: {
                      input: "$timeRanges",
                      as: "r",
                      in: { $ifNull: ["$$r.end", "$$r.start"] },
                    },
                  },
                },
              },
            },
            {
              $addFields: {
                duration: { $subtract: ["$latestEnd", "$earliestStart"] },
              },
            },
          ];

          if (input.options?.sort) {
            pipeline.push({ $sort: input.options.sort });
          }

          if (input.options?.skip) {
            pipeline.push({ $skip: input.options.skip });
          }

          if (input.options?.limit) {
            pipeline.push({ $limit: input.options.limit });
          }

          return await mongo({
            action: "aggregate",
            collection: "objects",
            pipeline,
          });
        }

        const findOptions: any = {};
        if (input.options?.sort) {
          findOptions.sort = input.options.sort;
        }
        if (input.options?.skip) {
          findOptions.skip = input.options.skip;
        }
        if (input.options?.limit) {
          findOptions.limit = input.options.limit;
        }

        return await mongo({
          action: "find",
          collection: "objects",
          query,
          options: findOptions,
        });
      }

      case "getRelationships": {
        const objectId = new ObjectId(input.id as string);

        const pipeline = [
          { $match: { isRelationship: true } },
          {
            $match: {
              $or: [
                { "relationship.subject": objectId },
                { "relationship.object": objectId },
              ],
            },
          },
          {
            $lookup: {
              from: "objects",
              localField: "relationship.subject",
              foreignField: "_id",
              as: "subjectObj",
            },
          },
          {
            $lookup: {
              from: "objects",
              localField: "relationship.object",
              foreignField: "_id",
              as: "objectObj",
            },
          },
          {
            $unwind: { path: "$subjectObj", preserveNullAndEmptyArrays: true },
          },
          { $unwind: { path: "$objectObj", preserveNullAndEmptyArrays: true } },
          {
            $project: {
              relationship: "$$ROOT",
              other: {
                $cond: [
                  { $eq: ["$relationship.subject", objectId] },
                  "$objectObj",
                  "$subjectObj",
                ],
              },
            },
          },
          {
            $set: {
              earliestStart: {
                $min: {
                  $map: {
                    input: "$relationship.timeRanges",
                    as: "r",
                    in: "$$r.start",
                  },
                },
              },
              latestEnd: {
                $max: {
                  $map: {
                    input: "$relationship.timeRanges",
                    as: "r",
                    in: "$$r.end",
                  },
                },
              },
            },
          },
          {
            $set: {
              endOrNow: { $ifNull: ["$latestEnd", new Date()] },
            },
          },
          {
            $set: {
              duration: { $subtract: ["$endOrNow", "$earliestStart"] },
            },
          },
          { $sort: { endOrNow: -1, earliestStart: -1 } },
        ];

        return await mongo({
          action: "aggregate",
          collection: "objects",
          pipeline,
        });
      }

      case "getHistory": {
        const objectId = new ObjectId(input.id as string);

        const findOptions: any = {
          sort: { timestamp: -1 },
        };
        if (input.skip) {
          findOptions.skip = input.skip;
        }
        findOptions.limit = (input.limit as number) ?? 50;

        return await mongo({
          action: "find",
          collection: "object_history",
          query: { objectId },
          options: findOptions,
        });
      }

      default:
        throw new Error("Unknown action");
    }
  }

  extractActions(input: ObjectsRequest) {
    const actionMap: Record<string, string[]> = {
      create: ["create"],
      get: ["read"],
      list: ["read"],
      update: ["update"],
      delete: ["delete"],
      getRelationships: ["read"],
      getHistory: ["read"],
    };

    return [
      {
        path: ["objects"],
        actions: actionMap[input.action] || ["read"],
      },
    ];
  }
}

export function getObjectsResource(
  auth: Auth,
): Promise<(input: ObjectsRequest) => Promise<ObjectsResponse>> {
  return auth.getResource<ObjectsRequest, ObjectsResponse>("tech.mycelia.objects");
}
