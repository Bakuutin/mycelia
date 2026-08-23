import { expect } from "@std/expect";
import { withFixtures } from "@/tests/fixtures.server.ts";
import {
  CURRENT_GPU_EMBEDDING_SPACE_ID,
  DIARIZATOR_MODEL_ID,
  DIARIZATOR_MODEL_VERSION,
  LEGACY_GPU_EMBEDDING_SPACE_ID,
  up,
} from "../../migrations/0069_diarizator_runtime_provenance.ts";
Deno.test(
  "runtime provenance backfill maps historical routes without mixing spaces",
  withFixtures(["Mongo"], async ({ db }) => {
    await db.collection("diarizations").createIndex({
      embeddingSpaceId: 1,
      lifecycleStatus: 1,
    }, { name: "diarization_embedding_space_active" });
    await db.collection("diarizations").insertMany([
      { marker: "legacy", embeddingSpaceId: "legacy-unknown" },
      { marker: "old-gpu", embeddingSpaceId: LEGACY_GPU_EMBEDDING_SPACE_ID },
      {
        marker: "current-gpu",
        embeddingSpaceId: CURRENT_GPU_EMBEDDING_SPACE_ID,
      },
    ]);
    await db.collection("diarization_runs").insertOne({
      runId: "legacy-v0",
      embeddingSpaceId: "legacy-unknown",
    });
    await db.collection("speaker_profiles").insertOne({
      name: "Sky",
      embeddingSpaceId: LEGACY_GPU_EMBEDDING_SPACE_ID,
    });
    await db.collection("jobs").insertMany([
      {
        marker: "old-job",
        type: "diarization",
        data: {
          type: "diarization",
          diarizationServerUrl: "http://100.119.163.116:8085",
        },
      },
      {
        marker: "current-job",
        type: "enrollment",
        data: {
          type: "enrollment",
          routingContext: {
            providerProfileId: "diarizator-1786706202828",
          },
        },
      },
      {
        marker: "local-job",
        type: "profileReenrollment",
        data: {
          type: "profileReenrollment",
          diarizationServerUrl: "http://host.docker.internal:8085",
        },
      },
    ]);
    await up(db);
    await up(db);
    const diarizations = await db.collection("diarizations").find({}).toArray();
    expect(
      diarizations.every((doc: Record<string, unknown>) =>
        doc.modelId === DIARIZATOR_MODEL_ID
      ),
    ).toBe(true);
    expect(
      diarizations.every((doc: Record<string, unknown>) =>
        doc.modelVersion === DIARIZATOR_MODEL_VERSION
      ),
    ).toBe(true);
    const oldJob = await db.collection("jobs").findOne({ marker: "old-job" });
    const currentJob = await db.collection("jobs").findOne({
      marker: "current-job",
    });
    const localJob = await db.collection("jobs").findOne({
      marker: "local-job",
    });
    expect(oldJob?.routingContext?.embeddingSpaceId).toBe(
      LEGACY_GPU_EMBEDDING_SPACE_ID,
    );
    expect(oldJob?.data?.routingContext?.embeddingSpaceId).toBe(
      LEGACY_GPU_EMBEDDING_SPACE_ID,
    );
    expect(currentJob?.routingContext?.embeddingSpaceId).toBe(
      CURRENT_GPU_EMBEDDING_SPACE_ID,
    );
    expect(currentJob?.routingContext?.providerProfileId).toBe(
      "diarizator-1786706202828",
    );
    expect(localJob?.routingContext?.embeddingSpaceId).toBeUndefined();
    expect(localJob?.routingContext?.modelVersion).toBe(
      DIARIZATOR_MODEL_VERSION,
    );
    const profile = await db.collection("speaker_profiles").findOne({
      name: "Sky",
    });
    expect(profile?.runtimeProvenance).toMatchObject({
      modelId: DIARIZATOR_MODEL_ID,
      modelVersion: DIARIZATOR_MODEL_VERSION,
      embeddingSpaceId: LEGACY_GPU_EMBEDDING_SPACE_ID,
    });
  }),
);
