import { z } from "zod";
import { Buffer } from "node:buffer";
import { createHash, randomUUID } from "node:crypto";
import { type Db, GridFSBucket, ObjectId } from "mongodb";
import { Auth, type Auth as AuthType } from "@/lib/auth/core.server.ts";
import type { Resource } from "@/lib/auth/resources.ts";
import { getRootDB } from "@/lib/mongo/core.server.ts";
import { getServerConfig } from "@/lib/config/serverConfig.server.ts";
import { enqueueJob } from "@/lib/jobs/queue.ts";
import {
  createWebpPreview,
  inspectLocalMedia,
  listMediaSourceFolders,
  mediaSourceConfigured,
  resolveMediaSourcePath,
  scanMediaSourceInventory,
} from "@/lib/media/local.server.ts";
import {
  enqueueConfirmedAsset,
  mediaImportTemporalSpatialFields,
} from "@/lib/media/resource.server.ts";
import {
  assertMediaPerImportBudget,
  estimateMediaGrossUsd,
} from "@/lib/media/costs.ts";
import {
  type MediaKnowledgeConfig,
  type MediaRecognitionProfile,
  type MediaRecognitionTask,
  zMediaKnowledgeConfig,
  zMediaRecognitionTask,
} from "@myceliasdk/media.ts";

export const FOLDER_CHUNK_SIZE = 25;
const MAX_FOLDER_FILES = 20_000;
export const RECOGNITION_WINDOW = 16;
const PREVIEW_TTL_MS = 60 * 60 * 1000;
const STALE_ITEM_MS = 20 * 60 * 1000;
const FOLDER_STALE_ITEM_MS = 5 * 60 * 1000;

const startFolderScanSchema = z.object({
  action: z.literal("startFolderScan"),
  relativePath: z.string().trim().min(1).default("."),
});
const listMountedFoldersSchema = z.object({
  action: z.literal("listMountedFolders"),
  relativePath: z.string().trim().min(1).default("."),
});
const getFolderCampaignSchema = z.object({
  action: z.literal("getFolderCampaign"),
  campaignId: z.string().refine(ObjectId.isValid),
});
const getActiveFolderCampaignSchema = z.object({
  action: z.literal("getActiveFolderCampaign"),
});
const confirmFolderCampaignSchema = z.object({
  action: z.literal("confirmFolderCampaign"),
  campaignId: z.string().refine(ObjectId.isValid),
  confirm: z.literal(true),
});
const processFolderCampaignSchema = z.object({
  action: z.literal("processFolderCampaign"),
  campaignId: z.string().refine(ObjectId.isValid).optional(),
  jobId: z.string().refine(ObjectId.isValid),
});

const recognitionTasksSchema = z.array(zMediaRecognitionTask).min(1).max(4)
  .default(["visual-understanding", "ocr"]);
const previewRecognitionBatchSchema = z.object({
  action: z.literal("previewRecognitionBatch"),
  profileId: z.string().min(1),
  requestedTasks: recognitionTasksSchema,
});
const confirmRecognitionBatchSchema = z.object({
  action: z.literal("confirmRecognitionBatch"),
  previewId: z.string().refine(ObjectId.isValid),
  consent: z.literal(true),
});
const getRecognitionBatchSchema = z.object({
  action: z.literal("getRecognitionBatch"),
  batchId: z.string().refine(ObjectId.isValid),
});
const cancelRecognitionBatchSchema = z.object({
  action: z.literal("cancelRecognitionBatch"),
  batchId: z.string().refine(ObjectId.isValid),
  confirm: z.literal(true),
});
const retryRecognitionBatchFailuresSchema = z.object({
  action: z.literal("retryRecognitionBatchFailures"),
  batchId: z.string().refine(ObjectId.isValid),
  confirm: z.literal(true),
});
const processRecognitionBatchSchema = z.object({
  action: z.literal("processRecognitionBatch"),
  batchId: z.string().refine(ObjectId.isValid).optional(),
  jobId: z.string().refine(ObjectId.isValid),
});

const timelineSchema = z.object({
  action: z.literal("timeline"),
  start: z.string().datetime(),
  end: z.string().datetime(),
  detailLimit: z.number().int().min(100).max(2_000).default(1_000),
});
const mapSchema = z.object({
  action: z.literal("map"),
  bounds: z.object({
    west: z.number().min(-180).max(180),
    south: z.number().min(-90).max(90),
    east: z.number().min(-180).max(180),
    north: z.number().min(-90).max(90),
  }).optional(),
  limit: z.number().int().min(100).max(2_000).default(2_000),
});
const summarySchema = z.object({ action: z.literal("summary") });
const updatePlacementSchema = z.object({
  action: z.literal("updatePlacement"),
  assetId: z.string().refine(ObjectId.isValid),
  expectedRevision: z.number().int().nonnegative(),
  capturedAt: z.string().datetime().nullable().optional(),
  timeZone: z.string().trim().min(1).max(100).nullable().optional(),
  location: z.object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    altitudeMeters: z.number().finite().optional(),
  }).nullable().optional(),
});

export const mediaLibraryRequestSchema = z.discriminatedUnion("action", [
  listMountedFoldersSchema,
  startFolderScanSchema,
  getFolderCampaignSchema,
  getActiveFolderCampaignSchema,
  confirmFolderCampaignSchema,
  processFolderCampaignSchema,
  previewRecognitionBatchSchema,
  confirmRecognitionBatchSchema,
  getRecognitionBatchSchema,
  cancelRecognitionBatchSchema,
  retryRecognitionBatchFailuresSchema,
  processRecognitionBatchSchema,
  timelineSchema,
  mapSchema,
  summarySchema,
  updatePlacementSchema,
]);
type MediaLibraryRequest = z.infer<typeof mediaLibraryRequestSchema>;

function safeError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error))
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\/media-source\/?/g, "[media-source]/")
    .slice(0, 700);
}

function stableHash(parts: unknown[]): string {
  return createHash("sha256").update(parts.map(String).join("\0")).digest(
    "hex",
  );
}

function deterministicObjectId(parts: unknown[]): ObjectId {
  return new ObjectId(stableHash(parts).slice(0, 24));
}

function mediaConfig(value: unknown): MediaKnowledgeConfig {
  return zMediaKnowledgeConfig.parse(
    (value as { mediaKnowledge?: unknown })?.mediaKnowledge ?? {},
  );
}

async function loadConfig(): Promise<MediaKnowledgeConfig> {
  return mediaConfig(await getServerConfig());
}

function selectProfile(
  config: MediaKnowledgeConfig,
  profileId: string,
): MediaRecognitionProfile {
  if (!config.enabled) {
    throw new Error("Media Knowledge recognition is disabled");
  }
  const profile = config.profiles.find((entry) => entry.id === profileId);
  if (!profile) throw new Error("Media recognition profile was not found");
  if (!profile.enabled) {
    throw new Error("Media recognition profile is disabled");
  }
  return profile;
}

export function assertRecognitionTasks(
  profile: MediaRecognitionProfile,
  tasks: MediaRecognitionTask[],
): void {
  if (tasks.length === 0) {
    throw new Error("Select at least one recognition task");
  }
  if (tasks.includes("labels") || tasks.includes("objects")) {
    throw new Error(
      "Bulk EU Photo Knowledge intentionally supports visual understanding and OCR only",
    );
  }
  if (profile.providerType !== "google-cloud") {
    throw new Error("This batch action requires a Google Cloud media profile");
  }
}

async function uploadGridFs(
  db: Db,
  filename: string,
  data: Uint8Array,
  metadata: Record<string, unknown>,
): Promise<ObjectId> {
  const id = new ObjectId();
  const stream = new GridFSBucket(db, { bucketName: "media_previews" })
    .openUploadStream(filename, { id, metadata });
  stream.end(Buffer.from(data));
  await new Promise<void>((resolve, reject) => {
    stream.on("finish", () => resolve());
    stream.on("error", reject);
  });
  return id;
}

async function deletePreview(db: Db, fileId?: ObjectId): Promise<void> {
  if (!fileId) return;
  await new GridFSBucket(db, { bucketName: "media_previews" }).delete(fileId)
    .catch(() => undefined);
}

function thumbnailUrl(value: any): string | undefined {
  return value?.thumbnail?.fileId
    ? `/api/files/${value.thumbnail.fileId}?bucket=media_previews`
    : undefined;
}

function ownerAuth(owner: string): Auth {
  return new Auth({
    principal: owner,
    policies: [{ resource: "**", action: "*", effect: "allow" }],
  });
}

async function assertTrustedCoordinatorJob(
  db: Db,
  principal: string,
  jobId: string,
  expectedTypes: string[],
): Promise<any> {
  if (principal !== `job:${jobId}`) {
    throw new Error(
      "Campaign processing is restricted to its signed worker job",
    );
  }
  const job = await db.collection("jobs").findOne({
    _id: new ObjectId(jobId),
    type: { $in: expectedTypes },
  }, { projection: { data: 1, state: 1 } });
  if (!job) throw new Error("Trusted campaign job record was not found");
  return job;
}

async function enqueueFolderWorker(
  campaignId: ObjectId,
  auth: AuthType,
): Promise<string> {
  const job = await enqueueJob(
    { type: "mediaFolderImport", campaignId: String(campaignId) },
    { trigger: { type: "manual", reason: "media folder campaign" } },
    auth,
  );
  return String(job.id);
}

async function enqueueRecognitionWorker(
  batchId: ObjectId,
  auth: AuthType,
): Promise<string> {
  const job = await enqueueJob(
    { type: "mediaRecognitionBatch", batchId: String(batchId) },
    { trigger: { type: "manual", reason: "media recognition batch" } },
    auth,
  );
  return String(job.id);
}

async function stateCounts(
  db: Db,
  collection: string,
  key: "campaignId" | "batchId",
  id: ObjectId,
): Promise<Record<string, number>> {
  const rows = await db.collection(collection).aggregate([
    { $match: { [key]: id } },
    { $group: { _id: "$state", count: { $sum: 1 } } },
  ]).toArray();
  const counts: Record<string, number> = {};
  for (const row of rows) counts[String(row._id)] = Number(row.count ?? 0);
  counts.total = rows.reduce((sum, row) => sum + Number(row.count ?? 0), 0);
  return counts;
}

export function publicFolderCounts(counts: Record<string, number>) {
  return {
    total: counts.total ?? 0,
    pending: counts.pending ?? 0,
    processing: (counts.inspecting ?? 0) + (counts.importing ?? 0),
    ready: counts.ready ?? 0,
    imported: counts.imported ?? 0,
    duplicate: counts.duplicate ?? 0,
    unsupported: counts.unsupported ?? 0,
    changed: counts.changed ?? 0,
    failed: counts.failed ?? 0,
  };
}

export function folderCampaignProgress(
  campaign: any,
  rawCounts: Record<string, number>,
) {
  const status = String(campaign.status);
  const totalEntries = rawCounts.total ?? 0;
  const unsupported = rawCounts.unsupported ?? 0;
  const supportedTotal = Math.max(0, totalEntries - unsupported);
  const scanRemaining = (rawCounts.pending ?? 0) +
    (rawCounts.inspecting ?? 0);
  const scanProcessed = Math.max(0, supportedTotal - scanRemaining);
  const confirmedReady = Number(
    campaign.confirmationReceipt?.counts?.ready ?? supportedTotal,
  );
  const importRemaining = (rawCounts.ready ?? 0) +
    (rawCounts.importing ?? 0);
  const importProcessed = Math.max(0, confirmedReady - importRemaining);
  const stage = status === "queued"
    ? "inventory"
    : status === "scanning"
    ? "metadata_scan"
    : status === "preview_ready"
    ? "awaiting_confirmation"
    : status === "importing"
    ? "creating_previews"
    : status === "cancelled"
    ? "cancelled"
    : status === "failed"
    ? "failed"
    : "completed";
  const total = stage === "inventory"
    ? totalEntries
    : stage === "creating_previews"
    ? confirmedReady
    : supportedTotal;
  const processed = stage === "inventory"
    ? 0
    : stage === "metadata_scan"
    ? scanProcessed
    : stage === "creating_previews"
    ? importProcessed
    : total;
  const remaining = Math.max(0, total - processed);
  const percent = total > 0
    ? Math.min(100, Math.max(0, Number((processed / total * 100).toFixed(1))))
    : 0;
  const startedAt = stage === "creating_previews"
    ? campaign.importStartedAt ?? campaign.updatedAt
    : campaign.scanStartedAt ?? campaign.createdAt;
  const elapsedSeconds = startedAt
    ? Math.max(1, (Date.now() - new Date(startedAt).getTime()) / 1_000)
    : 0;
  const filesPerSecond = processed > 0 && elapsedSeconds > 0
    ? Number((processed / elapsedSeconds).toFixed(2))
    : undefined;
  const etaSeconds = filesPerSecond && remaining > 0
    ? Math.ceil(remaining / filesPerSecond)
    : undefined;
  const lastProgressAt = campaign.lastProgressAt ?? campaign.updatedAt;
  const waitingForRecovery = stage === "metadata_scan" && remaining > 0 &&
    lastProgressAt &&
    Date.now() - new Date(lastProgressAt).getTime() > 60_000;
  const copy = waitingForRecovery
    ? {
      message:
        "Waiting for an interrupted local file step to become safe to resume",
      nextStep:
        "No action is required; the watchdog will release the stale claim automatically",
    }
    : stage === "inventory"
    ? {
      message: "Building a recursive local file inventory",
      nextStep: "Metadata and hashes will be checked locally in 25-file steps",
    }
    : stage === "metadata_scan"
    ? {
      message: "Reading metadata and hashes locally; Google is not used",
      nextStep:
        "When scanning finishes, review the report and confirm the local import",
    }
    : stage === "awaiting_confirmation"
    ? {
      message: "Local scan complete; no files have been imported yet",
      nextStep: "Review the totals and select Confirm local import",
    }
    : stage === "creating_previews"
    ? {
      message: "Creating compact WebP previews and read-only asset references",
      nextStep:
        "The Media inventory will refresh when the local import finishes",
    }
    : stage === "completed"
    ? {
      message: "Mounted-folder campaign finished",
      nextStep:
        "Review imported and attention-needed photos in the Media inventory",
    }
    : stage === "failed"
    ? {
      message: "Mounted-folder campaign stopped with an error",
      nextStep:
        "Review the safe error below and start the scan again after fixing it",
    }
    : {
      message: "Mounted-folder campaign was cancelled",
      nextStep: "Start a new scan when you are ready",
    };
  return {
    stage,
    processed,
    total,
    remaining,
    percent,
    ...(filesPerSecond ? { filesPerSecond } : {}),
    ...(!waitingForRecovery && etaSeconds !== undefined ? { etaSeconds } : {}),
    ...(waitingForRecovery ? { waitingForRecovery: true } : {}),
    chunkSize: FOLDER_CHUNK_SIZE,
    ...copy,
    ...(startedAt ? { startedAt } : {}),
    ...(lastProgressAt ? { lastProgressAt } : {}),
  };
}

function publicRecognitionCounts(counts: Record<string, number>) {
  return {
    total: counts.total ?? 0,
    pending: (counts.pending ?? 0) + (counts.claiming ?? 0),
    queued: counts.queued ?? 0,
    processing: counts.processing ?? 0,
    ready: counts.ready ?? 0,
    skipped: counts.skipped ?? 0,
    failed: (counts.failed ?? 0) + (counts.budget_blocked ?? 0),
    cancelled: counts.cancelled ?? 0,
  };
}

async function recoverStaleRecognitionClaims(db: Db, batch: any) {
  const stale = await db.collection<any>("media_recognition_batch_items").find({
    batchId: batch._id,
    state: "claiming",
    claimedAt: { $lt: new Date(Date.now() - STALE_ITEM_MS) },
  }).limit(RECOGNITION_WINDOW * 2).toArray();
  for (const item of stale) {
    const job = item.jobId
      ? await db.collection<any>("jobs").findOne({ _id: item.jobId })
      : null;
    if (job && !["failed", "cancelled"].includes(job.state)) {
      await db.collection("media_recognition_batch_items").updateOne(
        { _id: item._id, state: "claiming" },
        {
          $set: {
            state: job.state === "active" ? "processing" : "queued",
            updatedAt: new Date(),
          },
          $unset: { claimedAt: "" },
        },
      );
      continue;
    }
    await db.collection("media_assets").updateOne(
      {
        _id: item.assetId,
        owner: batch.owner,
        status: "queued",
        currentRunId: { $exists: false },
      },
      { $set: { status: "staged", updatedAt: new Date() } },
    );
    await db.collection("media_recognition_batch_items").updateOne(
      { _id: item._id, state: "claiming" },
      {
        $set: { state: "pending", updatedAt: new Date() },
        $unset: { claimedAt: "", jobId: "", safeError: "" },
      },
    );
  }
}

async function publicFolderCampaign(db: Db, campaign: any) {
  const rawCounts = await stateCounts(
    db,
    "media_folder_items",
    "campaignId",
    campaign._id,
  );
  const counts = publicFolderCounts(rawCounts);
  const samples = await db.collection("media_folder_items").find({
    campaignId: campaign._id,
    state: { $in: ["ready", "duplicate", "imported"] },
  }, {
    projection: {
      relativePath: 1,
      fileName: 1,
      byteLength: 1,
      capturedAt: 1,
      location: 1,
      state: 1,
    },
  }).sort({ relativePath: 1 }).limit(12).toArray();
  return {
    _id: campaign._id,
    owner: campaign.owner,
    relativePath: campaign.relativePath,
    status: campaign.status,
    counts,
    progress: folderCampaignProgress(campaign, rawCounts),
    samples,
    inventoryTruncated: Boolean(campaign.inventoryTruncated),
    safeError: campaign.safeError,
    createdAt: campaign.createdAt,
    updatedAt: campaign.updatedAt,
    completedAt: campaign.completedAt,
  };
}

async function initializeFolderInventory(db: Db, campaign: any): Promise<void> {
  const inventory = await scanMediaSourceInventory(
    campaign.relativePath,
    MAX_FOLDER_FILES,
    { includeUnsupported: true },
  );
  if (inventory.truncated) {
    throw new Error(
      `Mounted folder contains more than ${MAX_FOLDER_FILES} files; split it into subfolders`,
    );
  }
  if (inventory.paths.length === 0 && inventory.unsupportedPaths.length === 0) {
    throw new Error("No supported JPEG, PNG, WebP, or PDF files were found");
  }
  const items = db.collection("media_folder_items");
  const inventoryItems = [
    ...inventory.paths.map((relativePath) => ({
      relativePath,
      state: "pending",
    })),
    ...inventory.unsupportedPaths.map((relativePath) => ({
      relativePath,
      state: "unsupported",
    })),
  ].sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  for (let index = 0; index < inventoryItems.length; index += 1_000) {
    const page = inventoryItems.slice(index, index + 1_000);
    await items.bulkWrite(
      page.map((entry) => ({
        updateOne: {
          filter: {
            campaignId: campaign._id,
            relativePath: entry.relativePath,
          },
          update: {
            $setOnInsert: {
              _id: deterministicObjectId([
                "media-folder-item-v1",
                campaign._id,
                entry.relativePath,
              ]),
              campaignId: campaign._id,
              owner: campaign.owner,
              relativePath: entry.relativePath,
              state: entry.state,
              ...(entry.state === "unsupported"
                ? { safeError: "Unsupported file type" }
                : {}),
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          },
          upsert: true,
        },
      })),
      { ordered: false },
    );
  }
  const scanStartedAt = campaign.scanStartedAt ?? new Date();
  await db.collection("media_folder_campaigns").updateOne(
    { _id: campaign._id, inventoryInitialized: { $ne: true } },
    {
      $set: {
        inventoryInitialized: true,
        inventoryTruncated: false,
        status: "scanning",
        scanStartedAt,
        lastProgressAt: scanStartedAt,
        updatedAt: scanStartedAt,
      },
    },
  );
  campaign.scanStartedAt = scanStartedAt;
  campaign.lastProgressAt = scanStartedAt;
}

async function inspectFolderChunk(
  db: Db,
  campaign: any,
  config: MediaKnowledgeConfig,
): Promise<number> {
  const items = db.collection<any>("media_folder_items");
  const staleBefore = new Date(Date.now() - FOLDER_STALE_ITEM_MS);
  await items.updateMany(
    {
      campaignId: campaign._id,
      state: "inspecting",
      claimedAt: { $lt: staleBefore },
    },
    {
      $set: { state: "pending", updatedAt: new Date() },
      $unset: { claimedAt: "" },
    },
  );
  let processed = 0;
  for (let index = 0; index < FOLDER_CHUNK_SIZE; index += 1) {
    const item = await items.findOneAndUpdate(
      { campaignId: campaign._id, state: "pending" },
      {
        $set: {
          state: "inspecting",
          claimedAt: new Date(),
          updatedAt: new Date(),
        },
      },
      { sort: { relativePath: 1 }, returnDocument: "after" },
    );
    if (!item) break;
    processed += 1;
    try {
      const inspected = await inspectLocalMedia(
        item.relativePath,
        config.limits,
      );
      if (inspected.kind !== "image") {
        await items.updateOne(
          { _id: item._id, state: "inspecting" },
          {
            $set: {
              state: "unsupported",
              safeError:
                "Folder photo campaigns import images only; PDF was skipped",
              updatedAt: new Date(),
            },
            $unset: { claimedAt: "" },
          },
        );
        continue;
      }
      const duplicate = await db.collection("media_assets").findOne({
        owner: campaign.owner,
        sha256: inspected.sha256,
      }, { projection: { _id: 1, status: 1 } });
      await items.updateOne(
        { _id: item._id, state: "inspecting" },
        {
          $set: {
            state: duplicate ? "duplicate" : "ready",
            fileName: inspected.fileName,
            kind: inspected.kind,
            mimeType: inspected.mimeType,
            byteLength: inspected.byteLength,
            sha256: inspected.sha256,
            width: inspected.width,
            height: inspected.height,
            capturedAt: inspected.capturedAt,
            capturedAtTimeZone: inspected.capturedAtTimeZone,
            capturedAtTimeZoneSource: inspected.capturedAtTimeZoneSource,
            location: inspected.location,
            metadata: inspected.metadata,
            duplicateAssetId: duplicate?._id,
            updatedAt: new Date(),
          },
          $unset: { claimedAt: "", safeError: "" },
        },
      );
    } catch (error) {
      const message = safeError(error);
      await items.updateOne(
        { _id: item._id, state: "inspecting" },
        {
          $set: {
            state: /unsupported/i.test(message) ? "unsupported" : "failed",
            safeError: message,
            updatedAt: new Date(),
          },
          $unset: { claimedAt: "" },
        },
      );
    }
  }
  return processed;
}

async function materializeFolderItem(
  db: Db,
  campaign: any,
  item: any,
  config: MediaKnowledgeConfig,
) {
  let thumbnailId: ObjectId | undefined;
  let previewId: ObjectId | undefined;
  try {
    const inspected = await inspectLocalMedia(item.relativePath, config.limits);
    if (inspected.sha256 !== item.sha256) {
      await db.collection("media_folder_items").updateOne(
        { _id: item._id, state: "importing" },
        {
          $set: {
            state: "changed",
            safeError:
              "Original changed after the folder inventory was reviewed",
            updatedAt: new Date(),
          },
          $unset: { claimedAt: "" },
        },
      );
      return;
    }
    const duplicate = await db.collection("media_assets").findOne({
      owner: campaign.owner,
      sha256: item.sha256,
    }, { projection: { _id: 1 } });
    if (duplicate) {
      await db.collection("media_folder_items").updateOne(
        { _id: item._id },
        {
          $set: {
            state: "duplicate",
            duplicateAssetId: duplicate._id,
            updatedAt: new Date(),
          },
          $unset: { claimedAt: "" },
        },
      );
      return;
    }

    const resolved = await resolveMediaSourcePath(item.relativePath);
    const [thumbnail, preview] = await Promise.all([
      createWebpPreview(resolved.realPath, 256, 70),
      createWebpPreview(resolved.realPath, 1280, 80),
    ]);
    const assetId = new ObjectId();
    const now = new Date();
    thumbnailId = await uploadGridFs(
      db,
      `${assetId}/thumbnail_256.webp`,
      thumbnail.data,
      {
        state: "canonical",
        owner: campaign.owner,
        assetId,
        role: "thumbnail",
        confirmedAt: now,
      },
    );
    previewId = await uploadGridFs(
      db,
      `${assetId}/preview_1280.webp`,
      preview.data,
      {
        state: "canonical",
        owner: campaign.owner,
        assetId,
        role: "preview",
        confirmedAt: now,
      },
    );
    const temporalSpatial = mediaImportTemporalSpatialFields(inspected);
    const asset = {
      _id: assetId,
      owner: campaign.owner,
      kind: "image",
      storageMode: "external_reference",
      fileName: inspected.fileName,
      mimeType: inspected.mimeType,
      byteLength: inspected.byteLength,
      sha256: inspected.sha256,
      source: { sourceRootId: "default", relativePath: inspected.relativePath },
      width: inspected.width,
      height: inspected.height,
      thumbnail: {
        bucket: "media_previews",
        fileId: thumbnailId,
        mimeType: "image/webp",
        width: thumbnail.width,
        height: thumbnail.height,
        byteLength: thumbnail.data.byteLength,
      },
      preview: {
        bucket: "media_previews",
        fileId: previewId,
        mimeType: "image/webp",
        width: preview.width,
        height: preview.height,
        byteLength: preview.data.byteLength,
      },
      metadata: inspected.metadata,
      createdByFolderCampaignId: campaign._id,
      ...temporalSpatial,
      placementRevision: 0,
      status: "staged",
      importFinalizedAt: now,
      createdAt: now,
      updatedAt: now,
    };
    try {
      await db.collection("media_assets").insertOne(asset);
    } catch (error) {
      if ((error as { code?: number })?.code !== 11000) throw error;
      await Promise.all([
        deletePreview(db, thumbnailId),
        deletePreview(db, previewId),
      ]);
      thumbnailId = undefined;
      previewId = undefined;
      const raced = await db.collection("media_assets").findOne({
        owner: campaign.owner,
        sha256: item.sha256,
      }, { projection: { _id: 1 } });
      await db.collection("media_folder_items").updateOne(
        { _id: item._id },
        {
          $set: {
            state: "duplicate",
            duplicateAssetId: raced?._id,
            updatedAt: new Date(),
          },
          $unset: { claimedAt: "" },
        },
      );
      return;
    }
    await db.collection("media_metadata_versions").updateOne(
      { _id: assetId },
      {
        $setOnInsert: {
          assetId,
          version: 1,
          extractor: "ffprobe/exiftool",
          metadata: inspected.metadata,
          createdAt: now,
        },
      },
      { upsert: true },
    );
    await db.collection("media_folder_items").updateOne(
      { _id: item._id, state: "importing" },
      {
        $set: { state: "imported", assetId, updatedAt: new Date() },
        $unset: { claimedAt: "", safeError: "" },
      },
    );
  } catch (error) {
    await Promise.all([
      deletePreview(db, thumbnailId),
      deletePreview(db, previewId),
    ]);
    await db.collection("media_folder_items").updateOne(
      { _id: item._id, state: "importing" },
      {
        $set: {
          state: "failed",
          safeError: safeError(error),
          updatedAt: new Date(),
        },
        $unset: { claimedAt: "" },
      },
    );
  }
}

async function folderWorkerResult(
  db: Db,
  campaignId: ObjectId,
  processed: number,
  hasMore: boolean,
) {
  const campaign = await db.collection<any>("media_folder_campaigns").findOne({
    _id: campaignId,
  });
  if (!campaign) {
    return { success: true, idle: true, processed: 0, hasMore: false };
  }
  const publicCampaign = await publicFolderCampaign(db, campaign);
  return {
    success: true,
    campaignId: String(campaignId),
    processed,
    hasMore,
    progress: {
      ...publicCampaign.progress,
      campaignId: String(campaignId),
      relativePath: campaign.relativePath,
      unsupported: publicCampaign.counts.unsupported ?? 0,
      ready: publicCampaign.counts.ready ?? 0,
      imported: publicCampaign.counts.imported ?? 0,
      failed: publicCampaign.counts.failed ?? 0,
    },
  };
}

async function processFolderCampaign(
  db: Db,
  requestedCampaignId?: ObjectId,
): Promise<Record<string, unknown>> {
  const campaigns = db.collection<any>("media_folder_campaigns");
  const campaign = requestedCampaignId
    ? await campaigns.findOne({
      _id: requestedCampaignId,
      status: { $in: ["queued", "scanning", "importing"] },
    })
    : await campaigns.findOne({
      status: { $in: ["queued", "scanning", "importing"] },
    }, { sort: { updatedAt: 1 } });
  if (!campaign) return { success: true, idle: true };
  const config = await loadConfig();
  try {
    if (!campaign.inventoryInitialized) {
      await initializeFolderInventory(db, campaign);
      campaign.inventoryInitialized = true;
      campaign.status = "scanning";
    }
    if (campaign.status === "queued" || campaign.status === "scanning") {
      const processed = await inspectFolderChunk(db, campaign, config);
      const lastProgressAt = new Date();
      const remaining = await db.collection("media_folder_items")
        .countDocuments({
          campaignId: campaign._id,
          state: { $in: ["pending", "inspecting"] },
        });
      if (remaining === 0) {
        const counts = publicFolderCounts(
          await stateCounts(
            db,
            "media_folder_items",
            "campaignId",
            campaign._id,
          ),
        );
        await campaigns.updateOne(
          { _id: campaign._id, status: { $in: ["queued", "scanning"] } },
          {
            $set: {
              status: "preview_ready",
              counts,
              inventoryCompletedAt: new Date(),
              lastProgressAt,
              updatedAt: lastProgressAt,
            },
          },
        );
      } else if (processed > 0) {
        await campaigns.updateOne(
          { _id: campaign._id, status: "scanning" },
          { $set: { lastProgressAt, updatedAt: lastProgressAt } },
        );
      }
      return await folderWorkerResult(
        db,
        campaign._id,
        processed,
        remaining > 0,
      );
    }

    const items = db.collection<any>("media_folder_items");
    const staleBefore = new Date(Date.now() - FOLDER_STALE_ITEM_MS);
    await items.updateMany(
      {
        campaignId: campaign._id,
        state: "importing",
        claimedAt: { $lt: staleBefore },
      },
      {
        $set: { state: "ready", updatedAt: new Date() },
        $unset: { claimedAt: "" },
      },
    );
    let processed = 0;
    for (let index = 0; index < FOLDER_CHUNK_SIZE; index += 1) {
      const item = await items.findOneAndUpdate(
        { campaignId: campaign._id, state: "ready" },
        {
          $set: {
            state: "importing",
            claimedAt: new Date(),
            updatedAt: new Date(),
          },
        },
        { sort: { relativePath: 1 }, returnDocument: "after" },
      );
      if (!item) break;
      processed += 1;
      await materializeFolderItem(db, campaign, item, config);
    }
    const remaining = await items.countDocuments({
      campaignId: campaign._id,
      state: { $in: ["ready", "importing"] },
    });
    const lastProgressAt = new Date();
    if (remaining === 0) {
      const rawCounts = await stateCounts(
        db,
        "media_folder_items",
        "campaignId",
        campaign._id,
      );
      const counts = publicFolderCounts(rawCounts);
      const hasErrors = counts.failed > 0 || counts.changed > 0 ||
        counts.unsupported > 0;
      await campaigns.updateOne(
        { _id: campaign._id, status: "importing" },
        {
          $set: {
            status: hasErrors ? "completed_with_errors" : "completed",
            counts,
            completedAt: new Date(),
            lastProgressAt,
            updatedAt: lastProgressAt,
          },
        },
      );
    } else if (processed > 0) {
      await campaigns.updateOne(
        { _id: campaign._id, status: "importing" },
        { $set: { lastProgressAt, updatedAt: lastProgressAt } },
      );
    }
    return await folderWorkerResult(
      db,
      campaign._id,
      processed,
      remaining > 0,
    );
  } catch (error) {
    await campaigns.updateOne(
      { _id: campaign._id },
      {
        $set: {
          status: "failed",
          safeError: safeError(error),
          updatedAt: new Date(),
        },
      },
    );
    throw error;
  }
}

export function recognitionEligibilityQuery(owner: string) {
  return {
    owner,
    kind: "image",
    status: {
      $in: ["staged", "failed", "budget_blocked", "recognition_disabled"],
    },
    $or: [
      {
        storageMode: "managed_original",
        "managedOriginal.fileId": { $exists: true },
      },
      {
        storageMode: "external_reference",
        "source.relativePath": { $type: "string" },
      },
    ],
  };
}

async function reconcileRecognitionBatch(db: Db, batch: any): Promise<any> {
  const items = db.collection<any>("media_recognition_batch_items");
  const activeItems = await items.find({
    batchId: batch._id,
    state: { $in: ["queued", "processing"] },
  }).limit(2_000).toArray();
  if (activeItems.length > 0) {
    const jobIds = activeItems.flatMap((item) =>
      item.jobId && ObjectId.isValid(item.jobId)
        ? [new ObjectId(item.jobId)]
        : []
    );
    const assetIds = activeItems.map((item) => item.assetId);
    const [jobs, assets] = await Promise.all([
      jobIds.length
        ? db.collection("jobs").find(
          { _id: { $in: jobIds } },
          { projection: { state: 1, failedReason: 1 } },
        ).toArray()
        : [],
      db.collection("media_assets").find(
        { _id: { $in: assetIds }, owner: batch.owner },
        { projection: { status: 1, currentRunId: 1, safeError: 1 } },
      ).toArray(),
    ]);
    const byJob = new Map(jobs.map((job) => [String(job._id), job]));
    const byAsset = new Map(assets.map((asset) => [String(asset._id), asset]));
    const writes: any[] = [];
    for (const item of activeItems) {
      const job = byJob.get(String(item.jobId));
      const asset = byAsset.get(String(item.assetId));
      let state = item.state;
      let error: string | undefined;
      if (asset?.status === "ready" && asset.currentRunId) state = "ready";
      else if (asset?.status === "budget_blocked") {
        state = "budget_blocked";
        error = asset.safeError;
      } else if (
        ["failed", "source_missing", "source_changed"].includes(asset?.status)
      ) {
        state = "failed";
        error = asset?.safeError;
      } else if (job?.state === "active") state = "processing";
      else if (["waiting", "delayed"].includes(job?.state)) state = "queued";
      else if (["failed", "cancelled"].includes(job?.state)) {
        state = "failed";
        error = safeError(job?.failedReason ?? "Recognition job failed");
      } else if (job?.state === "completed") {
        state = asset?.status === "ready" ? "ready" : "failed";
        error = state === "failed"
          ? safeError(
            asset?.safeError ?? "Recognition completed without a ready asset",
          )
          : undefined;
      }
      if (state !== item.state || error) {
        writes.push({
          updateOne: {
            filter: { _id: item._id, state: item.state },
            update: {
              $set: {
                state,
                updatedAt: new Date(),
                ...(error ? { safeError: error } : {}),
              },
              ...(error ? {} : { $unset: { safeError: "" } }),
            },
          },
        });
      }
    }
    if (writes.length > 0) await items.bulkWrite(writes, { ordered: false });
  }

  const rawCounts = await stateCounts(
    db,
    "media_recognition_batch_items",
    "batchId",
    batch._id,
  );
  const counts = publicRecognitionCounts(rawCounts);
  const open = counts.pending + counts.queued + counts.processing;
  let status = batch.status;
  if (batch.cancelRequestedAt) {
    status = open > 0 ? "running" : "cancelled";
  } else if (open === 0) {
    status = counts.failed > 0 ? "completed_with_errors" : "completed";
  } else if (counts.queued + counts.processing > 0) status = "running";
  const terminal = ["completed", "completed_with_errors", "cancelled"].includes(
    status,
  );
  await db.collection("media_recognition_batches").updateOne(
    { _id: batch._id },
    {
      $set: {
        status,
        counts,
        updatedAt: new Date(),
        ...(terminal ? { completedAt: batch.completedAt ?? new Date() } : {}),
      },
    },
  );
  return {
    ...batch,
    status,
    counts,
    ...(terminal ? { completedAt: batch.completedAt ?? new Date() } : {}),
  };
}

async function originalAvailable(db: Db, asset: any): Promise<boolean> {
  if (
    asset.storageMode === "managed_original" && asset.managedOriginal?.fileId
  ) {
    return Boolean(
      await db.collection("media_originals.files").findOne({
        _id: asset.managedOriginal.fileId,
        "metadata.owner": asset.owner,
      }, { projection: { _id: 1 } }),
    );
  }
  if (
    asset.storageMode === "external_reference" &&
    typeof asset.source?.relativePath === "string"
  ) {
    try {
      await resolveMediaSourcePath(asset.source.relativePath);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

export function selectionDigest(
  owner: string,
  cutoff: Date,
  profile: MediaRecognitionProfile,
  tasks: MediaRecognitionTask[],
  assets: Array<{ _id: ObjectId; sha256: string }>,
): string {
  return stableHash([
    "media-recognition-batch-selection-v1",
    owner,
    cutoff.toISOString(),
    JSON.stringify(profile),
    [...tasks].sort().join(","),
    ...assets.map((asset) => `${asset._id}:${asset.sha256}`),
  ]);
}

async function prepareRecognitionBatch(
  db: Db,
  auth: AuthType,
  input: z.infer<typeof previewRecognitionBatchSchema>,
): Promise<Record<string, unknown>> {
  const config = await loadConfig();
  const profile = selectProfile(config, input.profileId);
  const requestedTasks = [
    ...new Set(input.requestedTasks),
  ] as MediaRecognitionTask[];
  assertRecognitionTasks(profile, requestedTasks);
  const perAssetGrossUsd = estimateMediaGrossUsd(
    "image",
    1,
    requestedTasks,
    profile,
  );
  assertMediaPerImportBudget(config, perAssetGrossUsd);
  const cutoff = new Date();
  const candidates = await db.collection<any>("media_assets").find({
    ...recognitionEligibilityQuery(auth.principal),
    createdAt: { $lte: cutoff },
  }, {
    projection: {
      _id: 1,
      owner: 1,
      sha256: 1,
      storageMode: 1,
      managedOriginal: 1,
      source: 1,
    },
  }).sort({ createdAt: 1, _id: 1 }).limit(MAX_FOLDER_FILES).toArray();

  const eligible: Array<{ _id: ObjectId; sha256: string }> = [];
  const missingIds: ObjectId[] = [];
  for (const asset of candidates) {
    if (await originalAvailable(db, asset)) {
      eligible.push({ _id: asset._id, sha256: asset.sha256 });
    } else {
      missingIds.push(asset._id);
    }
  }
  if (missingIds.length > 0) {
    await db.collection("media_assets").updateMany(
      {
        _id: { $in: missingIds },
        owner: auth.principal,
        status: {
          $in: ["staged", "failed", "budget_blocked", "recognition_disabled"],
        },
      },
      {
        $set: {
          status: "source_missing",
          safeError:
            "The original photo is not available at its mounted reference",
          updatedAt: new Date(),
        },
      },
    );
  }
  const skippedRows = await db.collection("media_assets").aggregate([
    {
      $match: {
        owner: auth.principal,
        kind: "image",
        createdAt: { $lte: cutoff },
      },
    },
    { $group: { _id: "$status", count: { $sum: 1 } } },
  ]).toArray();
  const skippedByStatus = Object.fromEntries(
    skippedRows.map((row) => [String(row._id), Number(row.count)]),
  );
  const digest = selectionDigest(
    auth.principal,
    cutoff,
    profile,
    requestedTasks,
    eligible,
  );
  const previewId = new ObjectId();
  const now = new Date();
  const authorizedGrossUsd = Number(
    (perAssetGrossUsd * eligible.length).toFixed(6),
  );
  await db.collection("media_recognition_batch_previews").insertOne({
    _id: previewId,
    owner: auth.principal,
    cutoff,
    profileSnapshot: profile,
    requestedTasks,
    assetRefs: eligible.map((asset) => ({
      assetId: asset._id,
      sha256: asset.sha256,
    })),
    selectionDigest: digest,
    perAssetGrossUsd,
    authorizedGrossUsd,
    missingOriginalCount: missingIds.length,
    skippedByStatus,
    createdAt: now,
    expiresAt: new Date(now.getTime() + PREVIEW_TTL_MS),
  });
  return {
    previewId,
    cutoff,
    profile: {
      id: profile.id,
      name: profile.name,
      providerType: profile.providerType,
    },
    requestedTasks,
    eligibleCount: eligible.length,
    missingOriginalCount: missingIds.length,
    skippedByStatus,
    perAssetGrossUsd,
    authorizedGrossUsd,
    selectionDigest: digest,
    expiresAt: new Date(now.getTime() + PREVIEW_TTL_MS),
  };
}

async function ensureRecognitionBatchItems(
  db: Db,
  batchId: ObjectId,
  owner: string,
  assetRefs: Array<{ assetId: ObjectId; sha256: string }>,
  now: Date,
): Promise<void> {
  const items = db.collection("media_recognition_batch_items");
  for (let index = 0; index < assetRefs.length; index += 500) {
    const page = assetRefs.slice(index, index + 500);
    await items.bulkWrite(
      page.map((entry) => ({
        updateOne: {
          filter: { batchId, assetId: entry.assetId },
          update: {
            $setOnInsert: {
              _id: deterministicObjectId([
                "media-recognition-batch-item-v1",
                batchId,
                entry.assetId,
              ]),
              batchId,
              owner,
              assetId: entry.assetId,
              sha256: entry.sha256,
              state: "pending",
              retryGeneration: 0,
              createdAt: now,
              updatedAt: now,
            },
          },
          upsert: true,
        },
      })),
      { ordered: false },
    );
  }
}

async function confirmRecognitionBatch(
  db: Db,
  auth: AuthType,
  input: z.infer<typeof confirmRecognitionBatchSchema>,
): Promise<Record<string, unknown>> {
  const previewId = new ObjectId(input.previewId);
  const preview = await db.collection<any>("media_recognition_batch_previews")
    .findOne({
      _id: previewId,
      owner: auth.principal,
      expiresAt: { $gt: new Date() },
    });
  if (!preview) {
    throw new Error("Recognition batch preview expired or was not found");
  }
  const existing = await db.collection<any>("media_recognition_batches")
    .findOne({ previewId, owner: auth.principal });
  if (existing) {
    await ensureRecognitionBatchItems(
      db,
      existing._id,
      auth.principal,
      preview.assetRefs,
      existing.createdAt ?? new Date(),
    );
    if (["queued", "running"].includes(existing.status)) {
      try {
        await enqueueRecognitionWorker(existing._id, auth);
      } catch {
        // The periodic coordinator is the durable recovery path.
      }
    }
    return {
      batch: await reconcileRecognitionBatch(db, existing),
      reused: true,
    };
  }
  const config = await loadConfig();
  const profile = selectProfile(config, preview.profileSnapshot.id);
  if (JSON.stringify(profile) !== JSON.stringify(preview.profileSnapshot)) {
    throw new Error(
      "The Google Cloud profile changed; build a new batch preview",
    );
  }
  const requestedTasks = preview.requestedTasks as MediaRecognitionTask[];
  assertRecognitionTasks(profile, requestedTasks);
  const assetIds = preview.assetRefs.map((entry: any) => entry.assetId);
  const currentAssets = await db.collection<any>("media_assets").find({
    _id: { $in: assetIds },
    ...recognitionEligibilityQuery(auth.principal),
  }, { projection: { _id: 1, sha256: 1 } }).sort({ createdAt: 1, _id: 1 })
    .toArray();
  const shaById = new Map(
    currentAssets.map((asset) => [String(asset._id), String(asset.sha256)]),
  );
  const exactRefs = preview.assetRefs.filter((entry: any) =>
    shaById.get(String(entry.assetId)) === entry.sha256
  );
  const exactAssets = exactRefs.map((entry: any) => ({
    _id: entry.assetId as ObjectId,
    sha256: String(entry.sha256),
  }));
  const digest = selectionDigest(
    auth.principal,
    preview.cutoff,
    profile,
    requestedTasks,
    exactAssets,
  );
  if (
    digest !== preview.selectionDigest ||
    exactRefs.length !== preview.assetRefs.length
  ) {
    throw new Error("The exact batch selection changed; build a new preview");
  }
  const now = new Date();
  const batchId = deterministicObjectId([
    "media-recognition-batch-v1",
    auth.principal,
    preview.selectionDigest,
  ]);
  const receipt = {
    id: randomUUID(),
    principal: auth.principal,
    previewId,
    cutoff: preview.cutoff,
    selectionDigest: preview.selectionDigest,
    assetCount: exactRefs.length,
    profileFingerprint: stableHash([JSON.stringify(profile)]),
    requestedTasks,
    authorizedGrossUsd: preview.authorizedGrossUsd,
    confirmedAt: now,
  };
  try {
    await db.collection("media_recognition_batches").insertOne({
      _id: batchId,
      previewId,
      owner: auth.principal,
      status: "queued",
      cutoff: preview.cutoff,
      profileId: profile.id,
      profileName: profile.name,
      profileSnapshot: profile,
      requestedTasks,
      selectionDigest: preview.selectionDigest,
      perAssetGrossUsd: preview.perAssetGrossUsd,
      authorizedGrossUsd: preview.authorizedGrossUsd,
      consentReceipt: receipt,
      counts: { total: exactRefs.length, pending: exactRefs.length },
      createdAt: now,
      updatedAt: now,
    });
  } catch (error) {
    if ((error as { code?: number })?.code !== 11000) throw error;
  }
  await ensureRecognitionBatchItems(
    db,
    batchId,
    auth.principal,
    exactRefs,
    now,
  );
  const batch = await db.collection<any>("media_recognition_batches").findOne({
    _id: batchId,
    owner: auth.principal,
  });
  if (!batch) throw new Error("Recognition batch could not be created");
  let coordinatorJobId: string | undefined;
  if (exactRefs.length > 0) {
    try {
      coordinatorJobId = await enqueueRecognitionWorker(batchId, auth);
      await db.collection("media_recognition_batches").updateOne(
        { _id: batchId },
        {
          $set: {
            coordinatorJobId: new ObjectId(coordinatorJobId),
            updatedAt: new Date(),
          },
        },
      );
    } catch (error) {
      await db.collection("media_recognition_batches").updateOne(
        { _id: batchId },
        {
          $set: {
            safeError: `Coordinator will resume automatically: ${
              safeError(error)
            }`,
          },
        },
      );
    }
  } else {
    await db.collection("media_recognition_batches").updateOne(
      { _id: batchId },
      {
        $set: {
          status: "completed",
          completedAt: new Date(),
          updatedAt: new Date(),
        },
      },
    );
  }
  return {
    batch: await reconcileRecognitionBatch(db, { ...batch, coordinatorJobId }),
    reused: false,
  };
}

async function processRecognitionBatch(
  db: Db,
  requestedBatchId?: ObjectId,
): Promise<Record<string, unknown>> {
  const batches = db.collection<any>("media_recognition_batches");
  let batch = requestedBatchId
    ? await batches.findOne({
      _id: requestedBatchId,
      status: { $in: ["queued", "running"] },
    })
    : await batches.findOne(
      { status: { $in: ["queued", "running"] } },
      { sort: { updatedAt: 1 } },
    );
  if (!batch) {
    return { success: true, idle: true, processed: 0, hasMore: false };
  }
  batch = await reconcileRecognitionBatch(db, batch);
  if (
    ["completed", "completed_with_errors", "cancelled"].includes(batch.status)
  ) {
    return {
      success: true,
      batchId: String(batch._id),
      processed: 0,
      hasMore: false,
    };
  }
  await recoverStaleRecognitionClaims(db, batch);
  const items = db.collection<any>("media_recognition_batch_items");
  if (batch.cancelRequestedAt) {
    const result = await items.updateMany(
      { batchId: batch._id, state: "pending" },
      { $set: { state: "cancelled", updatedAt: new Date() } },
    );
    await reconcileRecognitionBatch(db, batch);
    return {
      success: true,
      batchId: String(batch._id),
      processed: result.modifiedCount,
      hasMore: false,
    };
  }
  const active = await items.countDocuments({
    batchId: batch._id,
    state: { $in: ["queued", "processing"] },
  });
  const available = Math.max(0, RECOGNITION_WINDOW - active);
  let processed = 0;
  for (let index = 0; index < available; index += 1) {
    const item = await items.findOneAndUpdate(
      { batchId: batch._id, state: "pending" },
      {
        $set: {
          state: "claiming",
          claimedAt: new Date(),
          updatedAt: new Date(),
        },
      },
      { sort: { _id: 1 }, returnDocument: "after" },
    );
    if (!item) break;
    processed += 1;
    const cancellation = await batches.findOne(
      { _id: batch._id },
      { projection: { cancelRequestedAt: 1 } },
    );
    if (cancellation?.cancelRequestedAt) {
      await items.updateOne(
        { _id: item._id, state: "claiming" },
        {
          $set: { state: "cancelled", updatedAt: new Date() },
          $unset: { claimedAt: "", jobId: "", safeError: "" },
        },
      );
      break;
    }
    const asset = await db.collection<any>("media_assets").findOne({
      _id: item.assetId,
      ...recognitionEligibilityQuery(batch.owner),
      sha256: item.sha256,
    });
    if (!asset) {
      const current = await db.collection<any>("media_assets").findOne({
        _id: item.assetId,
        owner: batch.owner,
      }, { projection: { status: 1, sha256: 1 } });
      const state = current?.status === "ready" ? "skipped" : "failed";
      await items.updateOne(
        { _id: item._id, state: "claiming" },
        {
          $set: {
            state,
            safeError: state === "failed"
              ? "Asset or original changed after batch confirmation"
              : "Asset was already processed",
            updatedAt: new Date(),
          },
          $unset: { claimedAt: "" },
        },
      );
      continue;
    }
    const jobId = deterministicObjectId([
      "media-recognition-batch-job-v1",
      batch._id,
      item.assetId,
      item.retryGeneration ?? 0,
    ]);
    const consentReceiptId = `${batch.consentReceipt.id}:${item.assetId}`;
    await items.updateOne(
      { _id: item._id, state: "claiming" },
      { $set: { jobId, consentReceiptId, updatedAt: new Date() } },
    );
    const assetClaim = await db.collection("media_assets").updateOne(
      { _id: item.assetId, owner: batch.owner, status: asset.status },
      {
        $set: { status: "queued", updatedAt: new Date() },
        $unset: { safeError: "" },
      },
    );
    if (assetClaim.modifiedCount !== 1) {
      await items.updateOne(
        { _id: item._id, state: "claiming" },
        {
          $set: {
            state: "skipped",
            safeError: "Asset status changed before it could be queued",
            updatedAt: new Date(),
          },
          $unset: { claimedAt: "" },
        },
      );
      continue;
    }
    const queuedJobId = await enqueueConfirmedAsset(
      db,
      item.assetId,
      batch.profileSnapshot,
      batch.requestedTasks,
      consentReceiptId,
      ownerAuth(batch.owner),
      undefined,
      String(jobId),
      true,
    );
    await items.updateOne(
      { _id: item._id, state: "claiming" },
      queuedJobId
        ? {
          $set: { state: "queued", jobId, updatedAt: new Date() },
          $unset: { claimedAt: "", safeError: "" },
        }
        : {
          $set: {
            state: "failed",
            safeError: "Recognition job could not be queued",
            updatedAt: new Date(),
          },
          $unset: { claimedAt: "" },
        },
    );
  }
  batch = await reconcileRecognitionBatch(db, batch);
  const hasMore = batch.counts.pending > 0 || batch.counts.queued > 0 ||
    batch.counts.processing > 0;
  return {
    success: true,
    batchId: String(batch._id),
    processed,
    hasMore,
    counts: batch.counts,
  };
}

async function startFolderCampaign(
  db: Db,
  auth: AuthType,
  relativePath: string,
): Promise<Record<string, unknown>> {
  if (!mediaSourceConfigured()) {
    throw new Error("Mounted media source is not configured");
  }
  const resolved = await resolveMediaSourcePath(relativePath);
  const canonicalRelativePath = resolved.relativePath;
  const campaigns = db.collection<any>("media_folder_campaigns");
  const existing = await campaigns.findOne({
    owner: auth.principal,
    relativePath: canonicalRelativePath,
    status: { $in: ["queued", "scanning", "preview_ready", "importing"] },
  }, { sort: { createdAt: -1 } });
  if (existing) {
    return { campaign: await publicFolderCampaign(db, existing), reused: true };
  }
  const now = new Date();
  const campaign = {
    _id: new ObjectId(),
    owner: auth.principal,
    relativePath: canonicalRelativePath,
    status: "queued",
    counts: {},
    createdAt: now,
    updatedAt: now,
  };
  await campaigns.insertOne(campaign);
  try {
    const jobId = await enqueueFolderWorker(campaign._id, auth);
    await campaigns.updateOne(
      { _id: campaign._id },
      {
        $set: { coordinatorJobId: new ObjectId(jobId), updatedAt: new Date() },
      },
    );
  } catch (error) {
    await campaigns.updateOne(
      { _id: campaign._id },
      {
        $set: {
          safeError: `Scan will resume automatically: ${safeError(error)}`,
        },
      },
    );
  }
  return { campaign: await publicFolderCampaign(db, campaign), reused: false };
}

async function confirmFolderCampaign(
  db: Db,
  auth: AuthType,
  campaignId: ObjectId,
): Promise<Record<string, unknown>> {
  const campaigns = db.collection<any>("media_folder_campaigns");
  const campaign = await campaigns.findOne({
    _id: campaignId,
    owner: auth.principal,
  });
  if (!campaign) throw new Error("Folder campaign was not found");
  if (["completed", "completed_with_errors"].includes(campaign.status)) {
    return { campaign: await publicFolderCampaign(db, campaign), reused: true };
  }
  if (campaign.status !== "preview_ready" && campaign.status !== "importing") {
    throw new Error("Wait for the local folder scan before confirming import");
  }
  const now = new Date();
  const receipt = campaign.confirmationReceipt ?? {
    id: randomUUID(),
    principal: auth.principal,
    relativePath: campaign.relativePath,
    counts: publicFolderCounts(
      await stateCounts(db, "media_folder_items", "campaignId", campaign._id),
    ),
    confirmedAt: now,
  };
  await campaigns.updateOne(
    {
      _id: campaign._id,
      owner: auth.principal,
      status: { $in: ["preview_ready", "importing"] },
    },
    {
      $set: {
        status: "importing",
        confirmationReceipt: receipt,
        importStartedAt: campaign.importStartedAt ?? now,
        lastProgressAt: now,
        updatedAt: now,
      },
      $unset: { safeError: "" },
    },
  );
  try {
    const jobId = await enqueueFolderWorker(campaign._id, auth);
    await campaigns.updateOne(
      { _id: campaign._id },
      {
        $set: { coordinatorJobId: new ObjectId(jobId), updatedAt: new Date() },
      },
    );
  } catch (error) {
    await campaigns.updateOne(
      { _id: campaign._id },
      {
        $set: {
          safeError: `Import will resume automatically: ${safeError(error)}`,
        },
      },
    );
  }
  const updated = await campaigns.findOne({ _id: campaign._id });
  return {
    campaign: await publicFolderCampaign(db, updated),
    reused: campaign.status === "importing",
  };
}

async function visualCaptionsForAssets(db: Db, assets: any[]) {
  const runFilters = assets.flatMap((asset) =>
    asset.currentRunId
      ? [{ assetId: asset._id, runId: asset.currentRunId }]
      : []
  );
  if (runFilters.length === 0) return new Map<string, string>();
  const visual = await db.collection<any>("media_visual_descriptions").find({
    active: true,
    $or: runFilters,
  }, { projection: { assetId: 1, "visualUnderstanding.shortCaption": 1 } })
    .toArray();
  return new Map(
    visual.flatMap((entry) => {
      const caption = entry.visualUnderstanding?.shortCaption;
      return typeof caption === "string"
        ? [[String(entry.assetId), caption] as const]
        : [];
    }),
  );
}

export function timelineResolution(
  start: Date,
  end: Date,
): "hour" | "day" | "month" {
  const days = Math.max(1, (end.getTime() - start.getTime()) / 86_400_000);
  return days <= 14 ? "hour" : days <= 730 ? "day" : "month";
}

async function timelineProjection(
  db: Db,
  owner: string,
  start: Date,
  end: Date,
  detailLimit: number,
): Promise<Record<string, unknown>> {
  const base = {
    owner,
    kind: "image",
    capturedAt: { $gte: start, $lt: end },
  };
  const [total, unplacedTimeCount] = await Promise.all([
    db.collection("media_assets").countDocuments(base),
    db.collection("media_assets").countDocuments({
      owner,
      kind: "image",
      $nor: [{ capturedAt: { $type: "date" } }],
    }),
  ]);
  if (total <= detailLimit) {
    const assets = await db.collection<any>("media_assets").find(base, {
      projection: {
        _id: 1,
        fileName: 1,
        status: 1,
        capturedAt: 1,
        location: 1,
        thumbnail: 1,
        currentRunId: 1,
      },
    }).sort({ capturedAt: 1, _id: 1 }).toArray();
    const captions = await visualCaptionsForAssets(db, assets);
    return {
      mode: "items",
      total,
      unplacedTimeCount,
      items: assets.map((asset) => ({
        assetId: asset._id,
        capturedAt: asset.capturedAt,
        fileName: asset.fileName,
        status: asset.status,
        thumbnailUrl: thumbnailUrl(asset),
        shortCaption: captions.get(String(asset._id)),
        location: asset.location,
      })),
    };
  }
  const resolution = timelineResolution(start, end);
  const buckets = await db.collection("media_assets").aggregate([
    { $match: base },
    {
      $group: {
        _id: {
          start: {
            $dateTrunc: {
              date: "$capturedAt",
              unit: resolution,
              timezone: "UTC",
            },
          },
          status: "$status",
        },
        count: { $sum: 1 },
      },
    },
    {
      $group: {
        _id: "$_id.start",
        count: { $sum: "$count" },
        statuses: { $push: { status: "$_id.status", count: "$count" } },
      },
    },
    { $sort: { _id: 1 } },
  ]).toArray();
  return {
    mode: "density",
    total,
    unplacedTimeCount,
    resolution,
    buckets: buckets.map((bucket) => ({
      start: bucket._id,
      count: bucket.count,
      statuses: Object.fromEntries(
        bucket.statuses.map((entry: any) => [entry.status, entry.count]),
      ),
    })),
  };
}

export function geoBoundsQuery(bounds: z.infer<typeof mapSchema>["bounds"]) {
  if (!bounds) return { "geo.type": "Point" };
  const longitudeSpan = bounds.west <= bounds.east
    ? bounds.east - bounds.west
    : (180 - bounds.west) + (bounds.east + 180);
  // MongoDB interprets GeoJSON polygons larger than a hemisphere as their
  // complementary geometry unless a strict-winding CRS is supplied. A wide
  // world viewport is already bounded by the 2,000-point API cap, so return
  // indexed points globally and let Leaflet clip them instead.
  if (longitudeSpan >= 180) return { "geo.type": "Point" };
  const polygon = (west: number, east: number) => ({
    geo: {
      $geoWithin: {
        $geometry: {
          type: "Polygon",
          coordinates: [[
            [west, bounds.south],
            [east, bounds.south],
            [east, bounds.north],
            [west, bounds.north],
            [west, bounds.south],
          ]],
        },
      },
    },
  });
  return bounds.west <= bounds.east
    ? polygon(bounds.west, bounds.east)
    : { $or: [polygon(bounds.west, 180), polygon(-180, bounds.east)] };
}

async function mapProjection(
  db: Db,
  owner: string,
  bounds: z.infer<typeof mapSchema>["bounds"],
  limit: number,
): Promise<Record<string, unknown>> {
  const placedQuery = { owner, kind: "image", "geo.type": "Point" };
  const query = bounds
    ? { owner, kind: "image", ...geoBoundsQuery(bounds) }
    : placedQuery;
  const [assets, totalPlaced, unplacedLocationCount] = await Promise.all([
    db.collection<any>("media_assets").find(query, {
      projection: {
        _id: 1,
        fileName: 1,
        status: 1,
        capturedAt: 1,
        geo: 1,
        thumbnail: 1,
        currentRunId: 1,
      },
    }).sort({ capturedAt: -1, _id: -1 }).limit(limit + 1).toArray(),
    db.collection("media_assets").countDocuments(placedQuery),
    db.collection("media_assets").countDocuments({
      owner,
      kind: "image",
      $nor: [{ "geo.type": "Point" }],
    }),
  ]);
  const visible = assets.slice(0, limit);
  const captions = await visualCaptionsForAssets(db, visible);
  return {
    points: visible.map((asset) => ({
      assetId: asset._id,
      fileName: asset.fileName,
      status: asset.status,
      longitude: asset.geo.coordinates[0],
      latitude: asset.geo.coordinates[1],
      capturedAt: asset.capturedAt,
      thumbnailUrl: thumbnailUrl(asset),
      shortCaption: captions.get(String(asset._id)),
    })),
    totalPlaced,
    unplacedLocationCount,
    truncated: assets.length > limit,
  };
}

async function updatePlacement(
  db: Db,
  owner: string,
  input: z.infer<typeof updatePlacementSchema>,
): Promise<Record<string, unknown>> {
  const assetId = new ObjectId(input.assetId);
  const before = await db.collection<any>("media_assets").findOne({
    _id: assetId,
    owner,
    kind: "image",
    placementRevision: input.expectedRevision,
  });
  if (!before) throw new Error("Photo placement changed; reload and try again");
  const set: Record<string, unknown> = {
    placementRevision: input.expectedRevision + 1,
    updatedAt: new Date(),
  };
  const unset: Record<string, ""> = {};
  if (input.capturedAt !== undefined) {
    if (input.capturedAt === null) {
      unset.capturedAt = "";
      unset.capturedAtSource = "";
    } else {
      set.capturedAt = new Date(input.capturedAt);
      set.capturedAtSource = "manual";
    }
  }
  if (input.timeZone !== undefined) {
    if (input.timeZone === null) {
      unset.capturedAtTimeZone = "";
      unset.capturedAtTimeZoneSource = "";
    } else {
      set.capturedAtTimeZone = input.timeZone;
      set.capturedAtTimeZoneSource = "manual";
    }
  }
  if (input.location !== undefined) {
    if (input.location === null) {
      unset.location = "";
      unset.geo = "";
      unset.locationSource = "";
    } else {
      set.location = input.location;
      set.geo = {
        type: "Point",
        coordinates: [input.location.longitude, input.location.latitude],
      };
      set.locationSource = "manual";
    }
  }
  const result = await db.collection("media_assets").findOneAndUpdate(
    { _id: assetId, owner, placementRevision: input.expectedRevision },
    { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) },
    { returnDocument: "after" },
  );
  if (!result) throw new Error("Photo placement changed; reload and try again");
  await db.collection("media_asset_placement_history").insertOne({
    _id: new ObjectId(),
    owner,
    assetId,
    revision: input.expectedRevision + 1,
    before: {
      capturedAt: before.capturedAt,
      capturedAtSource: before.capturedAtSource,
      capturedAtTimeZone: before.capturedAtTimeZone,
      location: before.location,
    },
    after: {
      capturedAt: result.capturedAt,
      capturedAtSource: result.capturedAtSource,
      capturedAtTimeZone: result.capturedAtTimeZone,
      location: result.location,
    },
    createdAt: new Date(),
  });
  return { success: true, asset: result };
}

export class MediaLibraryResource
  implements Resource<MediaLibraryRequest, unknown> {
  code = "media-library";
  description =
    "Run resumable mounted-folder photo imports, recognition batches, and indexed photo Timeline/Map projections.";
  schemas = { request: mediaLibraryRequestSchema, response: z.unknown() };

  extractActions(input: MediaLibraryRequest) {
    return [{
      path: ["media-library", input.action],
      actions: [
        input.action === "processFolderCampaign" ||
          input.action === "processRecognitionBatch"
          ? "process"
          : "use",
      ],
    }];
  }

  async use(input: MediaLibraryRequest, auth: Auth): Promise<unknown> {
    const db = await getRootDB();
    switch (input.action) {
      case "listMountedFolders":
        return { listing: await listMediaSourceFolders(input.relativePath) };
      case "startFolderScan":
        return await startFolderCampaign(db, auth, input.relativePath);
      case "getFolderCampaign": {
        const campaign = await db.collection<any>("media_folder_campaigns")
          .findOne({
            _id: new ObjectId(input.campaignId),
            owner: auth.principal,
          });
        if (!campaign) throw new Error("Folder campaign was not found");
        return { campaign: await publicFolderCampaign(db, campaign) };
      }
      case "getActiveFolderCampaign": {
        const campaign = await db.collection<any>("media_folder_campaigns")
          .findOne({
            owner: auth.principal,
            status: {
              $in: ["queued", "scanning", "preview_ready", "importing"],
            },
          }, { sort: { createdAt: -1 } });
        return {
          campaign: campaign ? await publicFolderCampaign(db, campaign) : null,
        };
      }
      case "confirmFolderCampaign":
        return await confirmFolderCampaign(
          db,
          auth,
          new ObjectId(input.campaignId),
        );
      case "processFolderCampaign": {
        const job = await assertTrustedCoordinatorJob(
          db,
          auth.principal,
          input.jobId,
          ["mediaFolderImport"],
        );
        const trustedId = job.data?.campaignId;
        if (input.campaignId && trustedId && input.campaignId !== trustedId) {
          throw new Error("Folder campaign does not match its signed job");
        }
        return await processFolderCampaign(
          db,
          input.campaignId ? new ObjectId(input.campaignId) : undefined,
        );
      }
      case "previewRecognitionBatch":
        return await prepareRecognitionBatch(db, auth, input);
      case "confirmRecognitionBatch":
        return await confirmRecognitionBatch(db, auth, input);
      case "getRecognitionBatch": {
        const batch = await db.collection<any>("media_recognition_batches")
          .findOne({ _id: new ObjectId(input.batchId), owner: auth.principal });
        if (!batch) throw new Error("Recognition batch was not found");
        const reconciled = await reconcileRecognitionBatch(db, batch);
        const recentFailures = await db.collection<any>(
          "media_recognition_batch_items",
        ).find({
          batchId: batch._id,
          state: { $in: ["failed", "budget_blocked"] },
        }, { projection: { assetId: 1, state: 1, safeError: 1 } })
          .sort({ updatedAt: -1 }).limit(20).toArray();
        return { batch: reconciled, recentFailures };
      }
      case "cancelRecognitionBatch": {
        const now = new Date();
        const batch = await db.collection<any>("media_recognition_batches")
          .findOneAndUpdate(
            {
              _id: new ObjectId(input.batchId),
              owner: auth.principal,
              status: { $in: ["queued", "running", "paused"] },
            },
            { $set: { cancelRequestedAt: now, updatedAt: now } },
            { returnDocument: "after" },
          );
        if (!batch) throw new Error("Active recognition batch was not found");
        await db.collection("media_recognition_batch_items").updateMany(
          { batchId: batch._id, state: "pending" },
          { $set: { state: "cancelled", updatedAt: now } },
        );
        return { batch: await reconcileRecognitionBatch(db, batch) };
      }
      case "retryRecognitionBatchFailures": {
        const batch = await db.collection<any>("media_recognition_batches")
          .findOne({ _id: new ObjectId(input.batchId), owner: auth.principal });
        if (!batch) throw new Error("Recognition batch was not found");
        const config = await loadConfig();
        const current = selectProfile(config, batch.profileId);
        if (JSON.stringify(current) !== JSON.stringify(batch.profileSnapshot)) {
          throw new Error(
            "The recognition profile changed; create a new batch",
          );
        }
        const now = new Date();
        const result = await db.collection("media_recognition_batch_items")
          .updateMany(
            {
              batchId: batch._id,
              state: { $in: ["failed", "budget_blocked"] },
            },
            {
              $set: { state: "pending", updatedAt: now },
              $inc: { retryGeneration: 1 },
              $unset: { safeError: "", jobId: "" },
            },
          );
        await db.collection("media_recognition_batches").updateOne(
          { _id: batch._id },
          {
            $set: { status: "queued", updatedAt: now },
            $unset: { cancelRequestedAt: "", completedAt: "", safeError: "" },
          },
        );
        try {
          await enqueueRecognitionWorker(batch._id, auth);
        } catch {
          // The periodic coordinator resumes this durable batch.
        }
        return { success: true, reset: result.modifiedCount };
      }
      case "processRecognitionBatch": {
        const job = await assertTrustedCoordinatorJob(
          db,
          auth.principal,
          input.jobId,
          ["mediaRecognitionBatch"],
        );
        const trustedId = job.data?.batchId;
        if (input.batchId && trustedId && input.batchId !== trustedId) {
          throw new Error("Recognition batch does not match its signed job");
        }
        return await processRecognitionBatch(
          db,
          input.batchId ? new ObjectId(input.batchId) : undefined,
        );
      }
      case "timeline":
        return await timelineProjection(
          db,
          auth.principal,
          new Date(input.start),
          new Date(input.end),
          input.detailLimit,
        );
      case "map":
        return await mapProjection(
          db,
          auth.principal,
          input.bounds,
          input.limit,
        );
      case "summary": {
        const [all, missingTime, missingLocation, ready, needsAttention] =
          await Promise.all([
            db.collection("media_assets").countDocuments({
              owner: auth.principal,
              kind: "image",
            }),
            db.collection("media_assets").countDocuments({
              owner: auth.principal,
              kind: "image",
              $nor: [{ capturedAt: { $type: "date" } }],
            }),
            db.collection("media_assets").countDocuments({
              owner: auth.principal,
              kind: "image",
              $nor: [{ "geo.type": "Point" }],
            }),
            db.collection("media_assets").countDocuments({
              owner: auth.principal,
              kind: "image",
              status: "ready",
            }),
            db.collection("media_assets").countDocuments({
              owner: auth.principal,
              kind: "image",
              status: {
                $in: [
                  "failed",
                  "budget_blocked",
                  "source_missing",
                  "source_changed",
                ],
              },
            }),
          ]);
        return { all, missingTime, missingLocation, ready, needsAttention };
      }
      case "updatePlacement":
        return await updatePlacement(db, auth.principal, input);
    }
  }
}
