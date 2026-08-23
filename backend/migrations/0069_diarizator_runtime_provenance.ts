import type { Db } from "mongodb";

export const DIARIZATOR_MODEL_ID = "pyannote/speaker-diarization-community-1";
export const DIARIZATOR_MODEL_VERSION =
  "3533c8cf8e369892e6b79ff1bf80f7b0286a54ee";
export const LEGACY_GPU_EMBEDDING_SPACE_ID =
  "20aea32f5e52271131f8957f0ee50d39435e2c4b6d2b9d2670e21f94147696ca";
export const CURRENT_GPU_EMBEDDING_SPACE_ID =
  "6a1ce44db3601802f6d1d8ee0b2d7e97de1602906ce63c219816087eb7feb09f";

const BACKFILL_SOURCE = "historical_backfill_0069";
const DIARIZATOR_JOB_TYPES = [
  "diarization",
  "enrollment",
  "profileReenrollment",
];
const LEGACY_GPU_PROVIDER_IDS = ["diarizator-1786330216831"];
const CURRENT_GPU_PROVIDER_IDS = [
  "diarizator-1786706202828",
  "diarizator-1786706203089",
  "diarizator-1786769561099",
  "diarizator-1786769567692",
  "diarizator-1786769577038",
  "diarizator-1787264520523",
];
const LEGACY_GPU_URLS = ["http://100.119.163.116:8085"];
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

export async function up(db: Db): Promise<void> {
  const baseRuntime = {
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
          "legacy-unknown",
        ],
      },
      modelVersion: { $exists: false },
    },
    { $set: baseRuntime },
    { hint: "diarization_embedding_space_active" },
  );

  await db.collection("diarization_runs").updateMany(
    { modelVersion: { $exists: false } },
    { $set: baseRuntime },
  );

  await db.collection("speaker_profiles").updateMany(
    { modelVersion: { $exists: false } },
    [{
      $set: {
        ...baseRuntime,
        runtimeProvenance: {
          modelId: DIARIZATOR_MODEL_ID,
          modelVersion: DIARIZATOR_MODEL_VERSION,
          embeddingSpaceId: "$embeddingSpaceId",
          source: BACKFILL_SOURCE,
        },
      },
    }],
  );

  const jobs = db.collection("jobs");
  await jobs.updateMany(
    {
      type: { $in: DIARIZATOR_JOB_TYPES },
      $or: [
        { "routingContext.modelVersion": { $exists: false } },
        { "data.routingContext.modelVersion": { $exists: false } },
      ],
    },
    {
      $set: {
        "routingContext.modelId": DIARIZATOR_MODEL_ID,
        "routingContext.modelVersion": DIARIZATOR_MODEL_VERSION,
        "routingContext.runtimeProvenanceSource": BACKFILL_SOURCE,
        "data.routingContext.modelId": DIARIZATOR_MODEL_ID,
        "data.routingContext.modelVersion": DIARIZATOR_MODEL_VERSION,
        "data.routingContext.runtimeProvenanceSource": BACKFILL_SOURCE,
      },
    },
  );

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

  for (
    const [query, embeddingSpaceId] of [
      [
        jobRouteQuery(LEGACY_GPU_PROVIDER_IDS, LEGACY_GPU_URLS),
        LEGACY_GPU_EMBEDDING_SPACE_ID,
      ],
      [
        jobRouteQuery(CURRENT_GPU_PROVIDER_IDS, CURRENT_GPU_URLS),
        CURRENT_GPU_EMBEDDING_SPACE_ID,
      ],
    ] as const
  ) {
    await jobs.updateMany(query, {
      $set: {
        "routingContext.embeddingSpaceId": embeddingSpaceId,
        "data.routingContext.embeddingSpaceId": embeddingSpaceId,
      },
    });
  }
}

export async function down(db: Db): Promise<void> {
  for (const collectionName of ["diarizations", "diarization_runs"]) {
    await db.collection(collectionName).updateMany(
      { runtimeProvenanceSource: BACKFILL_SOURCE },
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
    { runtimeProvenanceSource: BACKFILL_SOURCE },
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
