import type { Db } from "mongodb";
import {
  ensureCollectionExists,
  ensureIndexExists,
} from "@/utils/migrations.ts";

const RUNS = "diarization_runs";
const ANNOTATIONS = "speaker_annotations";
const CALIBRATIONS = "speaker_calibrations";

export async function up(db: Db): Promise<void> {
  for (const collection of [RUNS, ANNOTATIONS, CALIBRATIONS]) {
    await ensureCollectionExists(db, collection);
  }

  const now = new Date();
  const legacyCount = await db.collection("diarizations").countDocuments({});
  if (legacyCount > 0) {
    const [legacyRange] = await db.collection("diarizations").aggregate([
      {
        $group: { _id: null, start: { $min: "$start" }, end: { $max: "$end" } },
      },
    ]).toArray();
    await db.collection(RUNS).updateOne(
      { runId: "legacy-v0" },
      {
        $setOnInsert: {
          runId: "legacy-v0",
          generation: 0,
          mode: "legacy",
          status: "active",
          provenance: "unknown",
          diarizationFingerprint: null,
          embeddingSpaceId: "legacy-unknown",
          coverage: { segmentCount: legacyCount },
          range: {
            start: legacyRange?.start ?? null,
            end: legacyRange?.end ?? null,
          },
          createdAt: now,
          readyAt: now,
          activatedAt: now,
        },
      },
      { upsert: true },
    );
    await db.collection("diarizations").updateMany(
      { runId: { $exists: false } },
      {
        $set: {
          runId: "legacy-v0",
          generation: 0,
          embeddingSpaceId: "legacy-unknown",
          lifecycleStatus: "active",
        },
      },
    );
    await db.collection("diarizations").updateMany(
      {
        matched_speaker: { $exists: true },
        legacyMatchStatus: { $exists: false },
      },
      { $set: { legacyMatchStatus: "unverified" } },
    );
    const profileObjectIds = (await db.collection("speaker_profiles").find({}, {
      projection: { _id: 1 },
    }).toArray()).map((profile) => profile._id);
    const profileIds = [...profileObjectIds, ...profileObjectIds.map(String)];
    await db.collection("diarizations").updateMany(
      { "matched_speaker.profile_id": { $exists: true, $nin: profileIds } },
      { $set: { legacyMatchStatus: "stale-profile" } },
    );
  }

  await db.collection("speaker_profiles").updateMany(
    { embeddingSpaceId: { $exists: false } },
    { $set: { embeddingSpaceId: "legacy-unknown", revision: 1 } },
  );

  await ensureIndexExists(db, RUNS, { runId: 1 }, {
    name: "diarization_run_id",
    unique: true,
  });
  await ensureIndexExists(db, RUNS, { status: 1, "range.start": 1 }, {
    name: "diarization_run_status_range",
  });
  await ensureIndexExists(db, "diarizations", {
    runId: 1,
    lifecycleStatus: 1,
    start: 1,
  }, { name: "diarization_run_active_start" });
  await ensureIndexExists(db, "diarizations", {
    embeddingSpaceId: 1,
    lifecycleStatus: 1,
  }, { name: "diarization_embedding_space_active" });
  await ensureIndexExists(
    db,
    ANNOTATIONS,
    { originalId: 1, start: 1, end: 1 },
    { name: "speaker_annotation_original_range" },
  );
  await ensureIndexExists(db, CALIBRATIONS, { calibrationId: 1 }, {
    name: "speaker_calibration_id",
    unique: true,
  });
}

export async function down(db: Db): Promise<void> {
  for (
    const [collection, index] of [
      [RUNS, "diarization_run_id"],
      [RUNS, "diarization_run_status_range"],
      ["diarizations", "diarization_run_active_start"],
      ["diarizations", "diarization_embedding_space_active"],
      [ANNOTATIONS, "speaker_annotation_original_range"],
      [CALIBRATIONS, "speaker_calibration_id"],
    ] as const
  ) {
    if (await db.collection(collection).indexExists(index)) {
      await db.collection(collection).dropIndex(index);
    }
  }
}
