import { expect } from "@std/expect";
import { Auth } from "@/lib/auth/core.server.ts";
import { getMongoResource } from "../core.server.ts";
import { withFixtures } from "@/tests/fixtures.server.ts";
import { ObjectId } from "mongodb";

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
    const resourceFn = await auth.getResource("tech.mycelia.mongo");
    const result = await mongo({
      action: "insertOne",
      collection: "users",
      doc: { name: "Bob" },
    });
    expect(result.insertedId).toBeInstanceOf(ObjectId);
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
    const mongo = await auth.getResource("tech.mycelia.mongo");
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

    expect(result.insertedId).toBeInstanceOf(ObjectId);

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

    expect(result1.insertedId).toBeInstanceOf(ObjectId);

    // Second operation should use the cache (no "Auto-created collection" log)
    const result2 = await mongo({
      action: "insertOne",
      collection: uniqueCollectionName,
      doc: { name: "Second Document" },
    });

    expect(result2.insertedId).toBeInstanceOf(ObjectId);

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
