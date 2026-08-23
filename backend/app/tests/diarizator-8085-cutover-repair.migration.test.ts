import { expect } from "@std/expect";
import { withFixtures } from "@/tests/fixtures.server.ts";
import {
  CURRENT_8085_CUTOVER_AT,
  CURRENT_GPU_EMBEDDING_SPACE_ID,
  LEGACY_GPU_EMBEDDING_SPACE_ID,
} from "../../migrations/0069_diarizator_runtime_provenance.ts";
import { up } from "../../migrations/0071_diarizator_8085_cutover_repair.ts";

const oldBackfill = {
  modelId: "pyannote/speaker-diarization-community-1",
  modelVersion: "3533c8cf8e369892e6b79ff1bf80f7b0286a54ee",
  embeddingSpaceId: LEGACY_GPU_EMBEDDING_SPACE_ID,
  runtimeProvenanceSource: "historical_backfill_0069",
};

Deno.test(
  "8085 cutover repair covers the first observed current-runtime job",
  withFixtures(["Mongo"], async ({ db }) => {
    await db.collection("jobs").insertMany([
      {
        marker: "before-cutover",
        type: "diarization",
        createdAt: new Date(CURRENT_8085_CUTOVER_AT.getTime() - 1),
        routingContext: {
          providerProfileId: "diarizator-1786330216831",
          ...oldBackfill,
        },
        data: { routingContext: { ...oldBackfill } },
      },
      {
        marker: "first-current",
        type: "diarization",
        createdAt: CURRENT_8085_CUTOVER_AT,
        routingContext: {
          providerProfileId: "diarizator-1786330216831",
          ...oldBackfill,
        },
        data: { routingContext: { ...oldBackfill } },
      },
    ]);

    await up(db);
    await up(db);

    const before = await db.collection("jobs").findOne({
      marker: "before-cutover",
    });
    expect(before?.routingContext?.embeddingSpaceId).toBe(
      LEGACY_GPU_EMBEDDING_SPACE_ID,
    );
    const current = await db.collection("jobs").findOne({
      marker: "first-current",
    });
    expect(current?.routingContext?.embeddingSpaceId).toBe(
      CURRENT_GPU_EMBEDDING_SPACE_ID,
    );
    expect(current?.data?.routingContext?.embeddingSpaceId).toBe(
      CURRENT_GPU_EMBEDDING_SPACE_ID,
    );
    expect(current?.routingContext?.runtimeProvenanceSource).toBe(
      "historical_route_inference_0071",
    );
  }),
);
