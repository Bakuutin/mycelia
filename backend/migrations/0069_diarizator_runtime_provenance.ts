import type { Db } from "mongodb";

export const DIARIZATOR_MODEL_ID = "pyannote/speaker-diarization-community-1";
export const DIARIZATOR_MODEL_VERSION =
  "3533c8cf8e369892e6b79ff1bf80f7b0286a54ee";
export const LEGACY_DIARIZATOR_MODEL_ID = "pyannote/speaker-diarization-3.1";
export const LEGACY_GPU_EMBEDDING_SPACE_ID =
  "20aea32f5e52271131f8957f0ee50d39435e2c4b6d2b9d2670e21f94147696ca";
export const CURRENT_GPU_EMBEDDING_SPACE_ID =
  "6a1ce44db3601802f6d1d8ee0b2d7e97de1602906ce63c219816087eb7feb09f";
export const CURRENT_8085_CUTOVER_AT = new Date(
  "2026-08-23T21:41:53.483Z",
);

const BACKFILL_SOURCE = "historical_backfill_0069";
const LEGACY_INFERENCE_SOURCE = "historical_code_inference_0069";
const DIARIZATOR_JOB_TYPES = [
  "diarization",
  "enrollment",
  "profileReenrollment",
];
const REUSED_GPU_PROVIDER_IDS = ["diarizator-1786330216831"];
const CURRENT_GPU_PROVIDER_IDS = [
  "diarizator-1786706202828",
  "diarizator-1786706203089",
  "diarizator-1786769561099",
  "diarizator-1786769567692",
  "diarizator-1786769577038",
  "diarizator-1787264520523",
];
const REUSED_GPU_URLS = ["http://100.119.163.116:8085"];
const CURRENT_GPU_URLS = [
  "http://100.119.163.116:8086",
  "http://100.119.163.116:8087",
  "http://100.119.163.116:8088",
  "http://100.119.163.116:8089",
  "http://100.119.163.116:8090",
  "http://100.119.163.116:8185",
];

function jobRouteQuery(providerIds: string[], urls: string[]) {
  return {
    type: { $in: DIARIZATOR_JOB_TYPES },
    $or: [
      { "routingContext.providerProfileId": { $in: providerIds } },
      { "data.routingContext.providerProfileId": { $in: providerIds } },
      { "data.diarizationServerUrl": { $in: urls } },
    ],
  };
}

function missingRouteProvenanceQuery() {
  return {
    $or: [
      { "routingContext.embeddingSpaceId": { $exists: false } },
      { "data.routingContext.embeddingSpaceId": { $exists: false } },
    ],
  };
}

function routeRuntimeUpdate(embeddingSpaceId: string) {
  return {
    $set: {
      "routingContext.modelId": DIARIZATOR_MODEL_ID,
      "routingContext.modelVersion": DIARIZATOR_MODEL_VERSION,
      "routingContext.embeddingSpaceId": embeddingSpaceId,
      "routingContext.runtimeProvenanceSource": BACKFILL_SOURCE,
      "data.routingContext.modelId": DIARIZATOR_MODEL_ID,
      "data.routingContext.modelVersion": DIARIZATOR_MODEL_VERSION,
      "data.routingContext.embeddingSpaceId": embeddingSpaceId,
      "data.routingContext.runtimeProvenanceSource": BACKFILL_SOURCE,
    },
  };
}

export async function up(db: Db): Promise<void> {
  const exactCommunityRuntime = {
    modelId: DIARIZATOR_MODEL_ID,
    modelVersion: DIARIZATOR_MODEL_VERSION,
    runtimeProvenanceSource: BACKFILL_SOURCE,
  };

  await db.collection("diarizations").updateMany(
    {
      embeddingSpaceId: {
        $in: [
          LEGACY_GPU_EMBEDDING_SPACE_ID,
          CURRENT_GPU_EMBEDDING_SPACE_ID,
        ],
      },
      modelVersion: { $exists: false },
    },
    { $set: exactCommunityRuntime },
    { hint: "diarization_embedding_space_active" },
  );
  await db.collection("diarizations").updateMany(
    {
      embeddingSpaceId: "legacy-unknown",
      modelId: { $exists: false },
    },
    {
      $set: {
        modelId: LEGACY_DIARIZATOR_MODEL_ID,
        runtimeProvenanceSource: LEGACY_INFERENCE_SOURCE,
      },
    },
    { hint: "diarization_embedding_space_active" },
  );

  await db.collection("diarization_runs").updateMany(
    {
      embeddingSpaceId: {
        $in: [
          LEGACY_GPU_EMBEDDING_SPACE_ID,
          CURRENT_GPU_EMBEDDING_SPACE_ID,
        ],
      },
      modelVersion: { $exists: false },
    },
    { $set: exactCommunityRuntime },
  );
  await db.collection("diarization_runs").updateMany(
    {
      embeddingSpaceId: "legacy-unknown",
      modelId: { $exists: false },
    },
    {
      $set: {
        modelId: LEGACY_DIARIZATOR_MODEL_ID,
        runtimeProvenanceSource: LEGACY_INFERENCE_SOURCE,
      },
    },
  );

  await db.collection("speaker_profiles").updateMany(
    {
      embeddingSpaceId: {
        $in: [
          LEGACY_GPU_EMBEDDING_SPACE_ID,
          CURRENT_GPU_EMBEDDING_SPACE_ID,
        ],
      },
      "embedding.0": { $exists: true },
      modelVersion: { $exists: false },
    },
    [{
      $set: {
        ...exactCommunityRuntime,
        runtimeProvenance: {
          modelId: DIARIZATOR_MODEL_ID,
          modelVersion: DIARIZATOR_MODEL_VERSION,
          embeddingSpaceId: "$embeddingSpaceId",
          source: BACKFILL_SOURCE,
        },
      },
    }],
  );
  await db.collection("speaker_profiles").updateMany(
    {
      embeddingSpaceId: "legacy-unknown",
      "embedding.0": { $exists: true },
      modelId: { $exists: false },
    },
    [{
      $set: {
        modelId: LEGACY_DIARIZATOR_MODEL_ID,
        runtimeProvenanceSource: LEGACY_INFERENCE_SOURCE,
        runtimeProvenance: {
          modelId: LEGACY_DIARIZATOR_MODEL_ID,
          embeddingSpaceId: "$embeddingSpaceId",
          source: LEGACY_INFERENCE_SOURCE,
        },
      },
    }],
  );

  const jobs = db.collection("jobs");
  await jobs.updateMany(
    {
      type: { $in: DIARIZATOR_JOB_TYPES },
      "routingContext.providerProfileId": { $exists: false },
      "data.routingContext.providerProfileId": { $exists: true },
    },
    [{
      $set: {
        "routingContext.providerProfileId":
          "$data.routingContext.providerProfileId",
        "routingContext.providerProfileName":
          "$data.routingContext.providerProfileName",
        "routingContext.sourceId": "$data.routingContext.sourceId",
        "routingContext.resolvedAt": "$data.routingContext.resolvedAt",
      },
    }],
  );

  await jobs.updateMany(
    {
      $and: [
        jobRouteQuery(REUSED_GPU_PROVIDER_IDS, REUSED_GPU_URLS),
        missingRouteProvenanceQuery(),
        {
          $or: [
            { createdAt: { $lt: CURRENT_8085_CUTOVER_AT } },
            { createdAt: { $exists: false } },
          ],
        },
      ],
    },
    routeRuntimeUpdate(LEGACY_GPU_EMBEDDING_SPACE_ID),
  );
  await jobs.updateMany(
    {
      $and: [
        jobRouteQuery(REUSED_GPU_PROVIDER_IDS, REUSED_GPU_URLS),
        missingRouteProvenanceQuery(),
        { createdAt: { $gte: CURRENT_8085_CUTOVER_AT } },
      ],
    },
    routeRuntimeUpdate(CURRENT_GPU_EMBEDDING_SPACE_ID),
  );
  await jobs.updateMany(
    {
      $and: [
        jobRouteQuery(CURRENT_GPU_PROVIDER_IDS, CURRENT_GPU_URLS),
        missingRouteProvenanceQuery(),
      ],
    },
    routeRuntimeUpdate(CURRENT_GPU_EMBEDDING_SPACE_ID),
  );
}

export async function down(db: Db): Promise<void> {
  for (const collectionName of ["diarizations", "diarization_runs"]) {
    await db.collection(collectionName).updateMany(
      {
        runtimeProvenanceSource: {
          $in: [BACKFILL_SOURCE, LEGACY_INFERENCE_SOURCE],
        },
      },
      {
        $unset: {
          modelId: "",
          modelVersion: "",
          runtimeProvenanceSource: "",
        },
      },
    );
  }
  await db.collection("speaker_profiles").updateMany(
    {
      runtimeProvenanceSource: {
        $in: [BACKFILL_SOURCE, LEGACY_INFERENCE_SOURCE],
      },
    },
    {
      $unset: {
        modelId: "",
        modelVersion: "",
        runtimeProvenance: "",
        runtimeProvenanceSource: "",
      },
    },
  );
  await db.collection("jobs").updateMany(
    {
      $or: [
        { "routingContext.runtimeProvenanceSource": BACKFILL_SOURCE },
        { "data.routingContext.runtimeProvenanceSource": BACKFILL_SOURCE },
      ],
    },
    {
      $unset: {
        "routingContext.modelId": "",
        "routingContext.modelVersion": "",
        "routingContext.embeddingSpaceId": "",
        "routingContext.runtimeProvenanceSource": "",
        "data.routingContext.modelId": "",
        "data.routingContext.modelVersion": "",
        "data.routingContext.embeddingSpaceId": "",
        "data.routingContext.runtimeProvenanceSource": "",
      },
    },
  );
}
