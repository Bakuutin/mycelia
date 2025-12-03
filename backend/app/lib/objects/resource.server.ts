import { z } from "zod";
import { ObjectId } from "bson";
import { Resource } from "@/lib/auth/resources.ts";
import { Auth } from "@/lib/auth/core.server.ts";
import { getMongoResource, getRootDB } from "@/lib/mongo/core.server.ts";

const zObjectId = z.union([
  z.instanceof(ObjectId),
  z.string().transform((val) => new ObjectId(val)),
]);

const zDate = z.union([
  z.date(),
  z.string().transform((val) => new Date(val)),
]);

const zIcon = z.union([
  z.object({
    text: z.string().describe("Emoji or text icon (e.g., '🐯', '🏠️')")
  }),
  z.object({
    base64: z.string().describe("Base64-encoded image data")
  }),
]);

const zObjectInput = z.object({
  name: z.string().min(1).describe(
    "Display name of the object (person, event, place, relationship, or promise)"
  ),
  details: z.string().nullable().optional().describe(
    "Additional details or description. Can be markdown formatted."
  ),
  icon: zIcon.optional().describe(
    "Visual icon for the object, either emoji text or base64 image"
  ),
  color: z.string().optional().describe(
    "Color code for visual representation (e.g., '#FF5733')"
  ),
  aliases: z.array(z.string()).optional().describe(
    "Alternative names or identifiers for search (e.g., ['Igor', 'Tigor'])"
  ),
  isEvent: z.boolean().optional().describe(
    "True if this object represents an event or occurrence in time"
  ),
  isPerson: z.boolean().optional().describe(
    "True if this object represents a person or entity"
  ),
  isRelationship: z.boolean().optional().describe(
    "True if this object represents a relationship between two other objects. Requires 'relationship' field."
  ),
  isPromise: z.boolean().optional().describe(
    "True if this object represents a promise or commitment"
  ),
  relationship: z.object({
    object: zObjectId.describe("The object/target of the relationship (the 'to' entity)"),
    subject: zObjectId.describe("The subject/source of the relationship (the 'from' entity)"),
    symmetrical: z.boolean().describe(
      "True if relationship goes both ways (e.g., 'partner' relationship), false for directional (e.g., 'lives in')"
    ),
  }).optional().describe(
    "Defines the relationship structure. Only used when isRelationship=true. Example: 'Me lives in Amsterdam' has subject=Me, object=Amsterdam, symmetrical=false"
  ),
  location: z.object({
    latitude: z.number().describe("Geographic latitude (-90 to 90)"),
    longitude: z.number().describe("Geographic longitude (-180 to 180)"),
  }).optional().describe(
    "Geographic coordinates for places or events with physical location"
  ),
  timeRanges: z.array(z.object({
    start: zDate.describe("Start date/time of this time period"),
    end: zDate.optional().describe("End date/time. Omit for ongoing/current periods"),
    name: z.string().optional().describe("Optional label for this time period"),
  })).optional().describe(
    "Time periods when this object/relationship was active. Multiple ranges supported for non-continuous periods."
  ),
}).passthrough();

const createObjectSchema = z.object({
  action: z.literal("create").describe("Create a new object"),
  object: zObjectInput.describe(
    "The object data to create. Can represent people, events, places, relationships, or promises."
  ),
});

const updateObjectSchema = z.object({
  action: z.literal("update").describe("Update a single field on an object"),
  id: z.string().describe("MongoDB ObjectId string of the object to update"),
  version: z.number().describe(
    "Current version number for optimistic locking. Get this from the object first. Update fails if version changed."
  ),
  field: z.string().describe(
    "Dot-notation path to the field to update (e.g., 'name', 'details', 'icon.text', 'timeRanges'). Set to null to remove field."
  ),
  value: z.any().describe(
    "New value for the field. Use null to remove the field entirely."
  ),
});

const deleteObjectSchema = z.object({
  action: z.literal("delete").describe("Delete an object permanently"),
  id: z.string().describe("MongoDB ObjectId string of the object to delete"),
});

const getObjectSchema = z.object({
  action: z.literal("get").describe("Retrieve a single object by ID"),
  id: z.string().describe("MongoDB ObjectId string of the object to retrieve"),
});

const listObjectsSchema = z.object({
  action: z.literal("list").describe(
    "List/search objects with filtering and pagination"
  ),
  filters: z.record(z.string(), z.any()).optional().describe(
    "MongoDB query filters (e.g., {'isPerson': true, 'name': 'Igor'}). Leave empty for all objects."
  ),
  options: z.object({
    limit: z.number().optional().describe(
      "Maximum number of results to return"
    ),
    skip: z.number().optional().describe(
      "Number of results to skip for pagination"
    ),
    sort: z.record(z.string(), z.number()).optional().describe(
      "Sort order as field:direction pairs (1=ascending, -1=descending). Example: {'createdAt': -1} for newest first"
    ),
    includeRelationships: z.boolean().optional().describe(
      "If true, join and include full related objects for relationships"
    ),
    hasTimeRanges: z.boolean().optional().describe(
      "If true, only return objects that have time ranges defined"
    ),
    searchTerm: z.union([z.string(), z.null()]).optional().describe(
      "Search string to match against name and aliases (case-insensitive)"
    ),
  }).optional().describe("Query options for filtering, sorting, and pagination"),
});

const getRelationshipsSchema = z.object({
  action: z.literal("getRelationships").describe(
    "Get all relationships where this object is subject or object"
  ),
  id: z.string().describe(
    "MongoDB ObjectId string of the object whose relationships to retrieve"
  ),
});

const getHistorySchema = z.object({
  action: z.literal("getHistory").describe(
    "Get version history of changes to an object"
  ),
  id: z.string().describe(
    "MongoDB ObjectId string of the object whose history to retrieve"
  ),
  limit: z.number().max(500).nullish().describe(
    "Maximum number of history entries to return (default: 50, max: 500)"
  ),
  skip: z.number().nullish().describe(
    "Number of history entries to skip for pagination"
  ),
});

const exploreTimeRangeSchema = z.object({
  action: z.literal("exploreTimeRange").describe(
    "Find objects that refer to a specific time range"
  ),
  start: zDate.describe(
    "(ISO 8601 date string or Date object)"
  ),
  end: zDate.describe(
    "(ISO 8601 date string or Date object)"
  ),
  filters: z.record(z.string(), z.any()).optional().describe(
    "Additional MongoDB query filters to apply (e.g., {'isPerson': true})"
  ),
  options: z.object({
    limit: z.number().optional().describe(
      "Maximum number of results to return"
    ),
    skip: z.number().optional().describe(
      "Number of results to skip for pagination"
    ),
    sort: z.record(z.string(), z.number()).optional().describe(
      "Sort order as field:direction pairs (1=ascending, -1=descending)"
    ),
    includeRelationships: z.boolean().optional().describe(
      "If true, join and include full related objects for relationships"
    ),
  }).optional().describe("Query options for sorting and pagination"),
});

const objectsRequestSchema = z.discriminatedUnion("action", [
  createObjectSchema,
  updateObjectSchema,
  deleteObjectSchema,
  getObjectSchema,
  listObjectsSchema,
  getRelationshipsSchema,
  getHistorySchema,
  exploreTimeRangeSchema,
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
  code = "objects";
  description =
    "Manage timeline objects (people, events, places, relationships, promises). Objects form a graph where relationships connect entities with temporal data. Supports optimistic locking for concurrent updates. Use 'list' to find objects, 'get' for details, 'getRelationships' to explore connections, 'exploreTimeRange' to find objects active during a time period, 'create' for new entities, 'update' for field changes, and 'getHistory' for version tracking.";
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
        if (input.skip != null) {
          findOptions.skip = input.skip;
        }
        findOptions.limit = input.limit ?? 50;

        try {
          return await mongo({
            action: "find",
            collection: "object_history",
            query: { objectId: objectId },
            options: findOptions,
          });
        } catch (error) {
          console.error("Error fetching object history:", error);
          throw new Error(
            `Failed to fetch object history: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }

      case "exploreTimeRange": {
        const timeRangeQuery = {
          timeRanges: {
            $elemMatch: {
              start: { $lte: input.end },
              $or: [
                { end: { $gte: input.start } },
                { end: null },
              ],
            },
          },
        };

        const query = input.filters
          ? { ...input.filters, ...timeRangeQuery }
          : timeRangeQuery;

        if (input.options?.includeRelationships) {
          const pipeline: any[] = [
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
      exploreTimeRange: ["read"],
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
  return auth.getResource<ObjectsRequest, ObjectsResponse>(
    "objects",
  );
}
