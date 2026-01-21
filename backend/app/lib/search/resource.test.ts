import { expect } from "@std/expect";
import { Auth, defaultResourceManager } from "@/lib/auth/index.ts";
import { withFixtures } from "@/tests/fixtures.server.ts";
import { SearchResource, type SearchRequest } from "@/lib/search/resource.server.ts";
import { ObjectId } from "mongodb";

// Helper to get search resource with mock DB
async function getSearchResource(auth: Auth, db: any) {
  const resource = new SearchResource();
  defaultResourceManager.registerResource(resource);
  return auth.getResource<SearchRequest, any>("search");
}

// Helper to insert test transcriptions
async function insertTranscription(db: any, data: Partial<{
  text: string;
  start: Date;
  end: Date;
  duration: number;
  segments: any[];
}>) {
  const doc = {
    _id: new ObjectId(),
    text: data.text ?? "Test transcription",
    start: data.start ?? new Date(),
    end: data.end ?? new Date(),
    duration: data.duration ?? 60,
    segments: data.segments ?? [],
    ...data,
  };
  await db.collection("transcriptions").insertOne(doc);
  return doc;
}

// Helper to insert test messages
async function insertMessage(db: any, data: Partial<{
  text: string;
  platform: string;
  chatId: ObjectId;
  timestamp: Date;
  raw: any;
}>) {
  const doc = {
    _id: new ObjectId(),
    text: data.text ?? "Test message",
    platform: data.platform ?? "mycelia",
    chatId: data.chatId ?? new ObjectId(),
    timestamp: data.timestamp ?? new Date(),
    raw: data.raw ?? { role: "user", content: data.text ?? "Test message" },
    ...data,
  };
  await db.collection("messages").insertOne(doc);
  return doc;
}

// Helper to insert test objects
async function insertObject(db: any, data: Partial<{
  name: string;
  details: string;
  isPerson: boolean;
  isEvent: boolean;
  isRelationship: boolean;
  isPromise: boolean;
  aliases: string[];
  timeRanges: any[];
}>) {
  const doc = {
    _id: new ObjectId(),
    name: data.name ?? "Test Object",
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...data,
  };
  await db.collection("objects").insertOne(doc);
  return doc;
}

Deno.test(
  "search resource is registered",
  withFixtures(["Admin", "Mongo"], async (admin: Auth, { db }) => {
    const resource = await getSearchResource(admin, db);
    expect(resource).toBeDefined();
  }),
);

// ============================================================================
// searchTranscriptions tests
// ============================================================================

Deno.test(
  "searchTranscriptions finds matching text",
  withFixtures(["Admin", "Mongo"], async (admin: Auth, { db }) => {
    const resource = await getSearchResource(admin, db);

    await insertTranscription(db, { text: "We discussed therapy options today" });
    await insertTranscription(db, { text: "The weather is nice" });
    await insertTranscription(db, { text: "Therapy session went well" });

    const result = await resource({
      action: "searchTranscriptions",
      query: "therapy",
      limit: 20,
    });

    expect(result.source).toBe("transcriptions");
    expect(result.count).toBe(2);
    expect(result.results.every((r: any) => r.text.toLowerCase().includes("therapy"))).toBe(true);
  }),
);

Deno.test(
  "searchTranscriptions filters by date range",
  withFixtures(["Admin", "Mongo"], async (admin: Auth, { db }) => {
    const resource = await getSearchResource(admin, db);

    const oldDate = new Date("2024-01-01");
    const newDate = new Date("2024-06-01");

    await insertTranscription(db, { text: "Old meeting notes", start: oldDate, end: oldDate });
    await insertTranscription(db, { text: "New meeting notes", start: newDate, end: newDate });

    const result = await resource({
      action: "searchTranscriptions",
      query: "meeting",
      startDate: "2024-03-01" as unknown as Date,
      limit: 20,
    });

    expect(result.count).toBe(1);
    expect(result.results[0].text).toBe("New meeting notes");
  }),
);

Deno.test(
  "searchTranscriptions supports relative time (7d)",
  withFixtures(["Admin", "Mongo"], async (admin: Auth, { db }) => {
    const resource = await getSearchResource(admin, db);

    const recentDate = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000); // 3 days ago
    const oldDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days ago

    await insertTranscription(db, { text: "Recent discussion", start: recentDate, end: recentDate });
    await insertTranscription(db, { text: "Old discussion", start: oldDate, end: oldDate });

    const result = await resource({
      action: "searchTranscriptions",
      query: "discussion",
      startDate: "7d" as unknown as Date,
      limit: 20,
    });

    expect(result.count).toBe(1);
    expect(result.results[0].text).toBe("Recent discussion");
  }),
);

Deno.test(
  "searchTranscriptions is case insensitive",
  withFixtures(["Admin", "Mongo"], async (admin: Auth, { db }) => {
    const resource = await getSearchResource(admin, db);

    await insertTranscription(db, { text: "IMPORTANT meeting" });
    await insertTranscription(db, { text: "Important notes" });
    await insertTranscription(db, { text: "very important stuff" });

    const result = await resource({
      action: "searchTranscriptions",
      query: "IMPORTANT",
      limit: 20,
    });

    expect(result.count).toBe(3);
  }),
);

// ============================================================================
// searchMessages tests
// ============================================================================

Deno.test(
  "searchMessages finds matching text",
  withFixtures(["Admin", "Mongo"], async (admin: Auth, { db }) => {
    const resource = await getSearchResource(admin, db);

    await insertMessage(db, { text: "Can you help with my project?" });
    await insertMessage(db, { text: "The weather is nice" });
    await insertMessage(db, { text: "Project deadline is tomorrow" });

    const result = await resource({
      action: "searchMessages",
      query: "project",
      limit: 30,
    });

    expect(result.source).toBe("messages");
    expect(result.count).toBe(2);
  }),
);

Deno.test(
  "searchMessages filters by platform",
  withFixtures(["Admin", "Mongo"], async (admin: Auth, { db }) => {
    const resource = await getSearchResource(admin, db);

    await insertMessage(db, { text: "Mycelia message", platform: "mycelia" });
    await insertMessage(db, { text: "Telegram message", platform: "telegram" });

    const result = await resource({
      action: "searchMessages",
      query: "message",
      platform: "telegram",
      limit: 30,
    });

    expect(result.count).toBe(1);
    expect(result.results[0].platform).toBe("telegram");
  }),
);

Deno.test(
  "searchMessages filters by chatId",
  withFixtures(["Admin", "Mongo"], async (admin: Auth, { db }) => {
    const resource = await getSearchResource(admin, db);

    const chat1 = new ObjectId();
    const chat2 = new ObjectId();

    await insertMessage(db, { text: "Message in chat 1", chatId: chat1 });
    await insertMessage(db, { text: "Message in chat 2", chatId: chat2 });
    await insertMessage(db, { text: "Another in chat 1", chatId: chat1 });

    const result = await resource({
      action: "searchMessages",
      query: "message",
      chatId: chat1.toString(),
      limit: 30,
    });

    expect(result.count).toBe(1);
    expect(result.results[0].chatId.toString()).toBe(chat1.toString());
  }),
);

// ============================================================================
// searchObjects tests
// ============================================================================

Deno.test(
  "searchObjects finds by name",
  withFixtures(["Admin", "Mongo"], async (admin: Auth, { db }) => {
    const resource = await getSearchResource(admin, db);

    await insertObject(db, { name: "John Smith", isPerson: true });
    await insertObject(db, { name: "Jane Doe", isPerson: true });
    await insertObject(db, { name: "Johnny Appleseed", isPerson: true });

    const result = await resource({
      action: "searchObjects",
      query: "John",
      types: ["any"],
      limit: 20,
    });

    expect(result.source).toBe("objects");
    expect(result.count).toBe(2);
  }),
);

Deno.test(
  "searchObjects finds by aliases",
  withFixtures(["Admin", "Mongo"], async (admin: Auth, { db }) => {
    const resource = await getSearchResource(admin, db);

    await insertObject(db, { name: "Robert Johnson", aliases: ["Bob", "Bobby"] });
    await insertObject(db, { name: "Alice Smith" });

    const result = await resource({
      action: "searchObjects",
      query: "Bob",
      types: ["any"],
      limit: 20,
    });

    expect(result.count).toBe(1);
    expect(result.results[0].name).toBe("Robert Johnson");
  }),
);

Deno.test(
  "searchObjects finds by details",
  withFixtures(["Admin", "Mongo"], async (admin: Auth, { db }) => {
    const resource = await getSearchResource(admin, db);

    await insertObject(db, { name: "Dr. Smith", details: "My therapist at the wellness center" });
    await insertObject(db, { name: "John", details: "Friend from work" });

    const result = await resource({
      action: "searchObjects",
      query: "therapist",
      types: ["any"],
      limit: 20,
    });

    expect(result.count).toBe(1);
    expect(result.results[0].name).toBe("Dr. Smith");
  }),
);

Deno.test(
  "searchObjects filters by type",
  withFixtures(["Admin", "Mongo"], async (admin: Auth, { db }) => {
    const resource = await getSearchResource(admin, db);

    await insertObject(db, { name: "John", isPerson: true });
    await insertObject(db, { name: "Birthday Party", isEvent: true });
    await insertObject(db, { name: "Call John", isPromise: true });

    const result = await resource({
      action: "searchObjects",
      query: "John",
      types: ["person"],
      limit: 20,
    });

    expect(result.count).toBe(1);
    expect(result.results[0].type).toBe("person");
  }),
);

// ============================================================================
// Time parsing tests
// ============================================================================

Deno.test(
  "search handles minutes (m) correctly",
  withFixtures(["Admin", "Mongo"], async (admin: Auth, { db }) => {
    const resource = await getSearchResource(admin, db);

    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);

    await insertTranscription(db, { text: "Very recent note", start: fiveMinutesAgo, end: fiveMinutesAgo });
    await insertTranscription(db, { text: "Older note", start: twoHoursAgo, end: twoHoursAgo });

    const result = await resource({
      action: "searchTranscriptions",
      query: "note",
      startDate: "30m" as unknown as Date, // 30 minutes
      limit: 20,
    });

    expect(result.count).toBe(1);
    expect(result.results[0].text).toBe("Very recent note");
  }),
);

Deno.test(
  "search handles weeks (w) correctly",
  withFixtures(["Admin", "Mongo"], async (admin: Auth, { db }) => {
    const resource = await getSearchResource(admin, db);

    const oneWeekAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    const threeWeeksAgo = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000);

    await insertTranscription(db, { text: "This week meeting", start: oneWeekAgo, end: oneWeekAgo });
    await insertTranscription(db, { text: "Old meeting", start: threeWeeksAgo, end: threeWeeksAgo });

    const result = await resource({
      action: "searchTranscriptions",
      query: "meeting",
      startDate: "2w" as unknown as Date, // 2 weeks
      limit: 20,
    });

    expect(result.count).toBe(1);
    expect(result.results[0].text).toBe("This week meeting");
  }),
);
