import { z } from "zod";
import type { Db } from "mongodb";

import type { Auth } from "@/lib/auth/core.server.ts";
import type { Resource } from "@/lib/auth/resources.ts";
import { getRootDB } from "@/lib/mongo/core.server.ts";
import { permissionDenied } from "@/lib/auth/utils.ts";

export const MEMORY_EXPORT_COLLECTIONS = [
  "objects",
  "transcriptions",
  "messages",
  "chats",
] as const;

const collectionSchema = z.enum(MEMORY_EXPORT_COLLECTIONS);
const batchSizeSchema = z.number().int().min(1).max(1000).default(250);

const countSchema = z.object({
  action: z.literal("count"),
  collection: collectionSchema,
});

const firstBatchSchema = z.object({
  action: z.literal("getFirstBatch"),
  collection: collectionSchema,
  batchSize: batchSizeSchema,
});

const moreSchema = z.object({
  action: z.literal("getMore"),
  collection: collectionSchema,
  cursorId: z.string().min(1),
  batchSize: batchSizeSchema,
});

const requestSchema = z.discriminatedUnion("action", [
  countSchema,
  firstBatchSchema,
  moreSchema,
]);

const responseSchema = z.union([
  z.object({ count: z.number().int().nonnegative() }),
  z.object({
    cursorId: z.string(),
    data: z.array(z.record(z.string(), z.any())),
    hasMore: z.boolean(),
  }),
]);

export type MemoryExportRequest = z.infer<typeof requestSchema>;
export type MemoryExportResponse = z.infer<typeof responseSchema>;

type ExportCollection = typeof MEMORY_EXPORT_COLLECTIONS[number];

interface CursorEntry {
  collection: ExportCollection;
  cursor: any;
  expiresAt: number;
  principal: string;
}

const CURSOR_TTL_MS = 30 * 60 * 1000;
const EXCLUDED_MESSAGE_ROLES = ["system", "tool", "developer", "function"];

const PROJECTIONS: Record<ExportCollection, Record<string, 1>> = {
  objects: {
    _id: 1,
    name: 1,
    details: 1,
    summaries: 1,
    aliases: 1,
    location: 1,
    timeRanges: 1,
    relationship: 1,
    isPerson: 1,
    isEvent: 1,
    isRelationship: 1,
    isPromise: 1,
    isConversation: 1,
    isTag: 1,
    starred: 1,
    createdAt: 1,
    updatedAt: 1,
  },
  transcriptions: {
    _id: 1,
    text: 1,
    segments: 1,
    start: 1,
    end: 1,
    duration: 1,
    speaker: 1,
    speaker_name: 1,
    source_file_id: 1,
    original_id: 1,
    language: 1,
    createdAt: 1,
    updatedAt: 1,
  },
  messages: {
    _id: 1,
    text: 1,
    content: 1,
    role: 1,
    "raw.role": 1,
    "raw.content": 1,
    senderName: 1,
    "sender.name": 1,
    user: 1,
    author: 1,
    platform: 1,
    chatId: 1,
    timestamp: 1,
    date: 1,
    createdAt: 1,
    updatedAt: 1,
  },
  chats: {
    _id: 1,
    summary: 1,
    title: 1,
    name: 1,
    platform: 1,
    timestamp: 1,
    createdAt: 1,
    updatedAt: 1,
  },
};

export function memoryExportQuery(
  collection: ExportCollection,
): Record<string, unknown> {
  if (collection !== "messages") return {};
  return {
    role: { $nin: EXCLUDED_MESSAGE_ROLES },
    "raw.role": { $nin: EXCLUDED_MESSAGE_ROLES },
  };
}

export class MemoryExportResource
  implements Resource<MemoryExportRequest, MemoryExportResponse> {
  code = "memory-export";
  description =
    "Read-only, cursor-paginated export of portable personal memory";
  schemas = { request: requestSchema, response: responseSchema };

  private readonly cursors = new Map<string, CursorEntry>();

  protected getDatabase(): Promise<Db> {
    return getRootDB();
  }

  private async cleanupExpiredCursors(): Promise<void> {
    const now = Date.now();
    for (const [cursorId, entry] of this.cursors) {
      if (entry.expiresAt >= now) continue;
      this.cursors.delete(cursorId);
      await entry.cursor.close().catch(() => {});
    }
  }

  private async readBatch(cursor: any, batchSize: number): Promise<any[]> {
    const data: any[] = [];
    while (data.length < batchSize && await cursor.hasNext()) {
      const document = await cursor.next();
      if (document) data.push(document);
    }
    return data;
  }

  async use(
    input: MemoryExportRequest,
    auth: Auth,
  ): Promise<MemoryExportResponse> {
    await this.cleanupExpiredCursors();

    if (input.action === "getMore") {
      const entry = this.cursors.get(input.cursorId);
      if (
        !entry || entry.principal !== auth.principal ||
        entry.collection !== input.collection
      ) {
        permissionDenied(
          "Export cursor is missing or does not belong to this principal",
        );
      }
      const data = await this.readBatch(entry.cursor, input.batchSize);
      const hasMore = await entry.cursor.hasNext();
      if (hasMore) {
        entry.expiresAt = Date.now() + CURSOR_TTL_MS;
      } else {
        this.cursors.delete(input.cursorId);
        await entry.cursor.close();
      }
      return { cursorId: hasMore ? input.cursorId : "", data, hasMore };
    }

    const db = await this.getDatabase();
    const collection = db.collection(input.collection);
    const query = memoryExportQuery(input.collection);
    if (input.action === "count") {
      return { count: await collection.countDocuments(query) };
    }

    const cursor = collection.find(query, {
      projection: PROJECTIONS[input.collection],
      sort: { _id: 1 },
      batchSize: input.batchSize,
    });
    const data = await this.readBatch(cursor, input.batchSize);
    const hasMore = await cursor.hasNext();
    if (!hasMore) {
      await cursor.close();
      return { cursorId: "", data, hasMore: false };
    }

    const cursorId = crypto.randomUUID();
    this.cursors.set(cursorId, {
      collection: input.collection,
      cursor,
      expiresAt: Date.now() + CURSOR_TTL_MS,
      principal: auth.principal,
    });
    return { cursorId, data, hasMore: true };
  }

  extractActions(input: MemoryExportRequest) {
    return [{ path: ["memory-export", input.collection], actions: ["read"] }];
  }
}
