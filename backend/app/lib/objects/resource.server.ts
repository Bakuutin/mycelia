import { z } from "zod";
import { ObjectId } from "bson";
import { Resource } from "@/lib/auth/resources.ts";
import { Auth, getServerAuth } from "@/lib/auth/core.server.ts";
import { getMongoResource, getRootDB } from "@/lib/mongo/core.server.ts";
import { zObjectId, zDateOrString } from "@myceliasdk/zod-json-schema.ts";

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
    object: zObjectId().describe("The object/target of the relationship (the 'to' entity)"),
    subject: zObjectId().describe("The subject/source of the relationship (the 'from' entity)"),
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
    start: zDateOrString().describe("Start date/time of this time period"),
    end: zDateOrString().optional().describe("End date/time. Omit for ongoing/current periods"),
    name: z.string().optional().describe("Optional label for this time period"),
  })).optional().describe(
    "Time periods when this object/relationship was active. Multiple ranges supported for non-continuous periods."
  ),
}).loose();

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
    timeRangeFilter: z.object({
      start: z.string().describe("ISO 8601 date string for range start"),
      end: z.string().describe("ISO 8601 date string for range end"),
    }).optional().describe(
      "Filter objects that overlap with the specified time range"
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
  start: zDateOrString().describe(
    "(ISO 8601 date string or Date object)"
  ),
  end: zDateOrString().describe(
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

const getTimeRangeSchema = z.object({
  action: z.literal("getTimeRange").describe(
    "Get the minimum and maximum dates from all object time ranges"
  ),
});

const getCountsSchema = z.object({
  action: z.literal("getCounts").describe(
    "Get cached counts per object type. Returns cached values for fast loading."
  ),
  forceRefresh: z.boolean().optional().describe(
    "If true, recalculate counts from database and update cache"
  ),
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
  getTimeRangeSchema,
  getCountsSchema,
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

  // Calculate and cache object counts in the database
  private async refreshCounts(): Promise<{
    person: number;
    event: number;
    relationship: number;
    promise: number;
    conversation: number;
    other: number;
    orphaned: number;
    total: number;
    updatedAt: Date;
  }> {
    const db = await this.getRootDB();
    const objectsCollection = db.collection("objects");

    // Calculate type counts with a single aggregation
    const countsPipeline = [
      {
        $group: {
          _id: null,
          person: { $sum: { $cond: [{ $eq: ["$isPerson", true] }, 1, 0] } },
          event: { $sum: { $cond: [{ $eq: ["$isEvent", true] }, 1, 0] } },
          promise: { $sum: { $cond: [{ $eq: ["$isPromise", true] }, 1, 0] } },
          relationship: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ["$isRelationship", true] },
                    { $ne: ["$isPromise", true] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          conversation: { $sum: { $cond: [{ $eq: ["$isConversation", true] }, 1, 0] } },
          other: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $ne: ["$isPerson", true] },
                    { $ne: ["$isEvent", true] },
                    { $ne: ["$isRelationship", true] },
                    { $ne: ["$isPromise", true] },
                    { $ne: ["$isConversation", true] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          total: { $sum: 1 },
        },
      },
    ];

    const countsResult = await objectsCollection.aggregate(countsPipeline).toArray();
    const typeCounts = countsResult[0] || {
      person: 0,
      event: 0,
      relationship: 0,
      promise: 0,
      conversation: 0,
      other: 0,
      total: 0,
    };

    // Calculate orphaned count (objects not referenced in any relationship)
    const orphanedPipeline = [
      {
        $match: {
          isRelationship: { $ne: true },
        },
      },
      {
        $lookup: {
          from: "objects",
          let: { objectId: "$_id" },
          pipeline: [
            {
              $match: {
                isRelationship: true,
                $expr: {
                  $or: [
                    { $eq: ["$relationship.subject", "$$objectId"] },
                    { $eq: ["$relationship.object", "$$objectId"] },
                  ],
                },
              },
            },
            { $limit: 1 },
          ],
          as: "references",
        },
      },
      {
        $match: {
          references: { $size: 0 },
        },
      },
      { $count: "total" },
    ];

    const orphanedResult = await objectsCollection.aggregate(orphanedPipeline).toArray();
    const orphanedCount = orphanedResult[0]?.total ?? 0;

    const stats = {
      person: typeCounts.person,
      event: typeCounts.event,
      relationship: typeCounts.relationship,
      promise: typeCounts.promise,
      conversation: typeCounts.conversation,
      other: typeCounts.other,
      orphaned: orphanedCount,
      total: typeCounts.total,
      updatedAt: new Date(),
    };

    // Store in cache collection
    await db.collection("object_stats").updateOne(
      { _id: "counts" },
      { $set: stats },
      { upsert: true }
    );

    return stats;
  }

  // Get cached counts, or calculate if not exists
  private async getCachedCounts(): Promise<{
    person: number;
    event: number;
    relationship: number;
    promise: number;
    conversation: number;
    other: number;
    orphaned: number;
    total: number;
    updatedAt: Date | null;
    stale?: boolean;
  } | null> {
    const db = await this.getRootDB();
    const cached = await db.collection("object_stats").findOne({ _id: "counts" });
    if (!cached) return null;
    return {
      person: cached.person,
      event: cached.event,
      relationship: cached.relationship,
      promise: cached.promise,
      conversation: cached.conversation,
      other: cached.other,
      orphaned: cached.orphaned,
      total: cached.total,
      updatedAt: cached.updatedAt,
      stale: cached.stale,
    };
  }

  // Invalidate counts cache (called after create/update/delete)
  private async invalidateCountsCache(): Promise<void> {
    // Just mark as stale by updating a flag, don't recalculate immediately
    const db = await this.getRootDB();
    await db.collection("object_stats").updateOne(
      { _id: "counts" },
      { $set: { stale: true } },
      { upsert: true }
    );
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

  async use(input: ObjectsRequest): Promise<ObjectsResponse> {
    const auth = await getServerAuth(); // already checked objects permissions 
    const mongo = await getMongoResource(auth);

    switch (input.action) {
      case "create": {
        const doc = {
          ...input.object,
          version: 1,
          createdAt: new Date(),
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

        // Invalidate counts cache
        await this.invalidateCountsCache();

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
          // Remove the field using $unset, but still update version
          updateDoc.$unset = { [input.field]: "" };
          updateDoc.$set = {
            version: currentVersion + 1,
          };
        } else {
          // Set the field value using $set
          updateDoc.$set = {
            [input.field]: input.value,
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

        // Invalidate counts cache if type-related fields changed
        const typeFields = ["isPerson", "isEvent", "isRelationship", "isPromise", "isConversation"];
        if (typeFields.includes(input.field) || input.field.startsWith("relationship")) {
          await this.invalidateCountsCache();
        }

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

        // Invalidate counts cache
        await this.invalidateCountsCache();

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

        if (input.options?.timeRangeFilter) {
          const filterStart = new Date(input.options.timeRangeFilter.start);
          const filterEnd = new Date(input.options.timeRangeFilter.end);

          query = {
            ...query,
            timeRanges: {
              $elemMatch: {
                start: { $lt: filterEnd },
                $or: [
                  { end: { $gt: filterStart } },
                  { end: { $exists: false } },
                ],
              },
            },
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
        console.log("[exploreTimeRange] Input:", JSON.stringify({
          start: input.start,
          end: input.end,
          filters: input.filters,
          options: input.options,
          startType: typeof input.start,
          endType: typeof input.end,
        }, null, 2));

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

        console.log("[exploreTimeRange] Constructed query:", JSON.stringify(query, null, 2));

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

          // Add computed field for sorting by min timeRanges.start
          pipeline.push({
            $addFields: {
              _minTimeRangeStart: { $min: "$timeRanges.start" },
            },
          });

          // Sort by min timeRanges.start (default) or user-specified sort
          pipeline.push({ $sort: input.options?.sort || { _minTimeRangeStart: 1 } });

          if (input.options?.skip) {
            pipeline.push({ $skip: input.options.skip });
          }

          if (input.options?.limit) {
            pipeline.push({ $limit: input.options.limit });
          }

          // Default projection for aggregation - include joined objects (excludes _minTimeRangeStart)
          pipeline.push({ $project: {
            _id: 1,
            name: 1,
            icon: 1,
            timeRanges: 1,
            summaries: { $map: { input: "$summaries", as: "s", in: "$$s.text" } },
            isEvent: 1,
            isPerson: 1,
            isRelationship: 1,
            isConversation: 1,
            isPromise: 1,
            subjectObject: { _id: 1, name: 1, icon: 1 },
            objectObject: { _id: 1, name: 1, icon: 1 },
          }});

          // Get total count first
          const countResult = await mongo({
            action: "aggregate",
            collection: "objects",
            pipeline: [{ $match: query }, { $count: "total" }],
          });
          const total = countResult?.[0]?.total || 0;

          const objects = await mongo({
            action: "aggregate",
            collection: "objects",
            pipeline,
          });

          console.log("[exploreTimeRange] Aggregate result - total:", total, "returned:", objects?.length);
          return { total, objects };
        }

        // Use aggregation for proper sorting by min timeRanges.start
        const pipeline: any[] = [
          { $match: query },
          { $addFields: { _minTimeRangeStart: { $min: "$timeRanges.start" } } },
          { $sort: input.options?.sort || { _minTimeRangeStart: 1 } },
        ];

        if (input.options?.skip) {
          pipeline.push({ $skip: input.options.skip });
        }
        if (input.options?.limit) {
          pipeline.push({ $limit: input.options.limit });
        }

        // Default projection - excludes _minTimeRangeStart
        pipeline.push({
          $project: {
            _id: 1,
            name: 1,
            icon: 1,
            timeRanges: 1,
            summaries: { $map: { input: "$summaries", as: "s", in: "$$s.text" } },
            isEvent: 1,
            isPerson: 1,
            isRelationship: 1,
            isConversation: 1,
            isPromise: 1,
          },
        });

        console.log("[exploreTimeRange] Pipeline:", JSON.stringify(pipeline, null, 2));

        // Get total count first
        const countResult = await mongo({
          action: "aggregate",
          collection: "objects",
          pipeline: [{ $match: query }, { $count: "total" }],
        });
        const total = countResult?.[0]?.total || 0;

        const objects = await mongo({
          action: "aggregate",
          collection: "objects",
          pipeline,
        });

        console.log("[exploreTimeRange] Result - total:", total, "returned:", objects?.length);

        return { total, objects };
      }

      case "getTimeRange": {
        const pipeline = [
          {
            $match: {
              timeRanges: { $exists: true, $ne: [] },
            },
          },
          {
            $unwind: "$timeRanges",
          },
          {
            $group: {
              _id: null,
              minStart: { $min: "$timeRanges.start" },
              maxEnd: {
                $max: {
                  $ifNull: ["$timeRanges.end", "$timeRanges.start"],
                },
              },
            },
          },
        ];

        const result = await mongo({
          action: "aggregate",
          collection: "objects",
          pipeline,
        });

        if (result && result.length > 0) {
          return {
            start: result[0].minStart,
            end: result[0].maxEnd,
          };
        }

        return { start: null, end: null };
      }

      case "getCounts": {
        // Get cached counts or calculate if not available
        if (input.forceRefresh) {
          return await this.refreshCounts();
        }

        const cached = await this.getCachedCounts();
        if (cached && !cached.stale) {
          return cached;
        }

        // Cache doesn't exist or is stale, recalculate
        return await this.refreshCounts();
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
      getTimeRange: ["read"],
      getCounts: ["read"],
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
): (input: ObjectsRequest) => Promise<ObjectsResponse> {
  return auth.getResource<ObjectsRequest, ObjectsResponse>(
    "objects",
  );
}
