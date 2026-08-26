import { expect } from "@std/expect";
import { withFixtures } from "@/tests/fixtures.server.ts";
import {
  CURRENT_8085_CUTOVER_AT,
  CURRENT_GPU_EMBEDDING_SPACE_ID,
  DIARIZATOR_MODEL_ID,
  DIARIZATOR_MODEL_VERSION,
  LEGACY_DIARIZATOR_MODEL_ID,
  LEGACY_GPU_EMBEDDING_SPACE_ID,
} from "../../migrations/0069_diarizator_runtime_provenance.ts";
import { up } from "../../migrations/0070_diarizator_runtime_provenance_repair.ts";

const incorrectRuntime = {
  modelId: DIARIZATOR_MODEL_ID,
  modelVersion: DIARIZATOR_MODEL_VERSION,
  runtimeProvenanceSource: "historical_backfill_0069",
};

Deno.test(
  "runtime provenance repair removes overclaims and fixes reused 8085",
  withFixtures(["Mongo"], async ({ db }) => {
    await db.collection("diarizations").createIndex({
      embeddingSpaceId: 1,
      lifecycleStatus: 1,
    }, { name: "diarization_embedding_space_active" });
    await db.collection("diarizations").insertOne({
      marker: "legacy",
      embeddingSpaceId: "legacy-unknown",
      ...incorrectRuntime,
    });
    await db.collection("diarization_runs").insertMany([
      {
        runId: "legacy-v0",
        embeddingSpaceId: "legacy-unknown",
        ...incorrectRuntime,
      },
      { runId: "unknown-run", ...incorrectRuntime },
    ]);
    await db.collection("speaker_profiles").insertMany([
      {
        name: "legacy-profile",
        embedding: [0.1],
        embeddingSpaceId: "legacy-unknown",
        runtimeProvenance: {
          ...incorrectRuntime,
          embeddingSpaceId: "legacy-unknown",
        },
        ...incorrectRuntime,
      },
      {
        name: "empty-profile",
        embeddingSpaceId: LEGACY_GPU_EMBEDDING_SPACE_ID,
        runtimeProvenance: {
          ...incorrectRuntime,
          embeddingSpaceId: LEGACY_GPU_EMBEDDING_SPACE_ID,
        },
        ...incorrectRuntime,
      },
    ]);
    await db.collection("jobs").insertOne({
      marker: "reused-8085",
      type: "diarization",
      createdAt: CURRENT_8085_CUTOVER_AT,
      routingContext: {
        providerProfileId: "diarizator-1786330216831",
        embeddingSpaceId: LEGACY_GPU_EMBEDDING_SPACE_ID,
        ...incorrectRuntime,
      },
      data: {
        routingContext: {
          providerProfileId: "diarizator-1786330216831",
          embeddingSpaceId: LEGACY_GPU_EMBEDDING_SPACE_ID,
          ...incorrectRuntime,
        },
      },
    });

    await up(db);
    await up(db);

    const legacy = await db.collection("diarizations").findOne({
      marker: "legacy",
    });
    expect(legacy?.modelId).toBe(LEGACY_DIARIZATOR_MODEL_ID);
    expect(legacy?.modelVersion).toBeUndefined();
    const legacyRun = await db.collection("diarization_runs").findOne({
      runId: "legacy-v0",
    });
    expect(legacyRun?.modelId).toBe(LEGACY_DIARIZATOR_MODEL_ID);
    expect(legacyRun?.modelVersion).toBeUndefined();
    const unknownRun = await db.collection("diarization_runs").findOne({
      runId: "unknown-run",
    });
    expect(unknownRun?.modelId).toBeUndefined();
    expect(unknownRun?.modelVersion).toBeUndefined();

    const legacyProfile = await db.collection("speaker_profiles").findOne({
      name: "legacy-profile",
    });
    expect(legacyProfile?.modelId).toBe(LEGACY_DIARIZATOR_MODEL_ID);
    expect(legacyProfile?.modelVersion).toBeUndefined();
    const emptyProfile = await db.collection("speaker_profiles").findOne({
      name: "empty-profile",
    });
    expect(emptyProfile?.embeddingSpaceId).toBeUndefined();
    expect(emptyProfile?.modelId).toBeUndefined();
    expect(emptyProfile?.runtimeProvenance).toBeUndefined();

    const job = await db.collection("jobs").findOne({ marker: "reused-8085" });
    expect(job?.routingContext?.embeddingSpaceId).toBe(
      CURRENT_GPU_EMBEDDING_SPACE_ID,
    );
    expect(job?.data?.routingContext?.embeddingSpaceId).toBe(
      CURRENT_GPU_EMBEDDING_SPACE_ID,
    );
  }),
);
