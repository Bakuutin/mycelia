import { z } from "zod";
import { ObjectId } from "bson";
import { zDateOrString } from "@myceliasdk/zod-json-schema.ts";
import { NetworkJobCapability } from "./python.ts";
import { findUsableFullCalibration } from "@/lib/speakers/calibration-contract.ts";
import {
  buildCurrentIdentityCondition,
  buildIdentityPartitionPipeline,
  buildIdentitySourceMatch,
  type IdentityCalibrationSnapshot,
} from "@/lib/speakers/identity-campaign.ts";
import { getTriggerTiming } from "@/lib/jobs/trigger-config.ts";

export const schema = z.object({
  type: z.literal("speakerIdentity"),
  runId: z.string().min(1),
  profileId: z.string().min(1),
  profileRevision: z.number().int().positive(),
  calibrationId: z.string().min(1),
  evidenceSnapshotHash: z.string().min(1),
  start: zDateOrString().optional(),
  end: zDateOrString().optional(),
  limit: z.number().int().min(1).max(10000).default(1000),
  cursor: z.string().optional(),
  campaignId: z.string().min(1).optional(),
  snapshotCutoff: zDateOrString().optional(),
  partitions: z.array(z.object({
    runId: z.string().min(1),
    embeddingSpaceId: z.string().min(1),
    start: zDateOrString(),
    end: zDateOrString(),
    eligibleSegments: z.number().int().nonnegative(),
    sourceSegments: z.number().int().nonnegative(),
    generation: z.number().int().nonnegative().nullable().optional(),
  })).max(100).default([]),
  partitionIndex: z.number().int().nonnegative().default(0),
  campaignTotalSegments: z.number().int().nonnegative().optional(),
  campaignMode: z.enum(["classify_existing", "classify_automatic"]).optional(),
});

const PYTHON_WORKER_URL = Deno.env.get("PYTHON_WORKER_URL") ||
  "http://localhost:8000";

type MongoResource = (request: Record<string, unknown>) => Promise<any>;

async function resolveAutomaticIdentityContext(mongo: MongoResource): Promise<
  {
    profile: any;
    calibration: any;
    snapshot: IdentityCalibrationSnapshot;
    evidenceSnapshotHash: string;
  } | null
> {
  const profile = await mongo({
    action: "findOne",
    collection: "speaker_profiles",
    query: { is_primary: true },
    options: {
      projection: {
        name: 1,
        is_primary: 1,
        revision: 1,
        embeddingSpaceId: 1,
        embedding: 1,
        enrollmentStatus: 1,
        activeCalibrationIds: 1,
        activeCalibrationId: 1,
        calibrationHeadsInitialized: 1,
      },
    },
  });
  if (
    !profile?.embeddingSpaceId || !Array.isArray(profile.embedding) ||
    profile.embedding.length === 0 ||
    profile.enrollmentStatus === "pending_rebuild"
  ) return null;
  const profileId = String(profile._id);
  const calibrations = await mongo({
    action: "find",
    collection: "speaker_calibrations",
    query: { profileId },
    options: { sort: { createdAt: -1 }, limit: 50 },
  }) as any[];
  const hasCalibrationHeads = profile.activeCalibrationIds !== undefined &&
    profile.activeCalibrationIds !== null;
  const fullCalibrationHead = hasCalibrationHeads &&
      profile.activeCalibrationIds?.full
    ? String(profile.activeCalibrationIds.full)
    : null;
  const legacyCalibrationHead = !hasCalibrationHeads &&
      profile.activeCalibrationId !== undefined &&
      profile.activeCalibrationId !== null
    ? String(profile.activeCalibrationId)
    : null;
  const authoritativeCalibrationHead = fullCalibrationHead ??
    legacyCalibrationHead;
  const legacyFallbackAllowed = profile.calibrationHeadsInitialized !== true &&
    !hasCalibrationHeads && !legacyCalibrationHead;
  const headedCalibrations = authoritativeCalibrationHead
    ? calibrations.filter((candidate) =>
      String(candidate?.calibrationId ?? "") === authoritativeCalibrationHead
    )
    : legacyFallbackAllowed
    ? calibrations
    : [];
  const calibration = findUsableFullCalibration(headedCalibrations, {
    profileId,
    profileRevision: Number(profile.revision ?? 1),
    embeddingSpaceId: String(profile.embeddingSpaceId),
  });
  if (!calibration) return null;
  const evidenceSnapshotHash = String(
    calibration.evidenceSnapshotHash ?? "",
  ).trim();
  if (!evidenceSnapshotHash) return null;
  const baseline = await mongo({
    action: "findOne",
    collection: "speaker_identity_campaigns",
    query: {
      profileId,
      calibrationId: String(calibration.calibrationId),
      profileRevision: Number(profile.revision ?? 1),
      embeddingSpaceId: String(profile.embeddingSpaceId),
      mode: "classify_all_compatible",
      "scope.mode": "all_compatible",
      status: "completed",
      classificationPolicy: "full",
      evidenceSnapshotHash,
      pendingSegments: 0,
      sourceChanged: { $ne: true },
    },
    options: {
      sort: { finishedAt: -1 },
      projection: { _id: 1, finishedAt: 1 },
    },
  });
  const baselineFinishedAt = baseline?.finishedAt
    ? new Date(baseline.finishedAt)
    : null;
  if (!baselineFinishedAt || !Number.isFinite(baselineFinishedAt.getTime())) {
    return null;
  }
  const profileReference = ObjectId.isValid(profileId)
    ? new ObjectId(profileId)
    : profileId;
  const newerAnnotation = await mongo({
    action: "findOne",
    collection: "speaker_annotations",
    query: {
      $and: [
        {
          $or: [
            { profileId: profileReference },
            { excludedProfileIds: profileReference },
          ],
        },
        {
          $or: [
            { updatedAt: { $gt: baselineFinishedAt } },
            {
              updatedAt: { $exists: false },
              createdAt: { $gt: baselineFinishedAt },
            },
          ],
        },
      ],
    },
    options: { projection: { _id: 1 } },
  });
  if (newerAnnotation) return null;
  return {
    profile,
    calibration,
    evidenceSnapshotHash,
    snapshot: {
      profileId,
      calibrationId: String(calibration.calibrationId),
      profileRevision: Number(profile.revision ?? 1),
      embeddingSpaceId: String(profile.embeddingSpaceId),
      classificationPolicy: "full",
      evidenceSnapshotHash,
    },
  };
}

async function hasOpenIdentityCampaign(
  mongo: MongoResource,
  profileId: string,
): Promise<boolean> {
  const campaign = await mongo({
    action: "findOne",
    collection: "speaker_identity_campaigns",
    query: {
      profileId,
      active: true,
      status: { $in: ["queued", "counting", "running"] },
    },
    options: {
      projection: {
        _id: 1,
        mode: 1,
        status: 1,
        currentJobId: 1,
        updatedAt: 1,
      },
    },
  });
  if (
    campaign?.mode === "classify_automatic" && campaign.status === "queued" &&
    campaign.updatedAt &&
    new Date(campaign.updatedAt).getTime() < Date.now() - 5 * 60_000
  ) {
    const currentJobId = typeof campaign.currentJobId === "string"
      ? campaign.currentJobId
      : null;
    const persistedJob = currentJobId && ObjectId.isValid(currentJobId)
      ? await mongo({
        action: "findOne",
        collection: "jobs",
        query: { _id: new ObjectId(currentJobId) },
        options: { projection: { _id: 1, state: 1 } },
      })
      : null;
    if (persistedJob && ["waiting", "active"].includes(persistedJob.state)) {
      return true;
    }
    const interrupted = await mongo({
      action: "updateOne",
      collection: "speaker_identity_campaigns",
      query: {
        _id: campaign._id,
        active: true,
        currentJobId: currentJobId ?? null,
      },
      update: {
        $set: {
          active: false,
          status: "interrupted",
          failureReason: "Automatic enqueue was not completed",
          finishedAt: new Date(),
          updatedAt: new Date(),
        },
      },
    }) as any;
    return interrupted?.matchedCount !== 1;
  }
  return Boolean(campaign);
}

export default new NetworkJobCapability({
  name: "speakerIdentity",
  schema,
  url: `${PYTHON_WORKER_URL}/jobs/speakerIdentity`,
  policies: [
    { resource: "db/speaker_profiles", action: "read", effect: "allow" },
    { resource: "db/speaker_calibrations", action: "read", effect: "allow" },
    { resource: "db/speaker_annotations", action: "read", effect: "allow" },
    { resource: "db/speaker_identity_campaigns", action: "*", effect: "allow" },
    { resource: "db/diarizations", action: "*", effect: "allow" },
  ],
  hasPendingWork: async ({ mongo }) => {
    const context = await resolveAutomaticIdentityContext(mongo);
    if (
      !context ||
      await hasOpenIdentityCampaign(mongo, context.snapshot.profileId)
    ) {
      return false;
    }
    const snapshotCutoff = new Date();
    const currentIdentity = buildCurrentIdentityCondition(context.snapshot);
    const pending = await mongo({
      action: "find",
      collection: "diarizations",
      query: {
        ...buildIdentitySourceMatch(
          context.snapshot,
          { mode: "all_compatible" },
          snapshotCutoff,
        ),
        $nor: [currentIdentity],
      },
      options: { projection: { _id: 1 }, limit: 1 },
    }) as any[];
    // Cap trigger fan-out at one campaign even if runtime concurrency is raised.
    return pending.length > 0 ? 1 : 0;
  },
  getTriggerJobData: async (_payload, _reason, { mongo }) => {
    const context = await resolveAutomaticIdentityContext(mongo);
    if (
      !context ||
      await hasOpenIdentityCampaign(mongo, context.snapshot.profileId)
    ) {
      throw new Error(
        "Automatic speaker identity is not ready or already running",
      );
    }
    const snapshotCutoff = new Date();
    const scope = { mode: "all_compatible" as const };
    const [eligibleRows, sourceRows] = await Promise.all([
      mongo({
        action: "aggregate",
        collection: "diarizations",
        pipeline: buildIdentityPartitionPipeline(
          context.snapshot,
          scope,
          snapshotCutoff,
        ),
        options: { maxTimeMS: 20_000 },
      }),
      mongo({
        action: "aggregate",
        collection: "diarizations",
        pipeline: [
          {
            $match: buildIdentitySourceMatch(
              context.snapshot,
              scope,
              snapshotCutoff,
            ),
          },
          {
            $group: {
              _id: { runId: "$runId", embeddingSpaceId: "$embeddingSpaceId" },
              sourceSegments: { $sum: 1 },
              start: { $min: "$start" },
              end: { $max: "$end" },
            },
          },
        ],
        options: { maxTimeMS: 20_000 },
      }),
    ]) as [any[], any[]];
    const sourceByKey = new Map(sourceRows.map((row) => [
      `${row?._id?.runId}\u0000${row?._id?.embeddingSpaceId}`,
      row,
    ]));
    const partitions = eligibleRows.map((row) => {
      const runId = String(row?._id?.runId ?? "");
      const embeddingSpaceId = String(row?._id?.embeddingSpaceId ?? "");
      const source = sourceByKey.get(`${runId}\u0000${embeddingSpaceId}`);
      return {
        runId,
        embeddingSpaceId,
        start: source?.start ?? row.start,
        end: source?.end ?? row.end,
        eligibleSegments: Number(row.eligibleSegments ?? 0),
        sourceSegments: Number(
          source?.sourceSegments ?? row.eligibleSegments ?? 0,
        ),
        generation: null,
      };
    }).filter((partition) =>
      partition.runId && partition.embeddingSpaceId &&
      partition.eligibleSegments > 0
    );
    if (partitions.length === 0) {
      throw new Error("No new compatible speaker segments remain");
    }
    const total = partitions.reduce(
      (sum, partition) => sum + partition.eligibleSegments,
      0,
    );
    const campaignId = `speaker-identity-auto-${crypto.randomUUID()}`;
    const now = new Date();
    await mongo({
      action: "insertOne",
      collection: "speaker_identity_campaigns",
      doc: {
        campaignId,
        mode: "classify_automatic",
        active: true,
        status: "queued",
        profileId: context.snapshot.profileId,
        profileName: context.profile.name,
        profileRevision: context.snapshot.profileRevision,
        calibrationId: context.snapshot.calibrationId,
        evidenceSnapshotHash: context.evidenceSnapshotHash,
        classificationPolicy: "full",
        decisionValidity: "verified",
        embeddingSpaceId: context.snapshot.embeddingSpaceId,
        scope,
        range: { start: null, end: snapshotCutoff },
        snapshotCutoff,
        partitions,
        partitionIndex: 0,
        totalSegments: total,
        pendingSegments: total,
        processedSegments: 0,
        matched: 0,
        rejected: 0,
        uncertain: 0,
        incompatibleSkipped: 0,
        createdAt: now,
        updatedAt: now,
      },
    });
    return {
      type: "speakerIdentity",
      runId: partitions[0].runId,
      profileId: context.snapshot.profileId,
      profileRevision: context.snapshot.profileRevision,
      calibrationId: context.snapshot.calibrationId,
      evidenceSnapshotHash: context.evidenceSnapshotHash,
      end: snapshotCutoff,
      snapshotCutoff,
      partitions,
      partitionIndex: 0,
      campaignTotalSegments: total,
      campaignMode: "classify_automatic",
      campaignId,
      limit: 1_000,
    };
  },
  triggers: {
    sources: [],
    ...getTriggerTiming("speakerIdentity"),
  },
});
