import { z } from "zod";
import { ObjectId } from "bson";

// Common schema parts
const zBase = z.object({
  _id: z.instanceof(ObjectId),
  createdAt: z.date(),
  updatedAt: z.date(),
  raw: z.any().optional(), // Platform-specific raw data
});

// Chat Schema (stored in 'chats' collection)
export const zChat = zBase.extend({
  // Metadata
  platform: z.string(), // e.g., 'telegram', 'whatsapp', 'signal'
  externalId: z.string(), // ID from the platform (e.g., chat_id)
  
  // Display Info
  name: z.string().optional(),
  type: z.enum(["private", "group", "channel"]).optional(),
  
  // Participants
  participantIds: z.array(z.instanceof(ObjectId)).optional(), // References to Person objects in 'objects' collection?
  
  // State
  lastMessageDate: z.date().optional(),
  
  // Visibility
  visibilityTier: z.number().default(1), // 1: Public/Core, 2: Protected, 3: Private
});

export type Chat = z.infer<typeof zChat>;

// Message Schema (stored in 'messages' collection)
export const zMessage = zBase.extend({
  // Relationships
  chatId: z.instanceof(ObjectId), // Reference to Chat
  senderId: z.instanceof(ObjectId).optional(), // Reference to Person object (if mapped)
  
  // Content
  content: z.string().optional(), // Text content
  media: z.array(z.object({
    type: z.enum(["image", "video", "audio", "file", "sticker"]),
    url: z.string().optional(), // Storage URL
    path: z.string().optional(), // Local path
    mimeType: z.string().optional(),
    fileName: z.string().optional(),
    fileSize: z.number().optional(),
  })).optional(),
  
  // Metadata
  platform: z.string(),
  externalId: z.string(), // ID from the platform (message_id)
  timestamp: z.date(),
  
  // Threading / Context
  replyToId: z.instanceof(ObjectId).optional(), // Internal ID
  replyToExternalId: z.string().optional(), // Platform ID
  
  forwardedFrom: z.object({
    name: z.string().optional(),
    id: z.string().optional(), // external id
  }).optional(),

  // Visibility
  visibilityTier: z.number().default(1),
});

export type Message = z.infer<typeof zMessage>;
