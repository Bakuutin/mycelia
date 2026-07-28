import { expect } from "@std/expect";
import { ObjectId } from "mongodb";
import { withFixtures } from "@/tests/fixtures.server.ts";

import { ensureAllCollectionsExist } from "@/lib/mongo/collections.ts";
import { up as configureExplicitLlmRouting } from "../../migrations/0019_explicit_llm_model_routing.ts";

Deno.test(
  "migrations can run",
  withFixtures([
    "Mongo",
  ], async ({ db }) => {
    await ensureAllCollectionsExist(db);
    const collections = await db.listCollections().toArray();
    expect(collections.map((c: { name: string }) => c.name)).toContain(
      "audio_chunks",
    );
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

Deno.test(
  "explicit LLM routing migration preserves a null inference provider",
  withFixtures([
    "Mongo",
  ], async ({ db }) => {
    const configId = new ObjectId("000000000000000000000000");
    await db.collection("configs").updateOne(
      { _id: configId },
      { $set: { inference: null } },
      { upsert: true },
    );

    await configureExplicitLlmRouting(db);

    const config = await db.collection("configs").findOne({ _id: configId });
    expect(config?.inference).toBeNull();
  }),
);
