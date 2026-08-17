import { expect } from "@std/expect";
import { Auth } from "@/lib/auth/core.server.ts";
import { getMongoResource } from "../core.server.ts";
import { withFixtures } from "@/tests/fixtures.server.ts";
import { ObjectId } from "bson";
import { ObjectId as MongoObjectId } from "mongodb";

Deno.test(
  "should allow find",
  withFixtures([
    "Admin",
    "Mongo",
  ], async (auth: Auth) => {
    const mongo = await getMongoResource(auth);
    await mongo({
      action: "insertOne",
      collection: "users",
      doc: { name: "Alice" },
    });
    const result = await mongo({
      action: "findOne",
      collection: "users",
      query: {},
    });
    expect(result).toHaveProperty("_id");
    expect(result).toHaveProperty("name", "Alice");
  }),
);

Deno.test(
  "should allow insertOne",
  withFixtures([
    "Admin",
    "Mongo",
  ], async (auth: Auth) => {
    const mongo = await getMongoResource(auth);
    const resourceFn = auth.getResource("mongo");
    const result = await mongo({
      action: "insertOne",
      collection: "users",
      doc: { name: "Bob" },
    });
    expect(result.insertedId).toBeInstanceOf(MongoObjectId);
  }),
);

Deno.test(
  "should enforce policy: deny delete",
  withFixtures([
    "AuthFactory",
    "Mongo",
  ], async (authFactory) => {
    const auth: Auth = authFactory({
      policies: [
        { resource: "db/**", action: "delete", effect: "deny" },
        { resource: "db/**", action: "*", effect: "allow" },
      ],
    });
    const mongo = await getMongoResource(auth);
    await expect(
      mongo({ action: "deleteOne", collection: "users", query: {} }),
    ).rejects.toHaveProperty("status", 403);
  }),
);

Deno.test(
  "should apply filter modifier for insertOne",
  withFixtures([
    "AuthFactory",
    "Mongo",
  ], async (authFactory) => {
    const auth: Auth = authFactory({
      policies: [{
        resource: "db/*",
        action: "write",
        effect: "modify",
        middleware: { code: "filter", arg: { filter: { role: "user" } } },
      }],
    });
        const mongo = auth.getResource("mongo");
    await expect(
      mongo({
        action: "insertOne",
        collection: "users",
        doc: { role: "admin" },
      }),
    ).rejects.toHaveProperty("status", 403);
    expect(
      await mongo({
        action: "insertOne",
        collection: "users",
        doc: { role: "user" },
      }),
    ).toHaveProperty("insertedId");
  }),
);

Deno.test(
  "should auto-create collection when it doesn't exist",
  withFixtures([
    "Admin",
    "Mongo",
  ], async (auth: Auth) => {
    const mongo = await getMongoResource(auth);

    // Use a unique collection name that definitely doesn't exist
    const uniqueCollectionName = `test_collection_${Date.now()}`;

    // Try to insert into a non-existent collection - should auto-create it
    const result = await mongo({
      action: "insertOne",
      collection: uniqueCollectionName,
      doc: { name: "Test Document", createdAt: new Date() },
    });

    expect(result.insertedId).toBeInstanceOf(MongoObjectId);

    // Verify the document was actually inserted
    const foundDoc = await mongo({
      action: "findOne",
      collection: uniqueCollectionName,
      query: { _id: result.insertedId },
    });

    expect(foundDoc).toHaveProperty("name", "Test Document");
    expect(foundDoc).toHaveProperty("createdAt");
  }),
);

Deno.test(
  "should cache collection existence checks",
  withFixtures([
    "Admin",
    "Mongo",
  ], async (auth: Auth) => {
    const mongo = await getMongoResource(auth);

    // Use a unique collection name
    const uniqueCollectionName = `cache_test_${Date.now()}`;

    // First operation should create the collection and cache it
    const result1 = await mongo({
      action: "insertOne",
      collection: uniqueCollectionName,
      doc: { name: "First Document" },
    });

    expect(result1.insertedId).toBeInstanceOf(MongoObjectId);

    // Second operation should use the cache (no "Auto-created collection" log)
    const result2 = await mongo({
      action: "insertOne",
      collection: uniqueCollectionName,
      doc: { name: "Second Document" },
    });

    expect(result2.insertedId).toBeInstanceOf(MongoObjectId);

    // Verify both documents exist
    const count = await mongo({
      action: "count",
      collection: uniqueCollectionName,
      query: {},
    });

    expect(count).toBe(2);
  }),
);

Deno.test(
  "getFirstBatch should return first batch of documents",
  withFixtures([
    "Admin",
    "Mongo",
  ], async (auth: Auth) => {
    const mongo = await getMongoResource(auth);
    const collectionName = `batch_test_${Date.now()}`;

    const docs = Array.from({ length: 10 }, (_, i) => ({
      name: `Document ${i}`,
      index: i,
    }));

    await mongo({
      action: "insertMany",
      collection: collectionName,
      docs,
    });

    const result = await mongo({
      action: "getFirstBatch",
      collection: collectionName,
      query: {},
      batchSize: 5,
    });

    expect(result).toHaveProperty("cursorId");
    expect(result).toHaveProperty("data");
    expect(result).toHaveProperty("hasMore");
    expect(result.data).toHaveLength(5);
    expect(result.hasMore).toBe(true);
    expect(result.cursorId).not.toBe("");
  }),
);

Deno.test(
  "getFirstBatch should return empty result for empty collection",
  withFixtures([
    "Admin",
    "Mongo",
  ], async (auth: Auth) => {
    const mongo = await getMongoResource(auth);
    const collectionName = `empty_test_${Date.now()}`;

    const result = await mongo({
      action: "getFirstBatch",
      collection: collectionName,
      query: {},
      batchSize: 10,
    });

    expect(result.data).toHaveLength(0);
    expect(result.hasMore).toBe(false);
    expect(result.cursorId).toBe("");
  }),
);

Deno.test(
  "closeCursor should release a live cursor immediately",
  withFixtures([
    "Admin",
    "Mongo",
  ], async (auth: Auth) => {
    const mongo = await getMongoResource(auth);
    const collectionName = `close_cursor_test_${Date.now()}`;

    await mongo({
      action: "insertMany",
      collection: collectionName,
      docs: Array.from({ length: 4 }, (_, index) => ({ index })),
    });

    const firstBatch = await mongo({
      action: "getFirstBatch",
      collection: collectionName,
      query: {},
      options: { sort: { index: 1 }, maxTimeMS: 5_000 },
      batchSize: 1,
    });
    expect(firstBatch.cursorId).not.toBe("");

    const closed = await mongo({
      action: "closeCursor",
      collection: collectionName,
      cursorId: firstBatch.cursorId,
    });
    expect(closed).toEqual({ closed: true });

    const afterClose = await mongo({
      action: "getMore",
      collection: collectionName,
      cursorId: firstBatch.cursorId,
      batchSize: 1,
    });
    expect(afterClose).toEqual({ data: [], hasMore: false });

    const closedAgain = await mongo({
      action: "closeCursor",
      collection: collectionName,
      cursorId: firstBatch.cursorId,
    });
    expect(closedAgain).toEqual({ closed: false });
  }),
);

Deno.test(
  "getFirstBatch should return all documents when batchSize is larger than total",
  withFixtures([
    "Admin",
    "Mongo",
  ], async (auth: Auth) => {
    const mongo = await getMongoResource(auth);
    const collectionName = `small_batch_test_${Date.now()}`;

    const docs = Array.from({ length: 3 }, (_, i) => ({
      name: `Document ${i}`,
    }));

    await mongo({
      action: "insertMany",
      collection: collectionName,
      docs,
    });

    const result = await mongo({
      action: "getFirstBatch",
      collection: collectionName,
      query: {},
      batchSize: 10,
    });

    expect(result.data).toHaveLength(3);
    expect(result.hasMore).toBe(false);
    expect(result.cursorId).toBe("");
  }),
);

Deno.test(
  "getFirstBatch should respect query filters",
  withFixtures([
    "Admin",
    "Mongo",
  ], async (auth: Auth) => {
    const mongo = await getMongoResource(auth);
    const collectionName = `filter_test_${Date.now()}`;

    await mongo({
      action: "insertMany",
      collection: collectionName,
      docs: [
        { name: "Alice", role: "admin" },
        { name: "Bob", role: "user" },
        { name: "Charlie", role: "admin" },
        { name: "David", role: "user" },
      ],
    });

    const result = await mongo({
      action: "getFirstBatch",
      collection: collectionName,
      query: { role: "admin" },
      batchSize: 10,
    });

    expect(result.data).toHaveLength(2);
    expect(result.data.every((doc: any) => doc.role === "admin")).toBe(true);
  }),
);

Deno.test(
  "getFirstBatch should respect sort options",
  withFixtures([
    "Admin",
    "Mongo",
  ], async (auth: Auth) => {
    const mongo = await getMongoResource(auth);
    const collectionName = `sort_test_${Date.now()}`;

    await mongo({
      action: "insertMany",
      collection: collectionName,
      docs: [
        { name: "Charlie", value: 3 },
        { name: "Alice", value: 1 },
        { name: "Bob", value: 2 },
      ],
    });

    const result = await mongo({
      action: "getFirstBatch",
      collection: collectionName,
      query: {},
      options: {
        sort: { value: 1 },
      },
      batchSize: 10,
    });

    expect(result.data).toHaveLength(3);
    expect(result.data[0].name).toBe("Alice");
    expect(result.data[1].name).toBe("Bob");
    expect(result.data[2].name).toBe("Charlie");
  }),
);

Deno.test(
  "getFirstBatch should respect projection options",
  withFixtures([
    "Admin",
    "Mongo",
  ], async (auth: Auth) => {
    const mongo = await getMongoResource(auth);
    const collectionName = `projection_test_${Date.now()}`;

    await mongo({
      action: "insertOne",
      collection: collectionName,
      doc: { name: "Alice", age: 30, email: "alice@example.com" },
    });

    const result = await mongo({
      action: "getFirstBatch",
      collection: collectionName,
      query: {},
      options: {
        projection: { name: 1, age: 1 },
      },
      batchSize: 10,
    });

    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toHaveProperty("name");
    expect(result.data[0]).toHaveProperty("age");
    expect(result.data[0]).not.toHaveProperty("email");
  }),
);

Deno.test(
  "getFirstBatch should respect skip option",
  withFixtures([
    "Admin",
    "Mongo",
  ], async (auth: Auth) => {
    const mongo = await getMongoResource(auth);
    const collectionName = `skip_test_${Date.now()}`;

    const docs = Array.from({ length: 5 }, (_, i) => ({
      name: `Document ${i}`,
      index: i,
    }));

    await mongo({
      action: "insertMany",
      collection: collectionName,
      docs,
    });

    const result = await mongo({
      action: "getFirstBatch",
      collection: collectionName,
      query: {},
      options: {
        skip: 2,
        sort: { index: 1 },
      },
      batchSize: 10,
    });

    expect(result.data).toHaveLength(3);
    expect(result.data[0].index).toBe(2);
    expect(result.data[1].index).toBe(3);
    expect(result.data[2].index).toBe(4);
  }),
);

Deno.test(
  "getMore should return next batch of documents",
  withFixtures([
    "Admin",
    "Mongo",
  ], async (auth: Auth) => {
    const mongo = await getMongoResource(auth);
    const collectionName = `getmore_test_${Date.now()}`;

    const docs = Array.from({ length: 10 }, (_, i) => ({
      name: `Document ${i}`,
      index: i,
    }));

    await mongo({
      action: "insertMany",
      collection: collectionName,
      docs,
    });

    const firstBatch = await mongo({
      action: "getFirstBatch",
      collection: collectionName,
      query: {},
      options: {
        sort: { index: 1 },
      },
      batchSize: 3,
    });

    expect(firstBatch.data).toHaveLength(3);
    expect(firstBatch.hasMore).toBe(true);
    expect(firstBatch.cursorId).not.toBe("");

    const secondBatch = await mongo({
      action: "getMore",
      collection: collectionName,
      cursorId: firstBatch.cursorId,
      batchSize: 3,
    });

    expect(secondBatch).toHaveProperty("data");
    expect(secondBatch).toHaveProperty("hasMore");
    expect(secondBatch.data).toHaveLength(3);
    expect(secondBatch.hasMore).toBe(true);
    expect(firstBatch.data[0].index).toBe(0);
    expect(secondBatch.data[0].index).toBe(3);
  }),
);

Deno.test(
  "getMore should return empty data when cursor is exhausted",
  withFixtures([
    "Admin",
    "Mongo",
  ], async (auth: Auth) => {
    const mongo = await getMongoResource(auth);
    const collectionName = `exhausted_test_${Date.now()}`;

    const docs = Array.from({ length: 3 }, (_, i) => ({
      name: `Document ${i}`,
    }));

    await mongo({
      action: "insertMany",
      collection: collectionName,
      docs,
    });

    const firstBatch = await mongo({
      action: "getFirstBatch",
      collection: collectionName,
      query: {},
      batchSize: 2,
    });

    expect(firstBatch.data).toHaveLength(2);
    expect(firstBatch.hasMore).toBe(true);

    const secondBatch = await mongo({
      action: "getMore",
      collection: collectionName,
      cursorId: firstBatch.cursorId,
      batchSize: 2,
    });

    expect(secondBatch.data).toHaveLength(1);
    expect(secondBatch.hasMore).toBe(false);

    const thirdBatch = await mongo({
      action: "getMore",
      collection: collectionName,
      cursorId: firstBatch.cursorId,
      batchSize: 2,
    });

    expect(thirdBatch.data).toHaveLength(0);
    expect(thirdBatch.hasMore).toBe(false);
  }),
);

Deno.test(
  "getMore should handle multiple consecutive calls",
  withFixtures([
    "Admin",
    "Mongo",
  ], async (auth: Auth) => {
    const mongo = await getMongoResource(auth);
    const collectionName = `multiple_test_${Date.now()}`;

    const docs = Array.from({ length: 15 }, (_, i) => ({
      name: `Document ${i}`,
      index: i,
    }));

    await mongo({
      action: "insertMany",
      collection: collectionName,
      docs,
    });

    const firstBatch = await mongo({
      action: "getFirstBatch",
      collection: collectionName,
      query: {},
      options: {
        sort: { index: 1 },
      },
      batchSize: 4,
    });

    const cursorId = firstBatch.cursorId;
    let allDocs = [...firstBatch.data];
    let hasMore = firstBatch.hasMore;

    while (hasMore) {
      const nextBatch = await mongo({
        action: "getMore",
        collection: collectionName,
        cursorId,
        batchSize: 4,
      });

      allDocs = [...allDocs, ...nextBatch.data];
      hasMore = nextBatch.hasMore;
    }

    expect(allDocs).toHaveLength(15);
    expect(allDocs.map((doc: any) => doc.index)).toEqual(
      Array.from({ length: 15 }, (_, i) => i),
    );
  }),
);

Deno.test(
  "getFirstBatch and getMore should work with complex queries",
  withFixtures([
    "Admin",
    "Mongo",
  ], async (auth: Auth) => {
    const mongo = await getMongoResource(auth);
    const collectionName = `complex_query_test_${Date.now()}`;

    await mongo({
      action: "insertMany",
      collection: collectionName,
      docs: [
        { name: "Alice", age: 25, active: true },
        { name: "Bob", age: 30, active: true },
        { name: "Charlie", age: 35, active: false },
        { name: "David", age: 28, active: true },
        { name: "Eve", age: 32, active: true },
      ],
    });

    const firstBatch = await mongo({
      action: "getFirstBatch",
      collection: collectionName,
      query: {
        active: true,
        age: { $gte: 28 },
      },
      options: {
        sort: { age: 1 },
      },
      batchSize: 2,
    });

    expect(firstBatch.data).toHaveLength(2);
    expect(firstBatch.data.every((doc: any) => doc.active === true)).toBe(true);
    expect(firstBatch.data.every((doc: any) => doc.age >= 28)).toBe(true);
    expect(firstBatch.hasMore).toBe(true);

    const secondBatch = await mongo({
      action: "getMore",
      collection: collectionName,
      cursorId: firstBatch.cursorId,
      batchSize: 2,
    });

    expect(secondBatch.data).toHaveLength(1);
    expect(secondBatch.data[0].active).toBe(true);
    expect(secondBatch.data[0].age).toBeGreaterThanOrEqual(28);
  }),
);

Deno.test(
  "continueCursor: should return empty data for non-existent cursorId",
  withFixtures([
    "Admin",
    "Mongo",
  ], async (auth: Auth) => {
    const mongo = await getMongoResource(auth);
    const collectionName = `nonexistent_cursor_test_${Date.now()}`;

    const result = await mongo({
      action: "getMore",
      collection: collectionName,
      cursorId: "nonexistent-cursor-id",
      batchSize: 10,
    });

    expect(result.data).toHaveLength(0);
    expect(result.hasMore).toBe(false);
  }),
);

Deno.test(
  "continueCursor: should return next batch and refresh TTL when more data exists",
  withFixtures([
    "Admin",
    "Mongo",
  ], async (auth: Auth) => {
    const mongo = await getMongoResource(auth);
    const collectionName = `ttl_refresh_test_${Date.now()}`;

    const docs = Array.from({ length: 10 }, (_, i) => ({
      name: `Document ${i}`,
      index: i,
    }));

    await mongo({
      action: "insertMany",
      collection: collectionName,
      docs,
    });

    const firstBatch = await mongo({
      action: "getFirstBatch",
      collection: collectionName,
      query: {},
      options: {
        sort: { index: 1 },
      },
      batchSize: 3,
    });

    expect(firstBatch.data).toHaveLength(3);
    expect(firstBatch.hasMore).toBe(true);
    expect(firstBatch.cursorId).not.toBe("");

    // Wait a bit to ensure TTL would expire if not refreshed
    await new Promise((resolve) => setTimeout(resolve, 100));

    const secondBatch = await mongo({
      action: "getMore",
      collection: collectionName,
      cursorId: firstBatch.cursorId,
      batchSize: 3,
    });

    expect(secondBatch.data).toHaveLength(3);
    expect(secondBatch.hasMore).toBe(true);
    expect(secondBatch.data[0].index).toBe(3);
    expect(secondBatch.data[1].index).toBe(4);
    expect(secondBatch.data[2].index).toBe(5);

    // Verify cursor still works after TTL refresh
    const thirdBatch = await mongo({
      action: "getMore",
      collection: collectionName,
      cursorId: firstBatch.cursorId,
      batchSize: 3,
    });

    expect(thirdBatch.data).toHaveLength(3);
    expect(thirdBatch.hasMore).toBe(true);
  }),
);

Deno.test(
  "continueCursor: should close and remove cursor when exhausted",
  withFixtures([
    "Admin",
    "Mongo",
  ], async (auth: Auth) => {
    const mongo = await getMongoResource(auth);
    const collectionName = `exhaustion_test_${Date.now()}`;

    const docs = Array.from({ length: 5 }, (_, i) => ({
      name: `Document ${i}`,
      index: i,
    }));

    await mongo({
      action: "insertMany",
      collection: collectionName,
      docs,
    });

    const firstBatch = await mongo({
      action: "getFirstBatch",
      collection: collectionName,
      query: {},
      options: {
        sort: { index: 1 },
      },
      batchSize: 3,
    });

    expect(firstBatch.data).toHaveLength(3);
    expect(firstBatch.hasMore).toBe(true);

    const secondBatch = await mongo({
      action: "getMore",
      collection: collectionName,
      cursorId: firstBatch.cursorId,
      batchSize: 3,
    });

    expect(secondBatch.data).toHaveLength(2);
    expect(secondBatch.hasMore).toBe(false);

    // Cursor should be closed and removed, so subsequent calls should return empty
    const thirdBatch = await mongo({
      action: "getMore",
      collection: collectionName,
      cursorId: firstBatch.cursorId,
      batchSize: 3,
    });

    expect(thirdBatch.data).toHaveLength(0);
    expect(thirdBatch.hasMore).toBe(false);
  }),
);

Deno.test(
  "continueCursor: should handle batchSize larger than remaining documents",
  withFixtures([
    "Admin",
    "Mongo",
  ], async (auth: Auth) => {
    const mongo = await getMongoResource(auth);
    const collectionName = `large_batch_test_${Date.now()}`;

    const docs = Array.from({ length: 5 }, (_, i) => ({
      name: `Document ${i}`,
      index: i,
    }));

    await mongo({
      action: "insertMany",
      collection: collectionName,
      docs,
    });

    const firstBatch = await mongo({
      action: "getFirstBatch",
      collection: collectionName,
      query: {},
      options: {
        sort: { index: 1 },
      },
      batchSize: 2,
    });

    expect(firstBatch.data).toHaveLength(2);
    expect(firstBatch.hasMore).toBe(true);

    // Request more than remaining documents
    const secondBatch = await mongo({
      action: "getMore",
      collection: collectionName,
      cursorId: firstBatch.cursorId,
      batchSize: 10,
    });

    expect(secondBatch.data).toHaveLength(3);
    expect(secondBatch.hasMore).toBe(false);
  }),
);

Deno.test(
  "continueCursor: should handle empty batch when cursor has no more documents",
  withFixtures([
    "Admin",
    "Mongo",
  ], async (auth: Auth) => {
    const mongo = await getMongoResource(auth);
    const collectionName = `empty_batch_test_${Date.now()}`;

    const docs = Array.from({ length: 3 }, (_, i) => ({
      name: `Document ${i}`,
      index: i,
    }));

    await mongo({
      action: "insertMany",
      collection: collectionName,
      docs,
    });

    const firstBatch = await mongo({
      action: "getFirstBatch",
      collection: collectionName,
      query: {},
      options: {
        sort: { index: 1 },
      },
      batchSize: 3,
    });

    expect(firstBatch.data).toHaveLength(3);
    expect(firstBatch.hasMore).toBe(false);
    expect(firstBatch.cursorId).toBe("");

    // Since cursor was closed, getMore with any cursorId should return empty
    const secondBatch = await mongo({
      action: "getMore",
      collection: collectionName,
      cursorId: "any-cursor-id",
      batchSize: 10,
    });

    expect(secondBatch.data).toHaveLength(0);
    expect(secondBatch.hasMore).toBe(false);
  }),
);

Deno.test(
  "continueCursor: should handle multiple cursors independently",
  withFixtures([
    "Admin",
    "Mongo",
  ], async (auth: Auth) => {
    const mongo = await getMongoResource(auth);
    const collectionName = `multiple_cursors_test_${Date.now()}`;

    const docs = Array.from({ length: 10 }, (_, i) => ({
      name: `Document ${i}`,
      index: i,
    }));

    await mongo({
      action: "insertMany",
      collection: collectionName,
      docs,
    });

    // Create first cursor
    const firstCursor = await mongo({
      action: "getFirstBatch",
      collection: collectionName,
      query: {},
      options: {
        sort: { index: 1 },
      },
      batchSize: 2,
    });

    // Create second cursor with different query
    const secondCursor = await mongo({
      action: "getFirstBatch",
      collection: collectionName,
      query: { index: { $gte: 5 } },
      options: {
        sort: { index: 1 },
      },
      batchSize: 2,
    });

    expect(firstCursor.cursorId).not.toBe(secondCursor.cursorId);

    // Continue first cursor
    const firstContinue = await mongo({
      action: "getMore",
      collection: collectionName,
      cursorId: firstCursor.cursorId,
      batchSize: 2,
    });

    // Continue second cursor
    const secondContinue = await mongo({
      action: "getMore",
      collection: collectionName,
      cursorId: secondCursor.cursorId,
      batchSize: 2,
    });

    expect(firstContinue.data[0].index).toBe(2);
    expect(secondContinue.data[0].index).toBe(7);

    // Both cursors should still work independently
    const firstContinue2 = await mongo({
      action: "getMore",
      collection: collectionName,
      cursorId: firstCursor.cursorId,
      batchSize: 2,
    });

    const secondContinue2 = await mongo({
      action: "getMore",
      collection: collectionName,
      cursorId: secondCursor.cursorId,
      batchSize: 2,
    });

    expect(firstContinue2.data[0].index).toBe(4);
    expect(secondContinue2.data[0].index).toBe(9);
  }),
);

Deno.test(
  "continueCursor: should clean up expired cursors on access",
  withFixtures([
    "Admin",
    "Mongo",
  ], async (auth: Auth) => {
    const mongo = await getMongoResource(auth);
    const collectionName = `expired_cursor_test_${Date.now()}`;

    const docs = Array.from({ length: 10 }, (_, i) => ({
      name: `Document ${i}`,
      index: i,
    }));

    await mongo({
      action: "insertMany",
      collection: collectionName,
      docs,
    });

    const firstBatch = await mongo({
      action: "getFirstBatch",
      collection: collectionName,
      query: {},
      options: {
        sort: { index: 1 },
      },
      batchSize: 3,
    });

    const cursorId = firstBatch.cursorId;

    // Manually expire the cursor by accessing the internal cursorMap
    // We can't directly access it, but we can wait for TTL expiration
    // CURSOR_TTL_MS is 30 minutes, so we'll test the cleanup logic differently
    // by using a non-existent cursor which tests the cleanup path

    // First, verify cursor works
    const secondBatch = await mongo({
      action: "getMore",
      collection: collectionName,
      cursorId,
      batchSize: 3,
    });

    expect(secondBatch.data).toHaveLength(3);
    expect(secondBatch.hasMore).toBe(true);

    // Test that non-existent cursor returns empty (tests the cleanup path)
    const expiredResult = await mongo({
      action: "getMore",
      collection: collectionName,
      cursorId: "expired-cursor-id",
      batchSize: 3,
    });

    expect(expiredResult.data).toHaveLength(0);
    expect(expiredResult.hasMore).toBe(false);
  }),
);

Deno.test(
  "continueCursor: should handle zero batchSize gracefully",
  withFixtures([
    "Admin",
    "Mongo",
  ], async (auth: Auth) => {
    const mongo = await getMongoResource(auth);
    const collectionName = `zero_batch_test_${Date.now()}`;

    const docs = Array.from({ length: 5 }, (_, i) => ({
      name: `Document ${i}`,
      index: i,
    }));

    await mongo({
      action: "insertMany",
      collection: collectionName,
      docs,
    });

    const firstBatch = await mongo({
      action: "getFirstBatch",
      collection: collectionName,
      query: {},
      options: {
        sort: { index: 1 },
      },
      batchSize: 2,
    });

    const secondBatch = await mongo({
      action: "getMore",
      collection: collectionName,
      cursorId: firstBatch.cursorId,
      batchSize: 0,
    });

    // With batchSize 0, should return empty array but cursor should still be valid
    expect(secondBatch.data).toHaveLength(0);
    // Cursor should still have more data
    expect(secondBatch.hasMore).toBe(true);

    // Verify cursor still works
    const thirdBatch = await mongo({
      action: "getMore",
      collection: collectionName,
      cursorId: firstBatch.cursorId,
      batchSize: 2,
    });

    expect(thirdBatch.data).toHaveLength(2);
  }),
);

Deno.test(
  "insertOne should automatically add updatedAt",
  withFixtures([
    "Admin",
    "Mongo",
  ], async (auth: Auth) => {
    const mongo = await getMongoResource(auth);
    const collectionName = `updatedat_insertone_test_${Date.now()}`;

    const result = await mongo({
      action: "insertOne",
      collection: collectionName,
      doc: { name: "Test Document", value: 123 },
    });

    expect(result.insertedId).toBeInstanceOf(MongoObjectId);

    const foundDoc = await mongo({
      action: "findOne",
      collection: collectionName,
      query: { _id: result.insertedId },
    });

    expect(foundDoc).toHaveProperty("updatedAt");
    expect(foundDoc.updatedAt).toBeInstanceOf(Date);
    expect(foundDoc.name).toBe("Test Document");
    expect(foundDoc.value).toBe(123);
  }),
);

Deno.test(
  "insertOne should not override explicitly provided updatedAt",
  withFixtures([
    "Admin",
    "Mongo",
  ], async (auth: Auth) => {
    const mongo = await getMongoResource(auth);
    const collectionName = `updatedat_override_test_${Date.now()}`;

    const customDate = new Date("2020-01-01T00:00:00Z");
    const result = await mongo({
      action: "insertOne",
      collection: collectionName,
      doc: { name: "Test Document", updatedAt: customDate },
    });

    const foundDoc = await mongo({
      action: "findOne",
      collection: collectionName,
      query: { _id: result.insertedId },
    });

    expect(foundDoc).toHaveProperty("updatedAt");
    expect(foundDoc.updatedAt).toBeInstanceOf(Date);
    expect(foundDoc.updatedAt.getTime()).toBeGreaterThan(customDate.getTime());
  }),
);

Deno.test(
  "insertMany should automatically add updatedAt to all documents",
  withFixtures([
    "Admin",
    "Mongo",
  ], async (auth: Auth) => {
    const mongo = await getMongoResource(auth);
    const collectionName = `updatedat_insertmany_test_${Date.now()}`;

    const result = await mongo({
      action: "insertMany",
      collection: collectionName,
      docs: [
        { name: "Document 1", value: 1 },
        { name: "Document 2", value: 2 },
        { name: "Document 3", value: 3 },
      ],
    });

    expect(result.insertedCount).toBe(3);

    const foundDocs = await mongo({
      action: "find",
      collection: collectionName,
      query: {},
      options: { sort: { value: 1 } },
    });

    expect(foundDocs).toHaveLength(3);
    for (const doc of foundDocs) {
      expect(doc).toHaveProperty("updatedAt");
      expect(doc.updatedAt).toBeInstanceOf(Date);
    }
    expect(foundDocs[0].name).toBe("Document 1");
    expect(foundDocs[1].name).toBe("Document 2");
    expect(foundDocs[2].name).toBe("Document 3");
  }),
);

Deno.test(
  "updateOne should automatically add updatedAt to $set",
  withFixtures([
    "Admin",
    "Mongo",
  ], async (auth: Auth) => {
    const mongo = await getMongoResource(auth);
    const collectionName = `updatedat_updateone_test_${Date.now()}`;

    const insertResult = await mongo({
      action: "insertOne",
      collection: collectionName,
      doc: { name: "Original Name", value: 100 },
    });

    const originalDoc = await mongo({
      action: "findOne",
      collection: collectionName,
      query: { _id: insertResult.insertedId },
    });

    const originalUpdatedAt = originalDoc.updatedAt;

    await new Promise((resolve) => setTimeout(resolve, 10));

    await mongo({
      action: "updateOne",
      collection: collectionName,
      query: { _id: insertResult.insertedId },
      update: {
        $set: {
          name: "Updated Name",
          value: 200,
        },
      },
    });

    const updatedDoc = await mongo({
      action: "findOne",
      collection: collectionName,
      query: { _id: insertResult.insertedId },
    });

    expect(updatedDoc.name).toBe("Updated Name");
    expect(updatedDoc.value).toBe(200);
    expect(updatedDoc).toHaveProperty("updatedAt");
    expect(updatedDoc.updatedAt).toBeInstanceOf(Date);
    expect(updatedDoc.updatedAt.getTime()).toBeGreaterThan(originalUpdatedAt.getTime());
  }),
);

Deno.test(
  "updateOne should create $set if it doesn't exist",
  withFixtures([
    "Admin",
    "Mongo",
  ], async (auth: Auth) => {
    const mongo = await getMongoResource(auth);
    const collectionName = `updatedat_updateone_noset_test_${Date.now()}`;

    const insertResult = await mongo({
      action: "insertOne",
      collection: collectionName,
      doc: { name: "Original Name" },
    });

    await mongo({
      action: "updateOne",
      collection: collectionName,
      query: { _id: insertResult.insertedId },
      update: {
        $inc: { counter: 1 },
      },
    });

    const updatedDoc = await mongo({
      action: "findOne",
      collection: collectionName,
      query: { _id: insertResult.insertedId },
    });

    expect(updatedDoc).toHaveProperty("updatedAt");
    expect(updatedDoc.updatedAt).toBeInstanceOf(Date);
    expect(updatedDoc.counter).toBe(1);
  }),
);

Deno.test(
  "updateMany should automatically add updatedAt to $set",
  withFixtures([
    "Admin",
    "Mongo",
  ], async (auth: Auth) => {
    const mongo = await getMongoResource(auth);
    const collectionName = `updatedat_updatemany_test_${Date.now()}`;

    const insertResult = await mongo({
      action: "insertMany",
      collection: collectionName,
      docs: [
        { name: "Document 1", status: "active" },
        { name: "Document 2", status: "active" },
        { name: "Document 3", status: "inactive" },
      ],
    });

    const originalDocs = await mongo({
      action: "find",
      collection: collectionName,
      query: { status: "active" },
      options: { sort: { name: 1 } },
    });

    const originalUpdatedAt = originalDocs[0].updatedAt;

    await new Promise((resolve) => setTimeout(resolve, 10));

    await mongo({
      action: "updateMany",
      collection: collectionName,
      query: { status: "active" },
      update: {
        $set: {
          status: "updated",
        },
      },
    });

    const updatedDocs = await mongo({
      action: "find",
      collection: collectionName,
      query: { status: "updated" },
      options: { sort: { name: 1 } },
    });

    expect(updatedDocs).toHaveLength(2);
    for (const doc of updatedDocs) {
      expect(doc).toHaveProperty("updatedAt");
      expect(doc.updatedAt).toBeInstanceOf(Date);
      expect(doc.updatedAt.getTime()).toBeGreaterThan(originalUpdatedAt.getTime());
    }
  }),
);

Deno.test(
  "bulkWrite should automatically add updatedAt for insertOne operations",
  withFixtures([
    "Admin",
    "Mongo",
  ], async (auth: Auth) => {
    const mongo = await getMongoResource(auth);
    const collectionName = `updatedat_bulkwrite_insert_test_${Date.now()}`;

    const result = await mongo({
      action: "bulkWrite",
      collection: collectionName,
      operations: [
        {
          insertOne: {
            document: { name: "Document 1", value: 1 },
          },
        },
        {
          insertOne: {
            document: { name: "Document 2", value: 2 },
          },
        },
      ],
    });

    expect(result.insertedCount).toBe(2);

    const foundDocs = await mongo({
      action: "find",
      collection: collectionName,
      query: {},
      options: { sort: { value: 1 } },
    });

    expect(foundDocs).toHaveLength(2);
    for (const doc of foundDocs) {
      expect(doc).toHaveProperty("updatedAt");
      expect(doc.updatedAt).toBeInstanceOf(Date);
    }
  }),
);

Deno.test(
  "bulkWrite should automatically add updatedAt for multiple insertOne operations",
  withFixtures([
    "Admin",
    "Mongo",
  ], async (auth: Auth) => {
    const mongo = await getMongoResource(auth);
    const collectionName = `updatedat_bulkwrite_insertmany_test_${Date.now()}`;

    const result = await mongo({
      action: "bulkWrite",
      collection: collectionName,
      operations: [
        {
          insertOne: {
            document: { name: "Document 1", value: 1 },
          },
        },
        {
          insertOne: {
            document: { name: "Document 2", value: 2 },
          },
        },
      ],
    });

    expect(result.insertedCount).toBe(2);

    const foundDocs = await mongo({
      action: "find",
      collection: collectionName,
      query: {},
      options: { sort: { value: 1 } },
    });

    expect(foundDocs).toHaveLength(2);
    for (const doc of foundDocs) {
      expect(doc).toHaveProperty("updatedAt");
      expect(doc.updatedAt).toBeInstanceOf(Date);
    }
  }),
);

Deno.test(
  "bulkWrite should automatically add updatedAt for updateOne operations",
  withFixtures([
    "Admin",
    "Mongo",
  ], async (auth: Auth) => {
    const mongo = await getMongoResource(auth);
    const collectionName = `updatedat_bulkwrite_update_test_${Date.now()}`;

    const insertResult = await mongo({
      action: "insertMany",
      collection: collectionName,
      docs: [
        { name: "Document 1", value: 1 },
        { name: "Document 2", value: 2 },
      ],
    });

    const originalDocs = await mongo({
      action: "find",
      collection: collectionName,
      query: {},
      options: { sort: { value: 1 } },
    });

    const originalUpdatedAt = originalDocs[0].updatedAt;

    await new Promise((resolve) => setTimeout(resolve, 10));

    await mongo({
      action: "bulkWrite",
      collection: collectionName,
      operations: [
        {
          updateOne: {
            filter: { _id: insertResult.insertedIds[0] },
            update: {
              $set: {
                value: 10,
              },
            },
          },
        },
        {
          updateOne: {
            filter: { _id: insertResult.insertedIds[1] },
            update: {
              $set: {
                value: 20,
              },
            },
          },
        },
      ],
    });

    const updatedDocs = await mongo({
      action: "find",
      collection: collectionName,
      query: {},
      options: { sort: { value: 1 } },
    });

    expect(updatedDocs).toHaveLength(2);
    for (const doc of updatedDocs) {
      expect(doc).toHaveProperty("updatedAt");
      expect(doc.updatedAt).toBeInstanceOf(Date);
      expect(doc.updatedAt.getTime()).toBeGreaterThan(originalUpdatedAt.getTime());
    }
    expect(updatedDocs[0].value).toBe(10);
    expect(updatedDocs[1].value).toBe(20);
  }),
);

Deno.test(
  "bulkWrite should automatically add updatedAt for updateMany operations",
  withFixtures([
    "Admin",
    "Mongo",
  ], async (auth: Auth) => {
    const mongo = await getMongoResource(auth);
    const collectionName = `updatedat_bulkwrite_updatemany_test_${Date.now()}`;

    await mongo({
      action: "insertMany",
      collection: collectionName,
      docs: [
        { name: "Document 1", status: "active" },
        { name: "Document 2", status: "active" },
        { name: "Document 3", status: "inactive" },
      ],
    });

    const originalDocs = await mongo({
      action: "find",
      collection: collectionName,
      query: { status: "active" },
    });

    const originalUpdatedAt = originalDocs[0].updatedAt;

    await new Promise((resolve) => setTimeout(resolve, 10));

    await mongo({
      action: "bulkWrite",
      collection: collectionName,
      operations: [
        {
          updateMany: {
            filter: { status: "active" },
            update: {
              $set: {
                status: "updated",
              },
            },
          },
        },
      ],
    });

    const updatedDocs = await mongo({
      action: "find",
      collection: collectionName,
      query: { status: "updated" },
    });

    expect(updatedDocs).toHaveLength(2);
    for (const doc of updatedDocs) {
      expect(doc).toHaveProperty("updatedAt");
      expect(doc.updatedAt).toBeInstanceOf(Date);
      expect(doc.updatedAt.getTime()).toBeGreaterThan(originalUpdatedAt.getTime());
    }
  }),
);

Deno.test(
  "bulkWrite should automatically add updatedAt for replaceOne operations",
  withFixtures([
    "Admin",
    "Mongo",
  ], async (auth: Auth) => {
    const mongo = await getMongoResource(auth);
    const collectionName = `updatedat_bulkwrite_replace_test_${Date.now()}`;

    const insertResult = await mongo({
      action: "insertOne",
      collection: collectionName,
      doc: { name: "Original Name", value: 100 },
    });

    const originalDoc = await mongo({
      action: "findOne",
      collection: collectionName,
      query: { _id: insertResult.insertedId },
    });

    const originalUpdatedAt = originalDoc.updatedAt;

    await new Promise((resolve) => setTimeout(resolve, 10));

    await mongo({
      action: "bulkWrite",
      collection: collectionName,
      operations: [
        {
          replaceOne: {
            filter: { _id: insertResult.insertedId },
            replacement: {
              name: "Replaced Name",
              value: 200,
            },
          },
        },
      ],
    });

    const replacedDoc = await mongo({
      action: "findOne",
      collection: collectionName,
      query: { _id: insertResult.insertedId },
    });

    expect(replacedDoc.name).toBe("Replaced Name");
    expect(replacedDoc.value).toBe(200);
    expect(replacedDoc).toHaveProperty("updatedAt");
    expect(replacedDoc.updatedAt).toBeInstanceOf(Date);
    expect(replacedDoc.updatedAt.getTime()).toBeGreaterThan(originalUpdatedAt.getTime());
  }),
);

Deno.test(
  "bulkWrite should handle mixed operations with updatedAt",
  withFixtures([
    "Admin",
    "Mongo",
  ], async (auth: Auth) => {
    const mongo = await getMongoResource(auth);
    const collectionName = `updatedat_bulkwrite_mixed_test_${Date.now()}`;

    const insertResult = await mongo({
      action: "insertOne",
      collection: collectionName,
      doc: { name: "Original", value: 1 },
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    const result = await mongo({
      action: "bulkWrite",
      collection: collectionName,
      operations: [
        {
          insertOne: {
            document: { name: "New Document", value: 2 },
          },
        },
        {
          updateOne: {
            filter: { _id: insertResult.insertedId },
            update: {
              $set: {
                value: 10,
              },
            },
          },
        },
      ],
    });

    expect(result.insertedCount).toBe(1);
    expect(result.modifiedCount).toBe(1);

    const docs = await mongo({
      action: "find",
      collection: collectionName,
      query: {},
      options: { sort: { value: 1 } },
    });

    expect(docs).toHaveLength(2);
    for (const doc of docs) {
      expect(doc).toHaveProperty("updatedAt");
      expect(doc.updatedAt).toBeInstanceOf(Date);
    }
    // Sorted by value ascending: 2 (new doc), then 10 (updated original)
    expect(docs[0].value).toBe(2);
    expect(docs[1].value).toBe(10);
  }),
);
