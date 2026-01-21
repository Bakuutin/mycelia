import { z } from "zod";
import { ObjectId } from "bson";
import { Resource } from "@/lib/auth/resources.ts";
import { Auth } from "@/lib/auth/core.server.ts";
import { getMongoResource } from "@/lib/mongo/core.server.ts";
import { zDateOrRelativeTime } from "@myceliasdk/zod-json-schema.ts";

// Schema for searching transcriptions (your recorded conversations/audio)
const searchTranscriptionsSchema = z.object({
  action: z.literal("searchTranscriptions").describe(
    "Search through transcribed audio recordings. Use this to find what was said in voice recordings, meetings, or any transcribed content."
  ),
  query: z.string().describe(
    "Search text to find in transcriptions (case-insensitive, partial match). Examples: 'therapy', 'project deadline', 'dinner plans'"
  ),
  startDate: zDateOrRelativeTime(
    "Filter results from this date onwards (ISO 8601 or relative like '7d' for 7 days ago)"
  ).optional(),
  endDate: zDateOrRelativeTime(
    "Filter results up to this date (ISO 8601 or relative)"
  ).optional(),
  limit: z.number().max(50).default(20).describe(
    "Maximum number of results to return (default: 20, max: 50)"
  ),
});

// Schema for searching messages (chat conversations with AI or messengers)
const searchMessagesSchema = z.object({
  action: z.literal("searchMessages").describe(
    "Search through chat messages from AI conversations or imported messenger chats (Telegram, etc.)"
  ),
  query: z.string().describe(
    "Search text to find in messages (case-insensitive, partial match)"
  ),
  platform: z.string().optional().describe(
    "Filter by platform: 'mycelia' (AI chats), 'telegram', etc. Leave empty for all platforms."
  ),
  chatId: z.string().optional().describe(
    "Filter to a specific chat/conversation ID"
  ),
  startDate: zDateOrRelativeTime(
    "Filter results from this date onwards"
  ).optional(),
  endDate: zDateOrRelativeTime(
    "Filter results up to this date"
  ).optional(),
  limit: z.number().max(100).default(30).describe(
    "Maximum number of results to return (default: 30, max: 100)"
  ),
});

// Schema for searching objects (knowledge graph - people, events, places, relationships)
const searchObjectsSchema = z.object({
  action: z.literal("searchObjects").describe(
    "Search through the knowledge graph: people, events, places, relationships, and promises. Use for finding entities and their connections."
  ),
  query: z.string().describe(
    "Search text to find in object names, aliases, and details"
  ),
  types: z.array(z.enum(["person", "event", "relationship", "promise", "place", "any"])).default(["any"]).describe(
    "Filter by object types. Use 'any' to search all types."
  ),
  startDate: zDateOrRelativeTime(
    "Filter objects active/created after this date"
  ).optional(),
  endDate: zDateOrRelativeTime(
    "Filter objects active/created before this date"
  ).optional(),
  limit: z.number().max(50).default(20).describe(
    "Maximum number of results to return (default: 20, max: 50)"
  ),
});

// Schema for semantic search (if you have embeddings)
const semanticSearchSchema = z.object({
  action: z.literal("semanticSearch").describe(
    "Find content by meaning, not just keywords. Useful for finding related content even when exact words differ."
  ),
  query: z.string().describe(
    "Natural language query describing what you're looking for. Example: 'discussions about work stress' or 'planning vacation activities'"
  ),
  collections: z.array(z.enum(["transcriptions", "messages", "objects"])).default(["transcriptions", "objects"]).describe(
    "Which collections to search in"
  ),
  startDate: zDateOrRelativeTime(
    "Filter results from this date onwards"
  ).optional(),
  endDate: zDateOrRelativeTime(
    "Filter results up to this date"
  ).optional(),
  limit: z.number().max(30).default(10).describe(
    "Maximum number of results (default: 10, max: 30)"
  ),
});

// Combined deep research for complex queries
const deepResearchSchema = z.object({
  action: z.literal("deepResearch").describe(
    "Comprehensive research across all data sources. Use for complex questions that may require searching multiple places. Returns combined, deduplicated results."
  ),
  query: z.string().describe(
    "Research question or topic. Examples: 'everything about my therapy sessions', 'discussions with John about the project', 'what happened last week regarding X'"
  ),
  includeTranscriptions: z.boolean().default(true).describe(
    "Search in voice recordings/transcriptions"
  ),
  includeMessages: z.boolean().default(true).describe(
    "Search in chat messages"
  ),
  includeObjects: z.boolean().default(true).describe(
    "Search in knowledge graph (people, events, etc.)"
  ),
  startDate: zDateOrRelativeTime(
    "Filter results from this date onwards"
  ).optional(),
  endDate: zDateOrRelativeTime(
    "Filter results up to this date"
  ).optional(),
  limit: z.number().max(50).default(30).describe(
    "Maximum total results to return across all sources"
  ),
});

const searchRequestSchema = z.discriminatedUnion("action", [
  searchTranscriptionsSchema,
  searchMessagesSchema,
  searchObjectsSchema,
  semanticSearchSchema,
  deepResearchSchema,
]);

export type SearchRequest = z.infer<typeof searchRequestSchema>;
export type SearchResponse = any;

function parseDate(dateInput: Date | undefined): Date | undefined {
  return dateInput;
}

export class SearchResource implements Resource<SearchRequest, SearchResponse> {
  code = "search";
  description = `Deep research tool for finding information across your personal data. 

Use this to:
- Find what you discussed last week about a topic
- Search for conversations about therapy, work, or any subject
- Find all mentions of a person or project
- Research everything related to a topic across recordings, chats, and your knowledge graph

Available actions:
- searchTranscriptions: Find content in voice recordings/transcriptions
- searchMessages: Find content in chat conversations  
- searchObjects: Find people, events, places, relationships in knowledge graph
- deepResearch: Comprehensive search across all sources (recommended for complex queries)`;

  schemas = {
    request: searchRequestSchema as z.ZodType<SearchRequest>,
    response: z.any(),
  };

  async use(input: SearchRequest, auth: Auth): Promise<SearchResponse> {
    const mongo = await getMongoResource(auth);

    switch (input.action) {
      case "searchTranscriptions": {
        const searchRegex = { $regex: input.query, $options: "i" };
        const query: any = {
          $or: [
            { text: searchRegex },
            { "segments.text": searchRegex },
          ],
        };
        
        const startDate = parseDate(input.startDate);
        const endDate = parseDate(input.endDate);
        
        if (startDate) query.start = { ...query.start, $gte: startDate };
        if (endDate) query.end = { ...query.end, $lte: endDate };

        const results = await mongo({
          action: "find",
          collection: "transcriptions",
          query,
          options: {
            sort: { start: -1 },
            limit: input.limit,
            projection: {
              _id: 1,
              text: 1,
              start: 1,
              end: 1,
              duration: 1,
            },
          },
        });

        return {
          source: "transcriptions",
          count: results.length,
          results: results.map((r: any) => ({
            id: r._id,
            text: r.text,
            start: r.start,
            end: r.end,
            duration: r.duration,
            type: "transcription",
          })),
        };
      }

      case "searchMessages": {
        const searchRegex = { $regex: input.query, $options: "i" };
        const query: any = {
          $or: [
            { text: searchRegex },
            { "raw.content": searchRegex },
          ],
        };
        
        if (input.platform) query.platform = input.platform;
        if (input.chatId) query.chatId = new ObjectId(input.chatId);
        
        const startDate = parseDate(input.startDate);
        const endDate = parseDate(input.endDate);
        
        if (startDate) query.timestamp = { ...query.timestamp, $gte: startDate };
        if (endDate) query.timestamp = { ...query.timestamp, $lte: endDate };

        const results = await mongo({
          action: "find",
          collection: "messages",
          query,
          options: {
            sort: { timestamp: -1 },
            limit: input.limit,
            projection: {
              _id: 1,
              text: 1,
              timestamp: 1,
              platform: 1,
              chatId: 1,
              "raw.role": 1,
            },
          },
        });

        return {
          source: "messages",
          count: results.length,
          results: results.map((r: any) => ({
            id: r._id,
            text: r.text,
            timestamp: r.timestamp,
            platform: r.platform,
            chatId: r.chatId,
            role: r.raw?.role,
            type: "message",
          })),
        };
      }

      case "searchObjects": {
        const searchRegex = { $regex: input.query, $options: "i" };
        const query: any = {
          $or: [
            { name: searchRegex },
            { aliases: searchRegex },
            { details: searchRegex },
          ],
        };

        // Filter by types
        if (input.types && !input.types.includes("any")) {
          const typeFilters: any[] = [];
          if (input.types.includes("person")) typeFilters.push({ isPerson: true });
          if (input.types.includes("event")) typeFilters.push({ isEvent: true });
          if (input.types.includes("relationship")) typeFilters.push({ isRelationship: true });
          if (input.types.includes("promise")) typeFilters.push({ isPromise: true });
          if (typeFilters.length > 0) {
            query.$and = [{ $or: typeFilters }];
          }
        }

        const startDate = parseDate(input.startDate);
        const endDate = parseDate(input.endDate);
        
        if (startDate || endDate) {
          const timeRangeQuery: any = {};
          if (startDate) timeRangeQuery.$gte = startDate;
          if (endDate) timeRangeQuery.$lte = endDate;
          query["timeRanges.start"] = timeRangeQuery;
        }

        const results = await mongo({
          action: "find",
          collection: "objects",
          query,
          options: {
            sort: { updatedAt: -1 },
            limit: input.limit,
            projection: {
              _id: 1,
              name: 1,
              details: 1,
              icon: 1,
              isPerson: 1,
              isEvent: 1,
              isRelationship: 1,
              isPromise: 1,
              timeRanges: 1,
            },
          },
        });

        return {
          source: "objects",
          count: results.length,
          results: results.map((r: any) => ({
            id: r._id,
            name: r.name,
            details: r.details,
            icon: r.icon,
            type: r.isPerson ? "person" : r.isEvent ? "event" : r.isRelationship ? "relationship" : r.isPromise ? "promise" : "object",
            timeRanges: r.timeRanges,
          })),
        };
      }

      case "semanticSearch": {
        // For now, fall back to keyword search across collections
        // In the future, this could use vector embeddings
        const searchRegex = { $regex: input.query, $options: "i" };
        const results: any[] = [];
        
        const startDate = parseDate(input.startDate);
        const endDate = parseDate(input.endDate);

        if (input.collections.includes("transcriptions")) {
          const query: any = { text: searchRegex };
          if (startDate) query.start = { $gte: startDate };
          if (endDate) query.end = { $lte: endDate };
          
          const transcriptions = await mongo({
            action: "find",
            collection: "transcriptions",
            query,
            options: { sort: { start: -1 }, limit: input.limit },
          });
          results.push(...transcriptions.map((r: any) => ({
            source: "transcription",
            id: r._id,
            text: r.text,
            date: r.start,
          })));
        }

        if (input.collections.includes("objects")) {
          const query: any = {
            $or: [
              { name: searchRegex },
              { details: searchRegex },
            ],
          };
          const objects = await mongo({
            action: "find",
            collection: "objects",
            query,
            options: { sort: { updatedAt: -1 }, limit: input.limit },
          });
          results.push(...objects.map((r: any) => ({
            source: "object",
            id: r._id,
            name: r.name,
            details: r.details,
            type: r.isPerson ? "person" : r.isEvent ? "event" : "other",
          })));
        }

        return {
          source: "semantic",
          count: results.length,
          results: results.slice(0, input.limit),
        };
      }

      case "deepResearch": {
        const allResults: any[] = [];
        const searchRegex = { $regex: input.query, $options: "i" };
        const startDate = parseDate(input.startDate);
        const endDate = parseDate(input.endDate);
        const perSourceLimit = Math.ceil(input.limit / 3);

        // Search transcriptions
        if (input.includeTranscriptions) {
          const query: any = {
            $or: [{ text: searchRegex }, { "segments.text": searchRegex }],
          };
          if (startDate) query.start = { $gte: startDate };
          if (endDate) query.end = { $lte: endDate };

          const transcriptions = await mongo({
            action: "find",
            collection: "transcriptions",
            query,
            options: {
              sort: { start: -1 },
              limit: perSourceLimit,
              projection: { _id: 1, text: 1, start: 1, end: 1 },
            },
          });

          allResults.push(...transcriptions.map((r: any) => ({
            source: "transcription",
            id: r._id,
            content: r.text,
            date: r.start,
            endDate: r.end,
            relevance: "keyword_match",
          })));
        }

        // Search messages
        if (input.includeMessages) {
          const query: any = {
            $or: [{ text: searchRegex }, { "raw.content": searchRegex }],
          };
          if (startDate) query.timestamp = { $gte: startDate };
          if (endDate) query.timestamp = { ...query.timestamp, $lte: endDate };

          const messages = await mongo({
            action: "find",
            collection: "messages",
            query,
            options: {
              sort: { timestamp: -1 },
              limit: perSourceLimit,
              projection: { _id: 1, text: 1, timestamp: 1, platform: 1, chatId: 1 },
            },
          });

          allResults.push(...messages.map((r: any) => ({
            source: "message",
            id: r._id,
            content: r.text,
            date: r.timestamp,
            platform: r.platform,
            chatId: r.chatId,
            relevance: "keyword_match",
          })));
        }

        // Search objects
        if (input.includeObjects) {
          const query: any = {
            $or: [
              { name: searchRegex },
              { aliases: searchRegex },
              { details: searchRegex },
            ],
          };

          const objects = await mongo({
            action: "find",
            collection: "objects",
            query,
            options: {
              sort: { updatedAt: -1 },
              limit: perSourceLimit,
              projection: { _id: 1, name: 1, details: 1, icon: 1, isPerson: 1, isEvent: 1, timeRanges: 1 },
            },
          });

          allResults.push(...objects.map((r: any) => ({
            source: "object",
            id: r._id,
            name: r.name,
            content: r.details,
            icon: r.icon,
            type: r.isPerson ? "person" : r.isEvent ? "event" : "object",
            timeRanges: r.timeRanges,
            relevance: "keyword_match",
          })));
        }

        // Sort by date (most recent first) and limit
        allResults.sort((a, b) => {
          const dateA = a.date || a.timeRanges?.[0]?.start || new Date(0);
          const dateB = b.date || b.timeRanges?.[0]?.start || new Date(0);
          return new Date(dateB).getTime() - new Date(dateA).getTime();
        });

        return {
          query: input.query,
          totalResults: allResults.length,
          sources: {
            transcriptions: input.includeTranscriptions,
            messages: input.includeMessages,
            objects: input.includeObjects,
          },
          dateRange: {
            start: startDate,
            end: endDate,
          },
          results: allResults.slice(0, input.limit),
        };
      }

      default:
        throw new Error("Unknown search action");
    }
  }

  extractActions(input: SearchRequest) {
    return [
      {
        path: ["search"],
        actions: ["read"],
      },
    ];
  }
}

export function getSearchResource(
  auth: Auth,
): (input: SearchRequest) => Promise<SearchResponse> {
  return auth.getResource<SearchRequest, SearchResponse>("search");
}
