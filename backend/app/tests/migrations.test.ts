import { expect } from "@std/expect";
import { ObjectId } from "mongodb";
import { withFixtures } from "@/tests/fixtures.server.ts";

import { ensureAllCollectionsExist } from "@/lib/mongo/collections.ts";
import { up as configureExplicitLlmRouting } from "../../migrations/0019_explicit_llm_model_routing.ts";
import { up as separateSummaryPromptModel } from "../../migrations/0023_separate_summary_prompt_model.ts";

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

Deno.test(
  "summary prompt migration moves the legacy model to the worker route",
  withFixtures([
    "Mongo",
  ], async ({ db }) => {
    const configId = new ObjectId("000000000000000000000000");
    const promptId = new ObjectId();
    await db.collection("prompts").insertOne({
      _id: promptId,
      name: "Default summary",
      text: "Summarize this",
      model: "small",
    });
    await db.collection("configs").updateOne(
      { _id: configId },
      { $set: { "prompts.summarization_system": promptId } },
      { upsert: true },
    );
    await db.collection("workers").updateOne(
      { name: "summarization" },
      {
        $set: {
          name: "summarization",
          "defaultOverrides.prompt": "stale prompt copy",
        },
      },
      { upsert: true },
    );

    await separateSummaryPromptModel(db);

    const prompt = await db.collection("prompts").findOne({ _id: promptId });
    const worker = await db.collection("workers").findOne({
      name: "summarization",
    });
    expect(prompt?.model).toBeUndefined();
    expect(worker?.defaultOverrides?.model).toBe("small");
    expect(worker?.defaultOverrides?.prompt).toBeUndefined();
  }),
);

Deno.test(
  "summary prompt migration preserves an explicit worker model",
  withFixtures([
    "Mongo",
  ], async ({ db }) => {
    await db.collection("workers").updateOne(
      { name: "summarization" },
      {
        $set: {
          name: "summarization",
          "defaultOverrides.model": "custom-summary-model",
        },
      },
      { upsert: true },
    );

    await separateSummaryPromptModel(db);

    const worker = await db.collection("workers").findOne({
      name: "summarization",
    });
    expect(worker?.defaultOverrides?.model).toBe("custom-summary-model");
  }),
);
