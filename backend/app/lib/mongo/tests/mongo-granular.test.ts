import { expect } from "@std/expect";
import { Auth } from "@/lib/auth/core.server.ts";
import { getMongoResource } from "../core.server.ts";
import { withFixtures } from "@/tests/fixtures.server.ts";

Deno.test(
  "bulkWrite should respect granular permissions (only update needed)",
  withFixtures([
    "AuthFactory",
    "Mongo",
  ], async (authFactory) => {
    // Grant only 'update' permission
    const auth: Auth = authFactory({
      policies: [
        { resource: "db/audio_chunks", action: "read", effect: "allow" },
        { resource: "db/audio_chunks", action: "update", effect: "allow" },
      ],
    });
    
    const mongo = await getMongoResource(auth);
    
    // First, insert some data as admin so we can update it
    const adminAuth: Auth = authFactory({
      policies: [{ resource: "**", action: "*", effect: "allow" }],
    });
    const adminMongo = await getMongoResource(adminAuth);
    const insertResult = await adminMongo({
      action: "insertOne",
      collection: "audio_chunks",
      doc: { name: "test-chunk", data: "some-data" },
    });
    const chunkId = insertResult.insertedId;

    // Now try to update it using bulkWrite with the restricted auth
    // This should succeed because it only needs 'update' permission
    await mongo({
      action: "bulkWrite",
      collection: "audio_chunks",
      operations: [
        {
          updateOne: {
            filter: { _id: chunkId },
            update: { $set: { vad: { ran_at: new Date() } } },
          },
        },
      ],
    });

    // Verify it was updated
    const updatedDoc = await adminMongo({
      action: "findOne",
      collection: "audio_chunks",
      query: { _id: chunkId },
    });
    expect(updatedDoc).toHaveProperty("vad");
    
    // Now try an operation that requires 'write' permission (insertOne)
    // This should fail
    await expect(
      mongo({
        action: "bulkWrite",
        collection: "audio_chunks",
        operations: [
          {
            insertOne: {
              document: { name: "forbidden-chunk", data: "more-data" },
            },
          },
        ],
      })
    ).rejects.toHaveProperty("status", 403);
  }),
);

Deno.test(
  "bulkWrite should require write permission for upsert",
  withFixtures([
    "AuthFactory",
    "Mongo",
  ], async (authFactory) => {
    // Grant only 'update' permission (no 'write')
    const auth: Auth = authFactory({
      policies: [
        { resource: "db/audio_chunks", action: "update", effect: "allow" },
      ],
    });
    
    const mongo = await getMongoResource(auth);
    
    // Try to update with upsert: true
    // This should fail because it requires 'write' permission
    await expect(
      mongo({
        action: "bulkWrite",
        collection: "audio_chunks",
        operations: [
          {
            updateOne: {
              filter: { _id: "non-existent-id" },
              update: { $set: { foo: "bar" } },
              options: { upsert: true },
            },
          },
        ],
      })
    ).rejects.toHaveProperty("status", 403);
  }),
);

