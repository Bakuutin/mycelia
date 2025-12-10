import { expect } from "@std/expect";
import { withFixtures } from "@/tests/fixtures.server.ts";

import { ensureAllCollectionsExist } from "@/lib/mongo/collections.ts";

Deno.test(
  "migrations can run",
  withFixtures([
    "Mongo",
  ], async ({ db }) => {
    await ensureAllCollectionsExist(db);
    const collections = await db.listCollections().toArray();
    expect(collections.map((c: { name: string }) => c.name)).toContain("audio_chunks");
  }),
);


Deno.test(
  "migrations are not applied multiple times",
  withFixtures([
    "Mongo",
  ], async ({ db }) => {
    await ensureAllCollectionsExist(db);
    const subsequentMigration = await ensureAllCollectionsExist(db);
    expect(subsequentMigration).toHaveLength(0);
  }),
);


