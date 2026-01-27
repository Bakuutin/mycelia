import { expect } from "@std/expect";
import { Auth } from "@/lib/auth/core.server.ts";
import { withFixtures } from "@/tests/fixtures.server.ts";
import { getMessengerResource } from "@/lib/messenger/resource.server.ts";
import { ObjectId } from "bson";
import { getMongoResource } from "@/lib/mongo/core.server.ts";

async function getMessengerResourceHelper(auth: Auth) {
  return getMessengerResource(auth);
}

Deno.test(
  "messenger resource is registered",
  withFixtures(["Admin", "Mongo"], async (admin: Auth) => {
    const resource = await getMessengerResourceHelper(admin);
    expect(resource).toBeDefined();
  }),
);

Deno.test(
  "upsertMessage creates message and auto-creates chat and sender",
  withFixtures(["Admin", "Mongo"], async (admin: Auth) => {
    const messenger = await getMessengerResourceHelper(admin);
    const timestamp = new Date("2025-01-15T10:30:00Z");

    const result = await messenger({
      action: "upsertMessage",
      platform: "telegram",
      chatExternalId: "123456789",
      externalId: "987654321",
      timestamp,
      senderExternalId: "111222333",
      senderName: "John Doe",
      text: "Hello, world!",
    });

    expect(result.messageId).toBeInstanceOf(ObjectId);
    expect(result.chatId).toBeInstanceOf(ObjectId);
    expect(result.senderId).toBeInstanceOf(ObjectId);
    expect(result.created).toBe(true);
    expect(result.chatCreated).toBe(true);
    expect(result.senderCreated).toBe(true);

    const mongo = await getMongoResource(admin);
    const message = await mongo({
      action: "findOne",
      collection: "messages",
      query: { _id: result.messageId },
    });

    expect(message).toBeDefined();
    expect(message.text).toBe("Hello, world!");
    expect(message.platform).toBe("telegram");
    expect(message.externalId).toBe("987654321");
    expect(message.timestamp).toBeInstanceOf(Date);
    expect(message.chatId).toEqual(result.chatId);
    expect(message.senderId).toEqual(result.senderId);

    const chat = await mongo({
      action: "findOne",
      collection: "chats",
      query: { _id: result.chatId },
    });

    expect(chat).toBeDefined();
    expect(chat.platform).toBe("telegram");
    expect(chat.externalId).toBe("123456789");

    const person = await mongo({
      action: "findOne",
      collection: "objects",
      query: { _id: result.senderId },
    });

    expect(person).toBeDefined();
    expect(person.isPerson).toBe(true);
    expect(person.name).toBe("John Doe");
    expect(person.messenger?.telegram?.id).toBe("111222333");
  }),
);

Deno.test(
  "upsertMessage updates existing message",
  withFixtures(["Admin", "Mongo"], async (admin: Auth) => {
    const messenger = await getMessengerResourceHelper(admin);
    const timestamp = new Date("2025-01-15T10:30:00Z");

    const firstResult = await messenger({
      action: "upsertMessage",
      platform: "telegram",
      chatExternalId: "123456789",
      externalId: "987654321",
      timestamp,
      senderExternalId: "111222333",
      senderName: "John Doe",
      text: "Original message",
    });

    expect(firstResult.created).toBe(true);

    const secondResult = await messenger({
      action: "upsertMessage",
      platform: "telegram",
      chatExternalId: "123456789",
      externalId: "987654321",
      timestamp: new Date("2025-01-15T10:31:00Z"),
      senderExternalId: "111222333",
      senderName: "John Doe",
      text: "Updated message",
    });

    expect(secondResult.created).toBe(false);
    expect(secondResult.messageId).toEqual(firstResult.messageId);

    const mongo = await getMongoResource(admin);
    const message = await mongo({
      action: "findOne",
      collection: "messages",
      query: { _id: firstResult.messageId },
    });

    expect(message.text).toBe("Updated message");
  }),
);

Deno.test(
  "upsertMessage uses existing chat if it exists",
  withFixtures(["Admin", "Mongo"], async (admin: Auth) => {
    const messenger = await getMessengerResourceHelper(admin);
    const mongo = await getMongoResource(admin);

    const existingChat = await mongo({
      action: "insertOne",
      collection: "chats",
      doc: {
        platform: "telegram",
        externalId: "123456789",
        name: "Existing Chat",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    const result = await messenger({
      action: "upsertMessage",
      platform: "telegram",
      chatExternalId: "123456789",
      externalId: "987654321",
      timestamp: new Date("2025-01-15T10:30:00Z"),
      senderExternalId: "111222333",
      senderName: "John Doe",
      text: "Hello!",
    });

    expect(result.chatId).toEqual(existingChat.insertedId);
    expect(result.chatCreated).toBe(false);
  }),
);

Deno.test(
  "upsertMessage uses existing Person if it exists",
  withFixtures(["Admin", "Mongo"], async (admin: Auth) => {
    const messenger = await getMessengerResourceHelper(admin);
    const mongo = await getMongoResource(admin);

    const existingPerson = await mongo({
      action: "insertOne",
      collection: "objects",
      doc: {
        name: "Existing Person",
        isPerson: true,
        messenger: {
          telegram: {
            id: "111222333",
          },
        },
        icon: { text: "👤" },
        createdAt: new Date(),
        updatedAt: new Date(),
        version: 1,
      },
    });

    const result = await messenger({
      action: "upsertMessage",
      platform: "telegram",
      chatExternalId: "123456789",
      externalId: "987654321",
      timestamp: new Date("2025-01-15T10:30:00Z"),
      senderExternalId: "111222333",
      senderName: "John Doe",
      text: "Hello!",
    });

    expect(result.senderId).toEqual(existingPerson.insertedId);
    expect(result.senderCreated).toBe(false);
  }),
);

Deno.test(
  "upsertMessage updates chat lastMessageDate",
  withFixtures(["Admin", "Mongo"], async (admin: Auth) => {
    const messenger = await getMessengerResourceHelper(admin);
    const mongo = await getMongoResource(admin);

    const firstTimestamp = new Date("2025-01-15T10:30:00Z");
    const firstResult = await messenger({
      action: "upsertMessage",
      platform: "telegram",
      chatExternalId: "123456789",
      externalId: "987654321",
      timestamp: firstTimestamp,
      senderExternalId: "111222333",
      senderName: "John Doe",
      text: "First message",
    });

    const chat1 = await mongo({
      action: "findOne",
      collection: "chats",
      query: { _id: firstResult.chatId },
    });

    expect(chat1.lastMessageDate).toBeInstanceOf(Date);
    expect(chat1.lastMessageDate.getTime()).toBe(firstTimestamp.getTime());

    const secondTimestamp = new Date("2025-01-15T11:00:00Z");
    await messenger({
      action: "upsertMessage",
      platform: "telegram",
      chatExternalId: "123456789",
      externalId: "987654322",
      timestamp: secondTimestamp,
      senderExternalId: "111222333",
      senderName: "John Doe",
      text: "Second message",
    });

    const chat2 = await mongo({
      action: "findOne",
      collection: "chats",
      query: { _id: firstResult.chatId },
    });

    expect(chat2.lastMessageDate.getTime()).toBe(secondTimestamp.getTime());
  }),
);

Deno.test(
  "upsertMessage handles replyToExternalId",
  withFixtures(["Admin", "Mongo"], async (admin: Auth) => {
    const messenger = await getMessengerResourceHelper(admin);
    const timestamp1 = new Date("2025-01-15T10:30:00Z");
    const timestamp2 = new Date("2025-01-15T10:31:00Z");

    const firstMessage = await messenger({
      action: "upsertMessage",
      platform: "telegram",
      chatExternalId: "123456789",
      externalId: "987654321",
      timestamp: timestamp1,
      senderExternalId: "111222333",
      senderName: "John Doe",
      text: "Original message",
    });

    const replyMessage = await messenger({
      action: "upsertMessage",
      platform: "telegram",
      chatExternalId: "123456789",
      externalId: "987654322",
      timestamp: timestamp2,
      senderExternalId: "444555666",
      senderName: "Jane Smith",
      text: "Reply message",
      replyToExternalId: "987654321",
    });

    expect(replyMessage.messageId).toBeInstanceOf(ObjectId);
    expect(replyMessage.messageId).not.toEqual(firstMessage.messageId);

    const mongo = await getMongoResource(admin);
    const reply = await mongo({
      action: "findOne",
      collection: "messages",
      query: { _id: replyMessage.messageId },
    });

    expect(reply.replyToId).toEqual(firstMessage.messageId);
    expect(reply.replyToExternalId).toBe("987654321");
  }),
);

Deno.test(
  "upsertMessage handles media attachments",
  withFixtures(["Admin", "Mongo"], async (admin: Auth) => {
    const messenger = await getMessengerResourceHelper(admin);
    const fileId = new ObjectId();

    const result = await messenger({
      action: "upsertMessage",
      platform: "telegram",
      chatExternalId: "123456789",
      externalId: "987654321",
      timestamp: new Date("2025-01-15T10:30:00Z"),
      senderExternalId: "111222333",
      senderName: "John Doe",
      text: "Check this out!",
      media: [
        {
          type: "image",
          fileId,
          url: "/api/files/507f1f77bcf86cd799439011",
          fileName: "photo.jpg",
          mimeType: "image/jpeg",
        },
      ],
    });

    const mongo = await getMongoResource(admin);
    const message = await mongo({
      action: "findOne",
      collection: "messages",
      query: { _id: result.messageId },
    });

    expect(message.media).toBeDefined();
    expect(message.media).toHaveLength(1);
    expect(message.media[0].type).toBe("image");
    expect(message.media[0].fileId).toEqual(fileId);
    expect(message.media[0].fileName).toBe("photo.jpg");
  }),
);

Deno.test(
  "upsertMessageBatch processes multiple messages",
  withFixtures(["Admin", "Mongo"], async (admin: Auth) => {
    const messenger = await getMessengerResourceHelper(admin);

    const messages = [
      {
        platform: "telegram",
        chatExternalId: "123456789",
        externalId: "msg1",
        timestamp: new Date("2025-01-15T10:30:00Z"),
        senderExternalId: "111222333",
        senderName: "John Doe",
        text: "Message 1",
      },
      {
        platform: "telegram",
        chatExternalId: "123456789",
        externalId: "msg2",
        timestamp: new Date("2025-01-15T10:31:00Z"),
        senderExternalId: "111222333",
        senderName: "John Doe",
        text: "Message 2",
      },
      {
        platform: "telegram",
        chatExternalId: "123456789",
        externalId: "msg3",
        timestamp: new Date("2025-01-15T10:32:00Z"),
        senderExternalId: "444555666",
        senderName: "Jane Smith",
        text: "Message 3",
      },
    ];

    const result = await messenger({
      action: "upsertMessageBatch",
      messages,
    });

    expect(result.processed).toBe(3);
    expect(result.created).toBe(3);
    expect(result.updated).toBe(0);
    expect(result.chatsCreated).toBe(1);
    expect(result.sendersCreated).toBe(2);
    expect(result.errors).toHaveLength(0);
    expect(result.results).toHaveLength(3);

    const mongo = await getMongoResource(admin);
    const allMessages = await mongo({
      action: "find",
      collection: "messages",
      query: { platform: "telegram" },
    });

    expect(allMessages).toHaveLength(3);
  }),
);

Deno.test(
  "upsertMessageBatch handles errors gracefully",
  withFixtures(["Admin", "Mongo"], async (admin: Auth) => {
    const messenger = await getMessengerResourceHelper(admin);

    const messages = [
      {
        platform: "telegram",
        chatExternalId: "123456789",
        externalId: "msg1",
        timestamp: new Date("2025-01-15T10:30:00Z"),
        senderExternalId: "111222333",
        senderName: "John Doe",
        text: "Valid message",
      },
      {
        platform: "telegram",
        chatExternalId: "123456789",
        externalId: "msg1",
        timestamp: "invalid-date",
        senderExternalId: "111222333",
        senderName: "John Doe",
        text: "Invalid timestamp",
      } as any,
    ];

    try {
      await messenger({
        action: "upsertMessageBatch",
        messages,
      });
    } catch (error) {
      expect(error).toBeDefined();
    }
  }),
);

Deno.test(
  "upsertChat creates new chat",
  withFixtures(["Admin", "Mongo"], async (admin: Auth) => {
    const messenger = await getMessengerResourceHelper(admin);

    const result = await messenger({
      action: "upsertChat",
      platform: "telegram",
      externalId: "123456789",
      name: "Test Chat",
    });

    expect(result.chatId).toBeInstanceOf(ObjectId);
    expect(result.created).toBe(true);

    const mongo = await getMongoResource(admin);
    const chat = await mongo({
      action: "findOne",
      collection: "chats",
      query: { _id: result.chatId },
    });

    expect(chat.platform).toBe("telegram");
    expect(chat.externalId).toBe("123456789");
    expect(chat.name).toBe("Test Chat");
  }),
);

Deno.test(
  "upsertChat updates existing chat",
  withFixtures(["Admin", "Mongo"], async (admin: Auth) => {
    const messenger = await getMessengerResourceHelper(admin);
    const mongo = await getMongoResource(admin);

    const existingChat = await mongo({
      action: "insertOne",
      collection: "chats",
      doc: {
        platform: "telegram",
        externalId: "123456789",
        name: "Original Name",
        createdAt: new Date("2025-01-01T00:00:00Z"),
        updatedAt: new Date("2025-01-01T00:00:00Z"),
      },
    });

    const result = await messenger({
      action: "upsertChat",
      platform: "telegram",
      externalId: "123456789",
      name: "Updated Name",
    });

    expect(result.chatId).toEqual(existingChat.insertedId);
    expect(result.created).toBe(false);

    const chat = await mongo({
      action: "findOne",
      collection: "chats",
      query: { _id: result.chatId },
    });

    expect(chat.name).toBe("Updated Name");
    expect(chat.createdAt).toBeInstanceOf(Date);
  }),
);

Deno.test(
  "upsertChatBatch processes multiple chats",
  withFixtures(["Admin", "Mongo"], async (admin: Auth) => {
    const messenger = await getMessengerResourceHelper(admin);

    const chats = [
      {
        platform: "telegram",
        externalId: "chat1",
        name: "Chat 1",
      },
      {
        platform: "telegram",
        externalId: "chat2",
        name: "Chat 2",
      },
    ];

    const result = await messenger({
      action: "upsertChatBatch",
      chats,
    });

    expect(result.processed).toBe(2);
    expect(result.created).toBe(2);
    expect(result.updated).toBe(0);
    expect(result.errors).toHaveLength(0);
    expect(result.results).toHaveLength(2);
  }),
);

Deno.test(
  "upsertContact creates new Person",
  withFixtures(["Admin", "Mongo"], async (admin: Auth) => {
    const messenger = await getMessengerResourceHelper(admin);

    const result = await messenger({
      action: "upsertContact",
      platform: "telegram",
      externalId: "111222333",
      name: "John Doe",
      icon: { text: "👤" },
      details: "Test contact",
    });

    expect(result.personId).toBeInstanceOf(ObjectId);
    expect(result.created).toBe(true);

    const mongo = await getMongoResource(admin);
    const person = await mongo({
      action: "findOne",
      collection: "objects",
      query: { _id: result.personId },
    });

    expect(person.isPerson).toBe(true);
    expect(person.name).toBe("John Doe");
    expect(person.messenger?.telegram?.id).toBe("111222333");
    expect(person.icon).toEqual({ text: "👤" });
    expect(person.details).toBe("Test contact");
  }),
);

Deno.test(
  "upsertContact uses existing Person",
  withFixtures(["Admin", "Mongo"], async (admin: Auth) => {
    const messenger = await getMessengerResourceHelper(admin);
    const mongo = await getMongoResource(admin);

    const existingPerson = await mongo({
      action: "insertOne",
      collection: "objects",
      doc: {
        name: "Existing Person",
        isPerson: true,
        messenger: {
          telegram: {
            id: "111222333",
          },
        },
        icon: { text: "👤" },
        createdAt: new Date(),
        updatedAt: new Date(),
        version: 1,
      },
    });

    const result = await messenger({
      action: "upsertContact",
      platform: "telegram",
      externalId: "111222333",
      name: "Updated Name",
    });

    expect(result.personId).toEqual(existingPerson.insertedId);
    expect(result.created).toBe(false);
  }),
);

Deno.test(
  "upsertContactBatch processes multiple contacts",
  withFixtures(["Admin", "Mongo"], async (admin: Auth) => {
    const messenger = await getMessengerResourceHelper(admin);

    const contacts = [
      {
        platform: "telegram",
        externalId: "user1",
        name: "User 1",
      },
      {
        platform: "telegram",
        externalId: "user2",
        name: "User 2",
      },
    ];

    const result = await messenger({
      action: "upsertContactBatch",
      contacts,
    });

    expect(result.processed).toBe(2);
    expect(result.created).toBe(2);
    expect(result.updated).toBe(0);
    expect(result.errors).toHaveLength(0);
    expect(result.results).toHaveLength(2);
  }),
);

Deno.test(
  "upsertMessage with chatName sets it on auto-created chat",
  withFixtures(["Admin", "Mongo"], async (admin: Auth) => {
    const messenger = await getMessengerResourceHelper(admin);

    const result = await messenger({
      action: "upsertMessage",
      platform: "telegram",
      chatExternalId: "123456789",
      externalId: "987654321",
      timestamp: new Date("2025-01-15T10:30:00Z"),
      senderExternalId: "111222333",
      senderName: "John Doe",
      text: "Hello!",
      chatName: "Custom Chat Name",
    });

    expect(result.chatCreated).toBe(true);

    const mongo = await getMongoResource(admin);
    const chat = await mongo({
      action: "findOne",
      collection: "chats",
      query: { _id: result.chatId },
    });

    expect(chat.name).toBe("Custom Chat Name");
  }),
);

Deno.test(
  "upsertMessage preserves raw data",
  withFixtures(["Admin", "Mongo"], async (admin: Auth) => {
    const messenger = await getMessengerResourceHelper(admin);

    const rawData = {
      message_id: 987654321,
      from: "John Doe",
      custom_field: "custom_value",
    };

    const result = await messenger({
      action: "upsertMessage",
      platform: "telegram",
      chatExternalId: "123456789",
      externalId: "987654321",
      timestamp: new Date("2025-01-15T10:30:00Z"),
      senderExternalId: "111222333",
      senderName: "John Doe",
      text: "Hello!",
      raw: rawData,
    });

    const mongo = await getMongoResource(admin);
    const message = await mongo({
      action: "findOne",
      collection: "messages",
      query: { _id: result.messageId },
    });

    expect(message.raw).toEqual(rawData);
  }),
);

Deno.test(
  "upsertMessage handles forwardedFrom",
  withFixtures(["Admin", "Mongo"], async (admin: Auth) => {
    const messenger = await getMessengerResourceHelper(admin);

    const result = await messenger({
      action: "upsertMessage",
      platform: "telegram",
      chatExternalId: "123456789",
      externalId: "987654321",
      timestamp: new Date("2025-01-15T10:30:00Z"),
      senderExternalId: "111222333",
      senderName: "John Doe",
      text: "Forwarded message",
      forwardedFrom: {
        name: "Original Sender",
        id: "999888777",
      },
    });

    const mongo = await getMongoResource(admin);
    const message = await mongo({
      action: "findOne",
      collection: "messages",
      query: { _id: result.messageId },
    });

    expect(message.forwardedFrom).toBeDefined();
    expect(message.forwardedFrom.name).toBe("Original Sender");
    expect(message.forwardedFrom.id).toBe("999888777");
  }),
);

