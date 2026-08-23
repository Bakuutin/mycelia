import { expect } from "@std/expect";
import { withFixtures } from "@/tests/fixtures.server.ts";
import {
  CURRENT_8085_CUTOVER_AT,
  CURRENT_GPU_EMBEDDING_SPACE_ID,
  DIARIZATOR_MODEL_ID,
  DIARIZATOR_MODEL_VERSION,
  LEGACY_DIARIZATOR_MODEL_ID,
  LEGACY_GPU_EMBEDDING_SPACE_ID,
  up,
} from "../../migrations/0069_diarizator_runtime_provenance.ts";

Deno.test(
  "runtime provenance backfill maps only evidence-backed spaces and routes",
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
    await db.collection("diarization_runs").insertMany([
      { runId: "legacy-v0", embeddingSpaceId: "legacy-unknown" },
      { runId: "no-space" },
    ]);
    await db.collection("speaker_profiles").insertMany([
      {
        name: "Sky",
        embeddingSpaceId: LEGACY_GPU_EMBEDDING_SPACE_ID,
        embedding: [0.1, 0.2],
      },
      {
        name: "Legacy profile",
        embeddingSpaceId: "legacy-unknown",
        embedding: [0.2, 0.3],
      },
      {
        name: "Empty draft",
        embeddingSpaceId: LEGACY_GPU_EMBEDDING_SPACE_ID,
      },
    ]);
    await db.collection("jobs").insertMany([
      {
        marker: "old-job",
        type: "diarization",
        createdAt: new Date(CURRENT_8085_CUTOVER_AT.getTime() - 1),
        data: {
          type: "diarization",
          diarizationServerUrl: "http://100.119.163.116:8085",
        },
      },
      {
        marker: "post-cutover-8085-job",
        type: "diarization",
        createdAt: CURRENT_8085_CUTOVER_AT,
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

    const legacy = await db.collection("diarizations").findOne({
      marker: "legacy",
    });
    expect(legacy?.modelId).toBe(LEGACY_DIARIZATOR_MODEL_ID);
    expect(legacy?.modelVersion).toBeUndefined();
    for (const marker of ["old-gpu", "current-gpu"]) {
      const doc = await db.collection("diarizations").findOne({ marker });
      expect(doc?.modelId).toBe(DIARIZATOR_MODEL_ID);
      expect(doc?.modelVersion).toBe(DIARIZATOR_MODEL_VERSION);
    }
    const legacyRun = await db.collection("diarization_runs").findOne({
      runId: "legacy-v0",
    });
    expect(legacyRun?.modelId).toBe(LEGACY_DIARIZATOR_MODEL_ID);
    expect(legacyRun?.modelVersion).toBeUndefined();
    expect(
      await db.collection("diarization_runs").findOne({ runId: "no-space" }),
    ).toMatchObject({ runId: "no-space" });

    const profile = await db.collection("speaker_profiles").findOne({
      name: "Sky",
    });
    expect(profile?.runtimeProvenance).toMatchObject({
      modelId: DIARIZATOR_MODEL_ID,
      modelVersion: DIARIZATOR_MODEL_VERSION,
      embeddingSpaceId: LEGACY_GPU_EMBEDDING_SPACE_ID,
    });
    const legacyProfile = await db.collection("speaker_profiles").findOne({
      name: "Legacy profile",
    });
    expect(legacyProfile?.modelId).toBe(LEGACY_DIARIZATOR_MODEL_ID);
    expect(legacyProfile?.modelVersion).toBeUndefined();
    const emptyProfile = await db.collection("speaker_profiles").findOne({
      name: "Empty draft",
    });
    expect(emptyProfile?.modelId).toBeUndefined();
    expect(emptyProfile?.modelVersion).toBeUndefined();

    const oldJob = await db.collection("jobs").findOne({ marker: "old-job" });
    const postCutover = await db.collection("jobs").findOne({
      marker: "post-cutover-8085-job",
    });
    const currentJob = await db.collection("jobs").findOne({
      marker: "current-job",
    });
    const localJob = await db.collection("jobs").findOne({
      marker: "local-job",
    });
    expect(oldJob?.routingContext?.embeddingSpaceId).toBe(
      LEGACY_GPU_EMBEDDING_SPACE_ID,
    );
    expect(postCutover?.routingContext?.embeddingSpaceId).toBe(
      CURRENT_GPU_EMBEDDING_SPACE_ID,
    );
    expect(currentJob?.routingContext?.embeddingSpaceId).toBe(
      CURRENT_GPU_EMBEDDING_SPACE_ID,
    );
    expect(currentJob?.routingContext?.providerProfileId).toBe(
      "diarizator-1786706202828",
    );
    expect(localJob?.routingContext?.embeddingSpaceId).toBeUndefined();
    expect(localJob?.routingContext?.modelVersion).toBeUndefined();
  }),
);
