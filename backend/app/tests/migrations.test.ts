import { expect } from "@std/expect";
import { ObjectId } from "mongodb";
import { withFixtures } from "@/tests/fixtures.server.ts";

import { ensureAllCollectionsExist } from "@/lib/mongo/collections.ts";
import { up as configureExplicitLlmRouting } from "../../migrations/0019_explicit_llm_model_routing.ts";
import { up as separateSummaryPromptModel } from "../../migrations/0023_separate_summary_prompt_model.ts";
import { up as configureLlmProviderRouting } from "../../migrations/0024_llm_provider_routing.ts";
import { up as upgradeLocationImports } from "../../migrations/0050_location_import_review.ts";
import { up as addFullLocationGeometry } from "../../migrations/0054_location_full_geometry_metadata.ts";

Deno.test(
  "location import migration backfills provenance and quarantines orphan points",
  withFixtures(["Mongo"], async ({ db }) => {
    const importId = new ObjectId();
    const orphanImportId = new ObjectId();
    await db.collection("location_imports").insertOne({
      _id: importId,
      filename: "committed.gpx",
      status: "processed",
      createdAt: new Date("2026-08-01T00:00:00Z"),
    });
    await db.collection("location_points").insertMany([
      {
        ts: new Date("2026-08-01T00:00:00Z"),
        importId,
        hash: "valid",
      },
      {
        ts: new Date("2026-08-02T00:00:00Z"),
        importId: orphanImportId,
        hash: "orphan",
      },
    ]);

    await upgradeLocationImports(db);
    await upgradeLocationImports(db);

    const valid = await db.collection("location_points").findOne({
      hash: "valid",
    });
    const orphan = await db.collection("location_points").findOne({
      hash: "orphan",
    });
    const imported = await db.collection("location_imports").findOne({
      _id: importId,
    });
    expect(valid?.visible).toBe(true);
    expect(valid?.selection).toBe("accepted");
    expect(valid?.importIds?.map(String)).toEqual([String(importId)]);
    expect(orphan?.visible).toBe(false);
    expect(orphan?.recoveryState).toBe("orphaned");
    expect(imported?.committedAt).toEqual(
      new Date("2026-08-01T00:00:00Z"),
    );
    expect(
      await db.collection("location_points").indexExists(
        "location_point_canonical_cursor_v1",
      ),
    ).toBe(true);
  }),
);

Deno.test(
  "full location geometry migration preserves legacy render paths",
  withFixtures(["Mongo"], async ({ db }) => {
    const trackId = new ObjectId();
    await db.collection("location_tracks").insertOne({
      _id: trackId,
      fingerprint: "legacy-track",
      path: [[44.8, 41.7], [44.9, 41.8]],
      pointCount: 10000,
    });
    await addFullLocationGeometry(db);
    await addFullLocationGeometry(db);

    const track = await db.collection("location_tracks").findOne({
      _id: trackId,
    });
    expect(track?.renderPath).toEqual([[44.8, 41.7], [44.9, 41.8]]);
    expect(track?.geometryCompleteness).toBe("render-only");
    expect(track?.geometryPointCount).toBe(10000);
    expect(
      await db.collection("location_track_geometry").indexExists(
        "location_track_geometry_chunk_v1",
      ),
    ).toBe(true);
  }),
);

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
  "migrations add the Timeline object start index",
  withFixtures(["Mongo"], async ({ db }) => {
    await ensureAllCollectionsExist(db);
    expect(
      await db.collection("objects").indexExists(
        "timeline_objects_time_range_start",
      ),
    ).toBe(true);
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

Deno.test(
  "LLM provider routing migration keeps only the active profile enabled",
  withFixtures([
    "Mongo",
  ], async ({ db }) => {
    const configId = new ObjectId("000000000000000000000000");
    await db.collection("configs").updateOne(
      { _id: configId },
      {
        $set: {
          llmProfiles: {
            activeProfileId: "secondary",
            profiles: [
              { id: "primary", name: "Primary" },
              { id: "secondary", name: "Secondary" },
            ],
          },
        },
      },
      { upsert: true },
    );

    await configureLlmProviderRouting(db);

    const config = await db.collection("configs").findOne({ _id: configId });
    const profiles = config?.llmProfiles?.profiles;
    expect(
      profiles?.map((profile: Record<string, unknown>) => ({
        id: profile.id,
        enabled: profile.enabled,
        priority: profile.priority,
      })),
    ).toEqual([
      { id: "primary", enabled: false, priority: 50 },
      { id: "secondary", enabled: true, priority: 50 },
    ]);
    expect(typeof config?.llmProfiles?.includeEnvironment).toBe("boolean");
    expect(typeof config?.llmProfiles?.environmentPriority).toBe("number");
  }),
);

Deno.test(
  "LLM provider routing migration enables the first profile without an active match",
  withFixtures([
    "Mongo",
  ], async ({ db }) => {
    const configId = new ObjectId("000000000000000000000000");
    await db.collection("configs").updateOne(
      { _id: configId },
      {
        $set: {
          llmProfiles: {
            activeProfileId: "missing",
            profiles: [
              { id: "primary", name: "Primary" },
              { id: "secondary", name: "Secondary", enabled: true },
            ],
          },
        },
      },
      { upsert: true },
    );

    await configureLlmProviderRouting(db);

    const config = await db.collection("configs").findOne({ _id: configId });
    const profiles = config?.llmProfiles?.profiles;
    expect(profiles?.[0]?.enabled).toBe(true);
    expect(profiles?.[1]?.enabled).toBe(true);
  }),
);

/**
 * The diarization worker looks up a recording's prior segments once per
 * sequence (overlap reconciliation and reserved speaker labels). Without an
 * original_id index both are collection scans over every segment ever written,
 * so throughput decays as the archive grows.
 */
function planStages(plan: Record<string, any> | undefined): string[] {
  if (!plan) throw new Error("Explain output carried no query plan");
  // Aggregation explains wrap the plan tree in `queryPlan`.
  if (plan.queryPlan) return planStages(plan.queryPlan);
  const stages = [plan.stage].filter(Boolean);
  if (plan.inputStage) stages.push(...planStages(plan.inputStage));
  return stages;
}

Deno.test(
  "overlap lookups by original_id use an index",
  withFixtures(["Mongo"], async ({ db }) => {
    await ensureAllCollectionsExist(db);
    const originalId = new ObjectId();

    const explained = await db.collection("diarizations").find({
      original_id: originalId,
      end: { $gt: new Date(0) },
      start: { $lt: new Date() },
    }).sort({ start: 1 }).explain("queryPlanner");

    expect(planStages(explained.queryPlanner.winningPlan)).not.toContain(
      "COLLSCAN",
    );
  }),
);

Deno.test(
  "reserved speaker labels are grouped from an index",
  withFixtures(["Mongo"], async ({ db }) => {
    await ensureAllCollectionsExist(db);
    const originalId = new ObjectId();

    const explained = await db.collection("diarizations").aggregate([
      { $match: { original_id: originalId } },
      { $group: { _id: "$speaker" } },
    ]).explain("queryPlanner");

    const plan = explained.queryPlanner?.winningPlan ??
      explained.stages?.[0]?.$cursor?.queryPlanner?.winningPlan;
    expect(planStages(plan)).not.toContain("COLLSCAN");
  }),
);
