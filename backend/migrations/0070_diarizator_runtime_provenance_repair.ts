import type { Db } from "mongodb";
import {
  CURRENT_8085_CUTOVER_AT,
  CURRENT_GPU_EMBEDDING_SPACE_ID,
  DIARIZATOR_MODEL_ID,
  DIARIZATOR_MODEL_VERSION,
  LEGACY_DIARIZATOR_MODEL_ID,
} from "./0069_diarizator_runtime_provenance.ts";

const INCORRECT_SOURCE = "historical_backfill_0069";
const REPAIR_SOURCE = "historical_code_inference_0070";
const REUSED_GPU_PROVIDER_ID = "diarizator-1786330216831";
const REUSED_GPU_URL = "http://100.119.163.116:8085";

const legacyUnknownQuery = {
  embeddingSpaceId: "legacy-unknown",
  runtimeProvenanceSource: INCORRECT_SOURCE,
};

function repairedLegacyRuntime() {
  return {
    $set: {
      modelId: LEGACY_DIARIZATOR_MODEL_ID,
      runtimeProvenanceSource: REPAIR_SOURCE,
    },
    $unset: { modelVersion: "" },
  };
}

export async function up(db: Db): Promise<void> {
  await db.collection("diarizations").updateMany(
    legacyUnknownQuery,
    repairedLegacyRuntime(),
    { hint: "diarization_embedding_space_active" },
  );
  await db.collection("diarization_runs").updateMany(
    legacyUnknownQuery,
    repairedLegacyRuntime(),
  );
  await db.collection("diarization_runs").updateMany(
    {
      embeddingSpaceId: { $exists: false },
      runtimeProvenanceSource: INCORRECT_SOURCE,
    },
    {
      $unset: {
        modelId: "",
        modelVersion: "",
        runtimeProvenanceSource: "",
      },
    },
  );

  await db.collection("speaker_profiles").updateMany(
    {
      runtimeProvenanceSource: INCORRECT_SOURCE,
      "embedding.0": { $exists: false },
    },
    {
      $unset: {
        embeddingSpaceId: "",
        modelId: "",
        modelVersion: "",
        runtimeProvenance: "",
        runtimeProvenanceSource: "",
      },
    },
  );
  await db.collection("speaker_profiles").updateMany(
    {
      embeddingSpaceId: "legacy-unknown",
      runtimeProvenanceSource: INCORRECT_SOURCE,
      "embedding.0": { $exists: true },
    },
    [{
      $set: {
        modelId: LEGACY_DIARIZATOR_MODEL_ID,
        runtimeProvenanceSource: REPAIR_SOURCE,
        runtimeProvenance: {
          modelId: LEGACY_DIARIZATOR_MODEL_ID,
          embeddingSpaceId: "$embeddingSpaceId",
          source: REPAIR_SOURCE,
        },
      },
    }, {
      $unset: ["modelVersion"],
    }],
  );

  const postCutover8085 = {
    type: { $in: ["diarization", "enrollment", "profileReenrollment"] },
    createdAt: { $gte: CURRENT_8085_CUTOVER_AT },
    $or: [
      { "routingContext.providerProfileId": REUSED_GPU_PROVIDER_ID },
      { "data.routingContext.providerProfileId": REUSED_GPU_PROVIDER_ID },
      { "data.diarizationServerUrl": REUSED_GPU_URL },
    ],
    $and: [{
      $or: [
        { "routingContext.runtimeProvenanceSource": INCORRECT_SOURCE },
        { "data.routingContext.runtimeProvenanceSource": INCORRECT_SOURCE },
      ],
    }],
  };
  await db.collection("jobs").updateMany(postCutover8085, {
    $set: {
      "routingContext.modelId": DIARIZATOR_MODEL_ID,
      "routingContext.modelVersion": DIARIZATOR_MODEL_VERSION,
      "routingContext.embeddingSpaceId": CURRENT_GPU_EMBEDDING_SPACE_ID,
      "routingContext.runtimeProvenanceSource": INCORRECT_SOURCE,
      "data.routingContext.modelId": DIARIZATOR_MODEL_ID,
      "data.routingContext.modelVersion": DIARIZATOR_MODEL_VERSION,
      "data.routingContext.embeddingSpaceId": CURRENT_GPU_EMBEDDING_SPACE_ID,
      "data.routingContext.runtimeProvenanceSource": INCORRECT_SOURCE,
    },
  });
}

export async function down(db: Db): Promise<void> {
  for (
    const collectionName of [
      "diarizations",
      "diarization_runs",
      "speaker_profiles",
    ]
  ) {
    await db.collection(collectionName).updateMany(
      { runtimeProvenanceSource: REPAIR_SOURCE },
      {
        $set: {
          modelId: DIARIZATOR_MODEL_ID,
          modelVersion: DIARIZATOR_MODEL_VERSION,
          runtimeProvenanceSource: INCORRECT_SOURCE,
        },
      },
    );
  }
}
