import { z } from "zod";
import { ObjectId } from "bson";

// Common schema parts
const zBase = z.object({
  _id: z.instanceof(ObjectId),
  createdAt: z.date(),
  updatedAt: z.date(),
  raw: z.any().optional(), // Platform-specific raw data
});

// Helper for external ID which can be string or number depending on platform
const zExternalId = z.union([z.string(), z.number(), z.instanceof(ObjectId)]);

// Chat Schema (stored in 'chats' collection)
export const zChat = zBase.extend({
  // Metadata
  platform: z.string(), // e.g., 'telegram', 'whatsapp', 'signal'
  externalId: zExternalId, // ID from the platform (e.g., chat_id)
  
  // Display Info
  name: z.string().optional(),
  type: z.enum(["private", "group", "channel"]).optional(),
  
  // State
  lastMessageDate: z.date().optional(),
});

export type Chat = z.infer<typeof zChat>;

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
});

export type Message = z.infer<typeof zMessage>;
