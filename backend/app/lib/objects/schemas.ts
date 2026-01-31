import { z } from "zod";
import { zObjectId, zDateOrString } from "@myceliasdk/zod-json-schema.ts";

export const zIcon = z.union([
  z.object({
    text: z.string().describe("Emoji or text icon (e.g., '🐯', '🏠️')")
  }),
  z.object({
    base64: z.string().describe("Base64-encoded image data")
  }),
]);

export const zObjectInput = z.object({
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
  starred: z.boolean().optional().describe(
    "True if the user has starred/favorited this object"
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

export const objectsRequestSchema = z.discriminatedUnion("action", [
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

// Helper function to get nested value from object
export function getNestedValue(obj: any, path: string): any {
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
