import { z } from "zod";
import { ObjectId } from "bson";

// Common schema parts
const zBase = z.object({
  _id: z.instanceof(ObjectId),
  createdAt: z.date(),
  updatedAt: z.date(),
  raw: z.any().optional(), // Platform-specific raw data
});

export const zChatToolMode = z.enum(["auto", "none", "custom"]);
export type ChatToolMode = z.infer<typeof zChatToolMode>;

export const zChatToolPolicy = z.object({
  mode: zChatToolMode,
  enabledTools: z.array(z.string()),
});
export type ChatToolPolicy = z.infer<typeof zChatToolPolicy>;

export const zChatRunState = z.enum([
  "submitted",
  "streaming",
  "needs_approval",
  "completed",
  "failed",
  "cancelled",
  "interrupted",
]);
export type ChatRunState = z.infer<typeof zChatRunState>;

export const zChatRunSummary = z.object({
  runId: z.string(),
  state: zChatRunState,
  updatedAt: z.date(),
  startedAt: z.date().optional(),
  finishedAt: z.date().optional(),
  error: z.string().optional(),
});
export type ChatRunSummary = z.infer<typeof zChatRunSummary>;

// Helper for external ID which can be string or number depending on platform
const zExternalId = z.union([z.string(), z.number(), z.instanceof(ObjectId)]);

// Chat Schema (stored in 'chats' collection)
export const zChat = zBase.extend({
  userId: z.string().optional(),
  // Metadata
  platform: z.string(), // e.g., 'telegram', 'whatsapp', 'signal'
  externalId: zExternalId, // ID from the platform (e.g., chat_id)

  // Display Info
  name: z.string().optional(),
  title: z.string().optional(),
  titleSource: z.enum(["provisional", "generated", "user"]).optional(),
  type: z.enum(["private", "group", "channel"]).optional(),

  // State
  lastMessageDate: z.date().optional(),
  lastReadAt: z.date().optional(),
  messageCount: z.number().int().nonnegative().optional(),
  favoritedAt: z.date().optional(),
  model: z.string().optional(),
  providerProfileId: z.string().optional(),
  toolMode: zChatToolMode.optional(),
  enabledTools: z.array(z.string()).optional(),
  lastResponseModel: z.string().optional(),
  lastResponseProviderId: z.string().optional(),
  lastResponseProviderName: z.string().optional(),
  activeRunId: z.string().optional(),
  lastRun: zChatRunSummary.optional(),
});

export type Chat = z.infer<typeof zChat>;

export const zChatSummary = zChat.extend({
  messageCount: z.number().int().nonnegative(),
  toolMode: zChatToolMode,
  enabledTools: z.array(z.string()),
  unread: z.boolean(),
});
export type ChatSummary = z.infer<typeof zChatSummary>;

export interface ChatToolCatalogEntry {
  name: string;
  label: string;
  description?: string;
  group: "Search" | "Knowledge" | "Actions" | "Docs" | "Advanced data";
  needsApproval: boolean;
  defaultEnabled: boolean;
}

// Message Schema (stored in 'messages' collection)
export const zMessage = zBase.extend({
  // Relationships
  chatId: z.instanceof(ObjectId), // Reference to Chat
  senderId: z.instanceof(ObjectId), // Reference to Person object (required)

  // Content
  text: z.string().optional(), // Text content
  media: z.array(z.object({
    type: z.enum(["image", "video", "audio", "file", "sticker"]),
    url: z.string().optional(), // Storage URL
    fileId: z.string().optional(), // GridFS ID
    path: z.string().optional(), // Local path
    mimeType: z.string().optional(),
    fileName: z.string().optional(),
    fileSize: z.number().optional(),
  })).optional(),

  // Metadata
  platform: z.string(),
  externalId: zExternalId, // ID from the platform (message_id)
  timestamp: z.date(),

  // Threading / Context
  replyToId: z.instanceof(ObjectId).optional(), // Internal ID
  replyToExternalId: zExternalId.optional(), // Platform ID

  forwardedFrom: z.object({
    name: z.string().optional(),
    id: zExternalId.optional(), // external id
  }).optional(),
  pinnedAt: z.date().optional(),
});

export type Message = z.infer<typeof zMessage>;
