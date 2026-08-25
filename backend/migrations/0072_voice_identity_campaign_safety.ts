import type { Db, ObjectId } from "mongodb";
import {
  ensureCollectionExists,
  ensureIndexExists,
} from "@/utils/migrations.ts";

const PREFLIGHTS = "speaker_identity_preflights";

export async function up(db: Db): Promise<void> {
  await ensureCollectionExists(db, PREFLIGHTS);
  await ensureIndexExists(db, PREFLIGHTS, { preflightToken: 1 }, {
    name: "speaker_identity_preflight_token",
    unique: true,
  });
  await ensureIndexExists(db, PREFLIGHTS, { expiresAt: 1 }, {
    name: "speaker_identity_preflight_ttl",
    expireAfterSeconds: 0,
  });
  const campaigns = db.collection("speaker_identity_campaigns");
  const duplicateActiveCampaigns = await campaigns.aggregate<{
    _id: string;
    ids: ObjectId[];
  }>([
    { $match: { active: true } },
    {
      $group: {
        _id: "$profileId",
        ids: { $push: "$_id" },
        count: { $sum: 1 },
      },
    },
    { $match: { count: { $gt: 1 } } },
  ]).toArray();
  for (const group of duplicateActiveCampaigns) {
    const records = await campaigns.find({ _id: { $in: group.ids } })
      .sort({ updatedAt: -1, createdAt: -1, _id: -1 }).toArray();
    const duplicateIds = records.slice(1).map((record) => record._id);
    if (duplicateIds.length === 0) continue;
    await campaigns.updateMany(
      { _id: { $in: duplicateIds }, active: true },
      {
        $set: {
          active: false,
          status: "interrupted",
          interruptionReason:
            "Superseded by the newest active campaign during safety migration",
          interruptedAt: new Date(),
          updatedAt: new Date(),
        },
      },
    );
  }
  await ensureIndexExists(
    db,
    "speaker_identity_campaigns",
    { profileId: 1, active: 1 },
    {
      name: "speaker_identity_single_active_profile",
      unique: true,
      partialFilterExpression: { active: true },
    },
  );
  const calibrations = db.collection("speaker_calibrations");
  const duplicateFingerprints = await calibrations.aggregate<{
    _id: { profileId: string; calibrationFingerprint: string };
    ids: ObjectId[];
  }>([
    {
      $match: {
        calibrationFingerprint: { $exists: true, $type: "string" },
      },
    },
    {
      $group: {
        _id: {
          profileId: "$profileId",
          calibrationFingerprint: "$calibrationFingerprint",
        },
        ids: { $push: "$_id" },
        count: { $sum: 1 },
      },
    },
    { $match: { count: { $gt: 1 } } },
  ]).toArray();
  for (const group of duplicateFingerprints) {
    const records = await calibrations.find({ _id: { $in: group.ids } })
      .sort({ createdAt: -1, _id: -1 }).toArray();
    const winner = records.find((record) =>
      record.lifecycleStatus === "active"
    ) ?? records[0];
    const duplicateIds = records.filter((record) =>
      !record._id.equals(winner._id)
    ).map((record) => record._id);
    if (duplicateIds.length === 0) continue;
    await calibrations.updateMany(
      { _id: { $in: duplicateIds } },
      {
        $unset: { calibrationFingerprint: "" },
        $set: {
          lifecycleStatus: "superseded",
          supersededBy: winner.calibrationId,
          supersededAt: new Date(),
          duplicateOf: winner.calibrationId,
          updatedAt: new Date(),
        },
      },
    );
  }
  await ensureIndexExists(
    db,
    "speaker_calibrations",
    { profileId: 1, calibrationFingerprint: 1 },
    {
      name: "speaker_calibration_profile_fingerprint",
      unique: true,
      partialFilterExpression: { calibrationFingerprint: { $exists: true } },
    },
  );
  await ensureIndexExists(
    db,
    "diarizations",
    { lifecycleStatus: 1, embeddingSpaceId: 1, start: 1, runId: 1, _id: 1 },
    { name: "speaker_identity_preflight_source" },
  );
  await ensureIndexExists(
    db,
    "diarizations",
    { lifecycleStatus: 1, start: 1, end: 1 },
    { name: "speaker_timeline_active_range" },
  );
  await ensureIndexExists(
    db,
    "speaker_annotations",
    { segmentId: 1, updatedAt: -1, createdAt: -1 },
    { name: "speaker_annotation_segment_latest" },
  );
}

export async function down(db: Db): Promise<void> {
  for (
    const [collection, index] of [
      [PREFLIGHTS, "speaker_identity_preflight_token"],
      [PREFLIGHTS, "speaker_identity_preflight_ttl"],
      ["speaker_calibrations", "speaker_calibration_profile_fingerprint"],
      ["speaker_identity_campaigns", "speaker_identity_single_active_profile"],
      ["diarizations", "speaker_identity_preflight_source"],
      ["diarizations", "speaker_timeline_active_range"],
      ["speaker_annotations", "speaker_annotation_segment_latest"],
    ] as const
  ) {
    if (await db.collection(collection).indexExists(index)) {
      await db.collection(collection).dropIndex(index);
    }
  }
}
