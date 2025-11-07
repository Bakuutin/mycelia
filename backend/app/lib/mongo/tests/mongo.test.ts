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
