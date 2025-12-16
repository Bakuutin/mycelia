import { z } from "zod";
import { ObjectId } from "mongodb";
import { Resource } from "@/lib/auth/resources.ts";
import { Auth } from "@/lib/auth/core.server.ts";
import { getMongoResource } from "@/lib/mongo/core.server.ts";
import { getOrCreatePersonByMessengerId } from "./sdk.server.ts";

const zExternalId = z.union([z.string(), z.number()]);
const zDate = z.union([z.date(), z.string().transform((val) => new Date(val))]);

const mediaItemSchema = z.object({
  type: z.enum(["image", "video", "audio", "file", "sticker"]),
  url: z.string().optional(),
  fileId: z.union([z.instanceof(ObjectId), z.string().transform((val) => new ObjectId(val))]).optional(),
  path: z.string().optional(),
  mimeType: z.string().optional(),
  fileName: z.string().optional(),
  fileSize: z.number().optional(),
});

const upsertMessageSchema = z.object({
  action: z.literal("upsertMessage"),
  platform: z.string(),
  chatExternalId: zExternalId,
  externalId: zExternalId,
  timestamp: zDate,
  senderExternalId: zExternalId,
  senderName: z.string().optional(),
  text: z.string().optional(),
  media: z.array(mediaItemSchema).optional(),
  replyToExternalId: zExternalId.optional(),
  forwardedFrom: z.object({
    name: z.string().optional(),
    id: zExternalId.optional(),
  }).optional(),
  chatName: z.string().optional(),
  raw: z.any().optional(),
});

const upsertMessageBatchSchema = z.object({
  action: z.literal("upsertMessageBatch"),
  messages: z.array(upsertMessageSchema.omit({ action: true })),
});

const upsertChatSchema = z.object({
  action: z.literal("upsertChat"),
  platform: z.string(),
  externalId: zExternalId,
  name: z.string().optional(),
  lastMessageDate: zDate.optional(),
  raw: z.any().optional(),
});

const upsertChatBatchSchema = z.object({
  action: z.literal("upsertChatBatch"),
  chats: z.array(upsertChatSchema.omit({ action: true })),
});

const upsertContactSchema = z.object({
  action: z.literal("upsertContact"),
  platform: z.string(),
  externalId: zExternalId,
  name: z.string().optional(),
  icon: z.object({
    text: z.string().optional(),
    base64: z.string().optional(),
  }).optional(),
  details: z.string().optional(),
  raw: z.any().optional(),
});

const upsertContactBatchSchema = z.object({
  action: z.literal("upsertContactBatch"),
  contacts: z.array(upsertContactSchema.omit({ action: true })),
});

const messengerRequestSchema = z.discriminatedUnion("action", [
  upsertMessageSchema,
  upsertMessageBatchSchema,
  upsertChatSchema,
  upsertChatBatchSchema,
  upsertContactSchema,
  upsertContactBatchSchema,
]);

export type MessengerRequest = z.infer<typeof messengerRequestSchema>;
export type MessengerResponse = any;

export class MessengerResource implements Resource<MessengerRequest, MessengerResponse> {
  code = "messenger";
  description = "Messenger import operations with auto-creation of chats and contacts";
  
  schemas = {
    request: messengerRequestSchema,
    response: z.any(),
  };

  async use(input: MessengerRequest, auth: Auth): Promise<MessengerResponse> {
    const mongo = await getMongoResource(auth);

    switch (input.action) {
      case "upsertMessage": {
        return await this.upsertMessage(input, auth, mongo);
      }
      case "upsertMessageBatch": {
        return await this.upsertMessageBatch(input, auth, mongo);
      }
      case "upsertChat": {
        return await this.upsertChat(input, mongo);
      }
      case "upsertChatBatch": {
        return await this.upsertChatBatch(input, mongo);
      }
      case "upsertContact": {
        return await this.upsertContact(input, auth);
      }
      case "upsertContactBatch": {
        return await this.upsertContactBatch(input, auth);
      }
      default:
        throw new Error(`Unknown action: ${(input as any).action}`);
    }
  }

  private async upsertMessage(
    input: z.infer<typeof upsertMessageSchema>,
    auth: Auth,
    mongo: (req: any) => Promise<any>,
  ): Promise<any> {
    const { platform, chatExternalId, externalId, timestamp, senderExternalId, senderName, text, media, replyToExternalId, forwardedFrom, chatName, raw } = input;

    let chatId: ObjectId;
    let chatCreated = false;

    const existingChat = await mongo({
      action: "findOne",
      collection: "chats",
      query: {
        platform,
        externalId: chatExternalId,
      },
    });

    if (existingChat) {
      chatId = existingChat._id;
    } else {
      const now = new Date();
      const newChat = await mongo({
        action: "insertOne",
        collection: "chats",
        doc: {
          platform,
          externalId: chatExternalId,
          name: chatName,
          createdAt: now,
          updatedAt: now,
        },
      });
      chatId = newChat.insertedId;
      chatCreated = true;
    }

    const personResult = await getOrCreatePersonByMessengerId({
      platform,
      externalId: senderExternalId,
      name: senderName,
      auth,
    });
    const senderId = personResult._id;
    const senderCreated = personResult.created;

    let replyToId: ObjectId | undefined;
    if (replyToExternalId) {
      const repliedMessage = await mongo({
        action: "findOne",
        collection: "messages",
        query: {
          platform,
          chatId,
          externalId: replyToExternalId,
        },
      });
      if (repliedMessage) {
        replyToId = repliedMessage._id;
      }
    }

    const existingMessage = await mongo({
      action: "findOne",
      collection: "messages",
      query: {
        platform,
        chatId,
        externalId,
      },
    });

    const now = new Date();
    const messageDoc: any = {
      chatId,
      platform,
      externalId,
      timestamp,
      senderId,
      text,
      updatedAt: now,
      raw,
    };

    if (media && media.length > 0) {
      messageDoc.media = media.map(m => ({
        ...m,
        fileId: m.fileId instanceof ObjectId ? m.fileId : m.fileId ? new ObjectId(m.fileId) : undefined,
      }));
    }

    if (replyToId) {
      messageDoc.replyToId = replyToId;
      messageDoc.replyToExternalId = replyToExternalId;
    }

    if (forwardedFrom) {
      messageDoc.forwardedFrom = forwardedFrom;
    }

    let messageCreated = false;
    let messageId: ObjectId;

    if (existingMessage) {
      messageId = existingMessage._id;
      await mongo({
        action: "updateOne",
        collection: "messages",
        query: { _id: messageId },
        update: { $set: messageDoc },
      });
    } else {
      messageDoc.createdAt = now;
      const result = await mongo({
        action: "insertOne",
        collection: "messages",
        doc: messageDoc,
      });
      messageId = result.insertedId;
      messageCreated = true;
    }

    const chatLastMessageDate = existingChat?.lastMessageDate ? new Date(existingChat.lastMessageDate) : null;
    const shouldUpdateChatDate = !chatLastMessageDate || timestamp > chatLastMessageDate;

    if (shouldUpdateChatDate) {
      await mongo({
        action: "updateOne",
        collection: "chats",
        query: { _id: chatId },
        update: {
          $set: {
            lastMessageDate: timestamp,
            updatedAt: now,
          },
        },
      });
    }

    return {
      messageId,
      chatId,
      senderId,
      created: messageCreated,
      chatCreated,
      senderCreated,
    };
  }

  private async upsertMessageBatch(
    input: z.infer<typeof upsertMessageBatchSchema>,
    auth: Auth,
    mongo: (req: any) => Promise<any>,
  ): Promise<any> {
    const { messages } = input;
    const errors: any[] = [];
    let created = 0;
    let updated = 0;
    let chatsCreated = 0;
    let sendersCreated = 0;

    if (messages.length === 0) {
      return { processed: 0, created: 0, updated: 0, chatsCreated: 0, sendersCreated: 0, errors: [] };
    }

    const uniqueSenders = new Map<string, { platform: string; externalId: string | number; name?: string }>();
    const uniqueChats = new Map<string, { platform: string; externalId: string | number; name?: string }>();

    for (const msg of messages) {
      const senderKey = `${msg.platform}:${msg.senderExternalId}`;
      const chatKey = `${msg.platform}:${msg.chatExternalId}`;

      if (!uniqueSenders.has(senderKey)) {
        uniqueSenders.set(senderKey, {
          platform: msg.platform,
          externalId: msg.senderExternalId,
          name: msg.senderName,
        });
      }

      if (!uniqueChats.has(chatKey)) {
        uniqueChats.set(chatKey, {
          platform: msg.platform,
          externalId: msg.chatExternalId,
          name: msg.chatName,
        });
      }
    }

    const senderQueries = Array.from(uniqueSenders.values()).map(s => ({
      isPerson: true,
      [`messenger.${s.platform}.id`]: String(s.externalId),
    }));

    const chatQueries = Array.from(uniqueChats.values()).map(c => ({
      platform: c.platform,
      externalId: c.externalId,
    }));

    const [existingSenders, existingChats] = await Promise.all([
      senderQueries.length > 0
        ? mongo({ action: "find", collection: "objects", query: { $or: senderQueries } })
        : Promise.resolve([]),
      chatQueries.length > 0
        ? mongo({ action: "find", collection: "chats", query: { $or: chatQueries } })
        : Promise.resolve([]),
    ]);

    const senderCache = new Map<string, { _id: ObjectId; created: boolean }>();
    const chatCache = new Map<string, { _id: ObjectId; created: boolean }>();

    for (const person of existingSenders) {
      const platforms = Object.keys(person.messenger || {});
      for (const platform of platforms) {
        const externalId = person.messenger[platform].id;
        const key = `${platform}:${externalId}`;
        senderCache.set(key, { _id: person._id, created: false });
      }
    }

    for (const chat of existingChats) {
      const key = `${chat.platform}:${chat.externalId}`;
      chatCache.set(key, { _id: chat._id, created: false });
    }

    const sendersToCreate: any[] = [];
    const senderCreateOrder: string[] = [];
    const now = new Date();

    for (const [key, sender] of uniqueSenders) {
      if (!senderCache.has(key)) {
        sendersToCreate.push({
          name: sender.name || `Unknown ${sender.platform} user`,
          isPerson: true,
          icon: { text: "👤" },
          messenger: {
            [sender.platform]: {
              id: String(sender.externalId),
            },
          },
          createdAt: now,
          updatedAt: now,
          version: 1,
        });
        senderCreateOrder.push(key);
      }
    }

    if (sendersToCreate.length > 0) {
      const result = await mongo({
        action: "insertMany",
        collection: "objects",
        docs: sendersToCreate,
      });

      for (let i = 0; i < senderCreateOrder.length; i++) {
        const key = senderCreateOrder[i];
        senderCache.set(key, {
          _id: result.insertedIds[i],
          created: true,
        });
      }
      sendersCreated = sendersToCreate.length;
    }

    const chatsToCreate: any[] = [];
    const chatCreateOrder: string[] = [];

    for (const [key, chat] of uniqueChats) {
      if (!chatCache.has(key)) {
        chatsToCreate.push({
          platform: chat.platform,
          externalId: chat.externalId,
          name: chat.name,
          createdAt: now,
          updatedAt: now,
        });
        chatCreateOrder.push(key);
      }
    }

    if (chatsToCreate.length > 0) {
      const result = await mongo({
        action: "insertMany",
        collection: "chats",
        docs: chatsToCreate,
      });

      for (let i = 0; i < chatCreateOrder.length; i++) {
        const key = chatCreateOrder[i];
        chatCache.set(key, {
          _id: result.insertedIds[i],
          created: true,
        });
      }
      chatsCreated = chatsToCreate.length;
    }

    const messageQueries: any[] = [];
    for (const msg of messages) {
      const chatKey = `${msg.platform}:${msg.chatExternalId}`;
      const chatData = chatCache.get(chatKey);

      if (chatData) {
        messageQueries.push({
          platform: msg.platform,
          chatId: chatData._id,
          externalId: msg.externalId,
        });
      }
    }

    const replyToQueries: any[] = [];
    const replyToSet = new Set<string>();

    for (const msg of messages) {
      if (msg.replyToExternalId) {
        const chatKey = `${msg.platform}:${msg.chatExternalId}`;
        const chatData = chatCache.get(chatKey);

        if (chatData) {
          const replyKey = `${msg.platform}:${chatData._id.toString()}:${msg.replyToExternalId}`;
          if (!replyToSet.has(replyKey)) {
            replyToSet.add(replyKey);
            replyToQueries.push({
              platform: msg.platform,
              chatId: chatData._id,
              externalId: msg.replyToExternalId,
            });
          }
        }
      }
    }

    const [existingMessages, replyToMessages] = await Promise.all([
      messageQueries.length > 0
        ? mongo({ action: "find", collection: "messages", query: { $or: messageQueries } })
        : Promise.resolve([]),
      replyToQueries.length > 0
        ? mongo({ action: "find", collection: "messages", query: { $or: replyToQueries } })
        : Promise.resolve([]),
    ]);

    const existingMessageCache = new Map<string, ObjectId>();
    for (const msg of existingMessages) {
      const key = `${msg.platform}:${msg.chatId.toString()}:${msg.externalId}`;
      existingMessageCache.set(key, msg._id);
    }

    const replyToCache = new Map<string, ObjectId>();
    for (const msg of replyToMessages) {
      const key = `${msg.platform}:${msg.chatId.toString()}:${msg.externalId}`;
      replyToCache.set(key, msg._id);
    }

    const bulkOps: any[] = [];
    const results: any[] = [];

    for (let i = 0; i < messages.length; i++) {
      try {
        const msg = messages[i];
        const chatKey = `${msg.platform}:${msg.chatExternalId}`;
        const senderKey = `${msg.platform}:${msg.senderExternalId}`;

        const chatData = chatCache.get(chatKey);
        const senderData = senderCache.get(senderKey);

        if (!chatData || !senderData) {
          errors.push({
            index: i,
            error: `Failed to resolve chat or sender: chatKey=${chatKey}, senderKey=${senderKey}`,
          });
          continue;
        }

        const messageKey = `${msg.platform}:${chatData._id.toString()}:${msg.externalId}`;
        const existingMessageId = existingMessageCache.get(messageKey);

        const messageDoc: any = {
          chatId: chatData._id,
          platform: msg.platform,
          externalId: msg.externalId,
          timestamp: msg.timestamp instanceof Date ? msg.timestamp : new Date(msg.timestamp),
          senderId: senderData._id,
          text: msg.text,
          updatedAt: now,
          raw: msg.raw,
        };

        if (msg.media && msg.media.length > 0) {
          messageDoc.media = msg.media.map(m => ({
            ...m,
            fileId: m.fileId instanceof ObjectId ? m.fileId : m.fileId ? new ObjectId(m.fileId) : undefined,
          }));
        }

        if (msg.replyToExternalId) {
          const replyKey = `${msg.platform}:${chatData._id.toString()}:${msg.replyToExternalId}`;
          const replyToId = replyToCache.get(replyKey);
          if (replyToId) {
            messageDoc.replyToId = replyToId;
            messageDoc.replyToExternalId = msg.replyToExternalId;
          }
        }

        if (msg.forwardedFrom) {
          messageDoc.forwardedFrom = msg.forwardedFrom;
        }

        if (existingMessageId) {
          bulkOps.push({
            updateOne: {
              filter: { _id: existingMessageId },
              update: { $set: messageDoc },
            },
          });
          updated++;
          results.push({
            messageId: existingMessageId,
            chatId: chatData._id,
            senderId: senderData._id,
            created: false,
            chatCreated: chatData.created,
            senderCreated: senderData.created,
          });
        } else {
          messageDoc.createdAt = now;
          bulkOps.push({
            insertOne: {
              document: messageDoc,
            },
          });
          created++;
          results.push({
            messageId: null,
            chatId: chatData._id,
            senderId: senderData._id,
            created: true,
            chatCreated: chatData.created,
            senderCreated: senderData.created,
          });
        }
      } catch (error) {
        errors.push({
          index: i,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (bulkOps.length > 0) {
      await mongo({
        action: "bulkWrite",
        collection: "messages",
        operations: bulkOps,
        options: { ordered: false },
      });
    }

    const chatDateUpdates = new Map<string, Date>();
    for (const msg of messages) {
      const chatKey = `${msg.platform}:${msg.chatExternalId}`;
      const msgTimestamp = msg.timestamp instanceof Date ? msg.timestamp : new Date(msg.timestamp);

      const currentMax = chatDateUpdates.get(chatKey);
      if (!currentMax || msgTimestamp > currentMax) {
        chatDateUpdates.set(chatKey, msgTimestamp);
      }
    }

    const chatBulkOps: any[] = [];
    for (const [chatKey, maxTimestamp] of chatDateUpdates) {
      const chatData = chatCache.get(chatKey);
      if (chatData) {
        chatBulkOps.push({
          updateOne: {
            filter: { _id: chatData._id },
            update: {
              $max: { lastMessageDate: maxTimestamp },
              $set: { updatedAt: now },
            },
          },
        });
      }
    }

    if (chatBulkOps.length > 0) {
      await mongo({
        action: "bulkWrite",
        collection: "chats",
        operations: chatBulkOps,
      });
    }

    return {
      processed: messages.length,
      created,
      updated,
      chatsCreated,
      sendersCreated,
      errors,
      results,
    };
  }

  private async upsertChat(
    input: z.infer<typeof upsertChatSchema>,
    mongo: (req: any) => Promise<any>,
  ): Promise<any> {
    const { platform, externalId, name, lastMessageDate, raw } = input;

    const existing = await mongo({
      action: "findOne",
      collection: "chats",
      query: {
        platform,
        externalId,
      },
    });

    const now = new Date();
    const chatDoc: any = {
      platform,
      externalId,
      name,
      updatedAt: now,
      raw,
    };

    if (lastMessageDate) {
      chatDoc.lastMessageDate = lastMessageDate;
    }

    if (existing) {
      await mongo({
        action: "updateOne",
        collection: "chats",
        query: { _id: existing._id },
        update: { $set: chatDoc },
      });
      return {
        chatId: existing._id,
        created: false,
      };
    } else {
      chatDoc.createdAt = now;
      const result = await mongo({
        action: "insertOne",
        collection: "chats",
        doc: chatDoc,
      });
      return {
        chatId: result.insertedId,
        created: true,
      };
    }
  }

  private async upsertChatBatch(
    input: z.infer<typeof upsertChatBatchSchema>,
    mongo: (req: any) => Promise<any>,
  ): Promise<any> {
    const results: any[] = [];
    const errors: any[] = [];
    let created = 0;
    let updated = 0;

    for (let i = 0; i < input.chats.length; i++) {
      try {
        const result = await this.upsertChat(
          { ...input.chats[i], action: "upsertChat" },
          mongo,
        );
        results.push(result);
        if (result.created) {
          created++;
        } else {
          updated++;
        }
      } catch (error) {
        errors.push({
          index: i,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return {
      processed: input.chats.length,
      created,
      updated,
      errors,
      results,
    };
  }

  private async upsertContact(
    input: z.infer<typeof upsertContactSchema>,
    auth: Auth,
  ): Promise<any> {
    const { platform, externalId, name, icon, details, raw } = input;

    const personResult = await getOrCreatePersonByMessengerId({
      platform,
      externalId,
      name,
      auth,
    });

    if (icon || details || raw) {
      const mongo = await getMongoResource(auth);
      const update: any = {
        updatedAt: new Date(),
      };
      if (icon) update.icon = icon;
      if (details) update.details = details;
      if (raw) update.raw = raw;

      await mongo({
        action: "updateOne",
        collection: "objects",
        query: { _id: personResult._id },
        update: { $set: update },
      });
    }

    return {
      personId: personResult._id,
      created: personResult.created,
    };
  }

  private async upsertContactBatch(
    input: z.infer<typeof upsertContactBatchSchema>,
    auth: Auth,
  ): Promise<any> {
    const results: any[] = [];
    const errors: any[] = [];
    let created = 0;
    let updated = 0;

    for (let i = 0; i < input.contacts.length; i++) {
      try {
        const result = await this.upsertContact(
          { ...input.contacts[i], action: "upsertContact" },
          auth,
        );
        results.push(result);
        if (result.created) {
          created++;
        } else {
          updated++;
        }
      } catch (error) {
        errors.push({
          index: i,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return {
      processed: input.contacts.length,
      created,
      updated,
      errors,
      results,
    };
  }

  extractActions(input: MessengerRequest): { path: string[]; actions: string[] }[] {
    switch (input.action) {
      case "upsertMessage":
      case "upsertMessageBatch":
        return [{ path: ["messenger", "messages"], actions: ["write"] }];
      case "upsertChat":
      case "upsertChatBatch":
        return [{ path: ["messenger", "chats"], actions: ["write"] }];
      case "upsertContact":
      case "upsertContactBatch":
        return [{ path: ["messenger", "contacts"], actions: ["write"] }];
      default:
        return [{ path: ["messenger"], actions: ["write"] }];
    }
  }
}

export async function getMessengerResource(
  auth: Auth,
): Promise<(input: MessengerRequest) => Promise<MessengerResponse>> {
  return auth.getResource("messenger");
}

