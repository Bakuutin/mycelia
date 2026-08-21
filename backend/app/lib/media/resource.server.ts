import { z } from "zod";
import { type Db, GridFSBucket, ObjectId } from "mongodb";
import { createHash, randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import { PDFDocument, StandardFonts } from "pdf-lib";
import type { Resource } from "@/lib/auth/resources.ts";
import type { Auth } from "@/lib/auth/core.server.ts";
import { getRootDB } from "@/lib/mongo/core.server.ts";
import { getServerConfig } from "@/lib/config/serverConfig.server.ts";
import { enqueueJob } from "@/lib/jobs/queue.ts";
import { inspectGoogleAdc } from "@/lib/gcp/auth.server.ts";
import {
  createWebpPreview,
  inspectLocalMedia,
  mediaSourceConfigured,
  readLocalMedia,
  resolveMediaSourcePath,
  scanMediaSource,
} from "./local.server.ts";
import {
  analyzeWithMediaProvider,
  embedMediaQuery,
  type NormalizedMediaAnalysis,
  testSelfHostedProfile,
} from "./providers.server.ts";
import {
  assertMediaPerImportBudget,
  estimateMediaGrossUsd,
  gcpUsageLedgerId,
  summarizeGcpUsage,
} from "./costs.ts";
import {
  type MediaKnowledgeConfig,
  type MediaRecognitionProfile,
  type MediaRecognitionTask,
  zMediaKnowledgeConfig,
  zMediaRecognitionProfile,
  zMediaRecognitionTask,
} from "@myceliasdk/media.ts";

const requestedTasksSchema = z.array(zMediaRecognitionTask).min(1).max(4)
  .optional();

const statusSchema = z.object({ action: z.literal("status") });
const analyzeSourceSchema = z.object({
  action: z.literal("analyzeSource"),
  relativePath: z.string().min(1).default("."),
  profileId: z.string().min(1).optional(),
  requestedTasks: requestedTasksSchema,
  includeGlobalPhotoAnalysis: z.boolean().optional(),
});
const confirmImportSchema = z.object({
  action: z.literal("confirmImport"),
  importId: z.string().refine(ObjectId.isValid),
  consent: z.literal(true),
  queueRecognition: z.boolean().default(false),
});
const listAssetsSchema = z.object({
  action: z.literal("listAssets"),
  status: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(50),
  before: z.string().datetime().optional(),
});
const getAssetSchema = z.object({
  action: z.literal("getAsset"),
  assetId: z.string().refine(ObjectId.isValid),
});
const searchSchema = z.object({
  action: z.literal("search"),
  query: z.string().trim().min(1),
  limit: z.number().int().min(1).max(50).default(20),
});
const retrySchema = z.object({
  action: z.literal("retry"),
  assetId: z.string().refine(ObjectId.isValid),
  profileId: z.string().min(1).optional(),
  requestedTasks: requestedTasksSchema,
  includeGlobalPhotoAnalysis: z.boolean().optional(),
});
const processAssetSchema = z.object({
  action: z.literal("processAsset"),
  assetId: z.string().refine(ObjectId.isValid),
  profileSnapshot: z.record(z.string(), z.unknown()),
  requestedTasks: requestedTasksSchema,
  includeGlobalPhotoAnalysis: z.boolean().optional(),
  consentReceiptId: z.string().min(1),
  jobId: z.string().optional(),
});
const testConnectorSchema = z.object({
  action: z.literal("testConnector"),
  profileId: z.string().min(1),
  includeDocumentAi: z.boolean().default(true),
});
const deleteDerivedSchema = z.object({
  action: z.literal("deleteDerived"),
  assetId: z.string().refine(ObjectId.isValid),
  target: z.enum(["previews", "analysis", "source_reference"]),
  confirm: z.literal(true),
});

const mediaRequestSchema = z.discriminatedUnion("action", [
  statusSchema,
  analyzeSourceSchema,
  confirmImportSchema,
  listAssetsSchema,
  getAssetSchema,
  searchSchema,
  retrySchema,
  processAssetSchema,
  testConnectorSchema,
  deleteDerivedSchema,
]);

type MediaRequest = z.infer<typeof mediaRequestSchema>;

function objectId(value: unknown): ObjectId {
  return value instanceof ObjectId ? value : new ObjectId(String(value));
}

function safeError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error))
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\/media-source\/?/g, "[media-source]/")
    .slice(0, 700);
}

function normalizeRequestedTasks(input: {
  requestedTasks?: MediaRecognitionTask[];
  includeGlobalPhotoAnalysis?: boolean;
}): MediaRecognitionTask[] {
  const tasks = input.requestedTasks ??
    (input.includeGlobalPhotoAnalysis
      ? ["visual-understanding", "ocr", "labels", "objects"]
      : ["visual-understanding"]);
  return ([
    "visual-understanding",
    "ocr",
    "labels",
    "objects",
  ] as MediaRecognitionTask[]).filter(
    (task) => tasks.includes(task),
  );
}

function assertTasksAllowed(
  profile: MediaRecognitionProfile,
  tasks: MediaRecognitionTask[],
): void {
  if (tasks.length === 0) {
    throw new Error("Select at least one recognition task");
  }
  if (
    profile.providerType === "google-cloud" &&
    tasks.some((task) => task === "labels" || task === "objects") &&
    !profile.allowGlobalPhotoAnalysis
  ) {
    throw new Error(
      "Global labels/objects are not enabled for this Google profile",
    );
  }
}

async function loadMediaConfig(): Promise<MediaKnowledgeConfig> {
  const config = await getServerConfig();
  return zMediaKnowledgeConfig.parse(config.mediaKnowledge ?? {});
}

function selectProfile(
  config: MediaKnowledgeConfig,
  requestedId?: string,
): MediaRecognitionProfile {
  const id = requestedId ?? config.activeProfileId;
  const profile = config.profiles.find((entry) => entry.id === id);
  if (!profile) throw new Error("Media recognition profile was not found");
  if (!profile.enabled) {
    throw new Error("Media recognition profile is disabled");
  }
  return profile;
}

function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length === 0 || left.length !== right.length) return -1;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index++) {
    dot += left[index] * right[index];
    leftNorm += left[index] * left[index];
    rightNorm += right[index] * right[index];
  }
  if (!leftNorm || !rightNorm) return -1;
  return dot / Math.sqrt(leftNorm * rightNorm);
}

async function uploadGridFs(
  db: Db,
  bucketName: string,
  filename: string,
  data: Uint8Array,
  metadata: Record<string, unknown>,
): Promise<ObjectId> {
  const bucket = new GridFSBucket(db, { bucketName });
  const id = new ObjectId();
  const stream = bucket.openUploadStream(filename, { id, metadata });
  stream.end(Buffer.from(data));
  await new Promise<void>((resolve, reject) => {
    stream.on("finish", () => resolve());
    stream.on("error", reject);
  });
  return id;
}

async function downloadGridFs(
  db: Db,
  bucketName: string,
  id: ObjectId,
): Promise<Uint8Array> {
  const stream = new GridFSBucket(db, { bucketName }).openDownloadStream(id);
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return new Uint8Array(Buffer.concat(chunks));
}

async function deleteGridFs(
  db: Db,
  bucketName: string,
  id: unknown,
): Promise<void> {
  if (!id) return;
  await new GridFSBucket(db, { bucketName }).delete(objectId(id)).catch(
    () => {},
  );
}

function previewResponse(item: any) {
  return {
    ...item,
    realPath: undefined,
    metadata: undefined,
    thumbnailUrl: item.thumbnail?.fileId
      ? `/api/files/${item.thumbnail.fileId}?bucket=media_previews`
      : undefined,
  };
}

function assertPromoGuard(
  config: MediaKnowledgeConfig,
  projectId: string,
  requestedUsd: number,
): void {
  const guard = config.promoGuard;
  const verified = guard.creditVerifiedAt
    ? new Date(guard.creditVerifiedAt).getTime()
    : 0;
  if (!verified || Date.now() - verified > 24 * 60 * 60 * 1000) {
    throw new Error(
      "PROMO_CREDIT_NOT_RECENTLY_VERIFIED: verify the remaining Google promotional credit in Settings within the last 24 hours",
    );
  }
  if (guard.creditVerifiedProjectId !== projectId) {
    throw new Error(
      "PROMO_PROJECT_NOT_VERIFIED: selected project does not match the recently verified promotional-credit project",
    );
  }
  if (
    !Number.isFinite(guard.verifiedRemainingUsd) ||
    Number(guard.verifiedRemainingUsd) < requestedUsd
  ) {
    throw new Error(
      "PROMO_BALANCE_NOT_VERIFIED: confirmed promotional credit is insufficient or missing",
    );
  }
  const stopAt = new Date(guard.promotionExpiresAt).getTime() -
    guard.stopBeforeHours * 60 * 60 * 1000;
  if (Date.now() >= stopAt) {
    throw new Error(
      "PROMO_CREDIT_WINDOW_CLOSED: Google processing is disabled before credit expiry",
    );
  }
}

async function reserveGcpBudget(
  db: Db,
  principal: string,
  attemptId: string,
  amount: number,
  config: MediaKnowledgeConfig,
  projectId: string,
): Promise<void> {
  if (amount <= 0) return;
  assertPromoGuard(config, projectId, amount);
  const now = new Date();
  const month = now.toISOString().slice(0, 7);
  const day = now.toISOString().slice(0, 10);
  const id = gcpUsageLedgerId(projectId, month);
  const collection = db.collection<any>("gcp_usage_months");
  const events = db.collection<any>("gcp_usage_events");

  try {
    await events.insertOne({
      attemptId,
      principal,
      projectId,
      ledgerId: id,
      month,
      day,
      state: "reserving",
      grossListPriceUsd: amount,
      createdAt: now,
      updatedAt: now,
    });
  } catch (error) {
    if ((error as any)?.code !== 11000) throw error;
    const existing = await events.findOne({ attemptId });
    if (existing?.state === "reserved") return;
    throw new Error("GCP_BUDGET_ATTEMPT_ALREADY_SETTLED");
  }

  try {
    for (let tries = 0; tries < 5; tries++) {
      const current = await collection.findOne({ _id: id });
      const revision = Number(current?.revision ?? 0);
      const monthUsed = Number(current?.grossCommittedUsd ?? 0) +
        Number(current?.grossReservedUsd ?? 0);
      const dayUsed = Number((current?.days as any)?.[day]?.grossUsd ?? 0);
      if (
        monthUsed + amount > Number(config.promoGuard.verifiedRemainingUsd)
      ) {
        throw new Error("GCP_VERIFIED_PROMO_BALANCE_BLOCKED");
      }
      if (monthUsed + amount > config.promoGuard.monthlyGrossLimitUsd) {
        throw new Error("GCP_MONTHLY_BUDGET_BLOCKED");
      }
      if (dayUsed + amount > config.promoGuard.dailyGrossLimitUsd) {
        throw new Error("GCP_DAILY_BUDGET_BLOCKED");
      }
      const update = {
        $setOnInsert: {
          owner: `gcp-project:${projectId}`,
          projectId,
          month,
          grossCommittedUsd: 0,
          createdAt: now,
        },
        $inc: {
          grossReservedUsd: amount,
          [`days.${day}.grossUsd`]: amount,
          revision: 1,
        },
        $set: { updatedAt: now },
      };
      let result;
      try {
        result = current
          ? await collection.updateOne({ _id: id, revision }, update)
          : await collection.updateOne({ _id: id }, update, { upsert: true });
      } catch (error) {
        if ((error as any)?.code === 11000) continue;
        throw error;
      }
      if (result.modifiedCount === 1 || result.upsertedCount === 1) {
        await events.updateOne(
          { attemptId, state: "reserving" },
          { $set: { state: "reserved", updatedAt: new Date() } },
        );
        return;
      }
    }
    throw new Error("GCP_BUDGET_RESERVATION_BUSY");
  } catch (error) {
    await events.deleteOne({ attemptId, state: "reserving" });
    throw error;
  }
}

async function finishGcpBudget(
  db: Db,
  attemptId: string,
  amount: number,
  state: "committed" | "unknown" | "released",
): Promise<void> {
  if (amount <= 0) return;
  const event = await db.collection<any>("gcp_usage_events").findOneAndUpdate(
    { attemptId, state: "reserved" },
    {
      $set: {
        state: "settling",
        targetState: state,
        settlingAt: new Date(),
        updatedAt: new Date(),
      },
    },
    { returnDocument: "before" },
  );
  if (!event) return;
  const month = String(event.month);
  const ledgerId = String(
    event.ledgerId ?? `${String(event.owner)}:${month}`,
  );
  const increment = state === "released"
    ? { grossReservedUsd: -amount }
    : { grossReservedUsd: -amount, grossCommittedUsd: amount };
  await db.collection<any>("gcp_usage_months").updateOne(
    { _id: ledgerId },
    { $inc: increment, $set: { updatedAt: new Date() } },
  );
  await db.collection<any>("gcp_usage_events").updateOne(
    { attemptId, state: "settling" },
    {
      $set: { state, updatedAt: new Date() },
      $unset: { targetState: "", settlingAt: "" },
    },
  );
}

async function persistAnalysis(
  db: Db,
  asset: any,
  runId: string,
  analysis: NormalizedMediaAnalysis,
) {
  if (
    analysis.visualUnderstanding && analysis.searchText && analysis.embedding
  ) {
    await db.collection<any>("media_visual_descriptions").updateOne(
      { _id: runId },
      {
        $set: {
          runId,
          assetId: asset._id,
          visualUnderstanding: analysis.visualUnderstanding,
          searchText: analysis.searchText,
          embedding: analysis.embedding,
          active: false,
          updatedAt: new Date(),
        },
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true },
    );
  }
  if (analysis.pages.length > 0) {
    await db.collection<any>("media_ocr_pages").bulkWrite(
      analysis.pages.map((page) => ({
        updateOne: {
          filter: { _id: `${runId}:p${page.pageNumber}` },
          update: {
            $set: {
              runId,
              assetId: asset._id,
              pageNumber: page.pageNumber,
              text: page.text,
              blocks: page.blocks,
              languages: page.languages,
              width: page.width,
              height: page.height,
              active: false,
              updatedAt: new Date(),
            },
            $setOnInsert: { createdAt: new Date() },
          },
          upsert: true,
        },
      })),
      { ordered: true },
    );
  }
  if (analysis.annotations.length > 0) {
    await db.collection<any>("media_annotations").bulkWrite(
      analysis.annotations.map((annotation, index) => ({
        updateOne: {
          filter: { _id: `${runId}:a${index + 1}` },
          update: {
            $set: {
              runId,
              assetId: asset._id,
              ...annotation,
              active: false,
              updatedAt: new Date(),
            },
            $setOnInsert: { createdAt: new Date() },
          },
          upsert: true,
        },
      })),
      { ordered: true },
    );
  }
  await db.collection("media_ocr_pages").updateMany(
    { assetId: asset._id, runId: { $ne: runId } },
    { $set: { active: false } },
  );
  await db.collection("media_annotations").updateMany(
    { assetId: asset._id, runId: { $ne: runId } },
    { $set: { active: false } },
  );
  await db.collection("media_visual_descriptions").updateMany(
    { assetId: asset._id, runId: { $ne: runId } },
    { $set: { active: false } },
  );
  await db.collection("media_ocr_pages").updateMany(
    { assetId: asset._id, runId },
    { $set: { active: true } },
  );
  await db.collection("media_annotations").updateMany(
    { assetId: asset._id, runId },
    { $set: { active: true } },
  );
  await db.collection("media_visual_descriptions").updateMany(
    { assetId: asset._id, runId },
    { $set: { active: true } },
  );
}

async function enqueueAsset(
  assetId: ObjectId,
  profile: MediaRecognitionProfile,
  requestedTasks: MediaRecognitionTask[],
  consentReceiptId: string,
) {
  return await enqueueJob({
    type: "mediaRecognition",
    assetId: assetId.toString(),
    profileSnapshot: profile,
    requestedTasks,
    consentReceiptId,
    routingContext: {
      sourceId: assetId.toString(),
      providerProfileId: profile.id,
      providerProfileName: profile.name,
      resolvedAt: new Date().toISOString(),
    },
  }, { trigger: { type: "manual", reason: "media import confirmed" } });
}

export class MediaResource implements Resource<MediaRequest, unknown> {
  code = "media";
  description =
    "Import, recognize, browse, and search local photos and PDFs with explicit provider provenance.";
  schemas = { request: mediaRequestSchema, response: z.unknown() };

  extractActions(input: MediaRequest) {
    return [{
      path: ["media", input.action],
      actions: [input.action === "processAsset" ? "process" : "use"],
    }];
  }

  async use(input: MediaRequest, auth: Auth): Promise<unknown> {
    const db = await getRootDB();
    const config = await loadMediaConfig();

    switch (input.action) {
      case "status": {
        const googleProfile = config.profiles.find((profile) =>
          profile.providerType === "google-cloud"
        );
        const adc = googleProfile
          ? await inspectGoogleAdc()
          : { configured: false, credentialPathConfigured: false };
        const now = Date.now();
        const nowDate = new Date(now);
        const month = nowDate.toISOString().slice(0, 7);
        const usageDocument = googleProfile
          ? await db.collection<any>("gcp_usage_months").findOne({
            _id: gcpUsageLedgerId(googleProfile.projectId, month),
          })
          : null;
        const verifiedAt = config.promoGuard.creditVerifiedAt;
        return {
          enabled: config.enabled,
          sourceConfigured: mediaSourceConfigured(),
          sourceRootLabel: mediaSourceConfigured()
            ? "Mounted media source"
            : null,
          adc,
          profiles: config.profiles.map((profile) => ({
            ...profile,
            credentialConfigured: profile.providerType === "google-cloud"
              ? adc.configured
              : Boolean(Deno.env.get("MEDIA_SELF_HOSTED_API_KEY")),
          })),
          activeProfileId: config.activeProfileId,
          promoGuard: {
            ...config.promoGuard,
            creditVerificationFresh: Boolean(
              verifiedAt && now - new Date(verifiedAt).getTime() < 86_400_000,
            ),
          },
          usage: summarizeGcpUsage(usageDocument, config, nowDate),
        };
      }

      case "analyzeSource": {
        if (!config.enabled) throw new Error("Media Knowledge is disabled");
        const profile = input.profileId
          ? selectProfile(config, input.profileId)
          : undefined;
        const requestedTasks = profile ? normalizeRequestedTasks(input) : [];
        if (profile) assertTasksAllowed(profile, requestedTasks);
        const paths = await scanMediaSource(
          input.relativePath,
          config.limits.maxFilesPerImport,
        );
        if (paths.length === 0) {
          throw new Error("No supported media files found");
        }

        const importId = new ObjectId();
        const items: any[] = [];
        const previewSourcePaths: Array<string | undefined> = [];
        let grossEstimateUsd = 0;
        for (const path of paths) {
          try {
            const inspected = await inspectLocalMedia(path, config.limits);
            const duplicate = await db.collection("media_assets").findOne({
              owner: auth.principal,
              sha256: inspected.sha256,
            }, { projection: { _id: 1, status: 1 } });
            const estimate = profile
              ? estimateMediaGrossUsd(
                inspected.kind,
                inspected.pageCount,
                requestedTasks,
                profile,
              )
              : 0;
            grossEstimateUsd += estimate;
            items.push({
              relativePath: inspected.relativePath,
              fileName: inspected.fileName,
              kind: inspected.kind,
              mimeType: inspected.mimeType,
              byteLength: inspected.byteLength,
              sha256: inspected.sha256,
              pageCount: inspected.pageCount,
              width: inspected.width,
              height: inspected.height,
              capturedAt: inspected.capturedAt,
              metadata: inspected.metadata,
              duplicateAssetId: duplicate?._id,
              duplicateStatus: duplicate?.status,
              estimatedGrossUsd: estimate,
            });
            previewSourcePaths.push(
              inspected.kind === "image" && !duplicate
                ? inspected.realPath
                : undefined,
            );
          } catch (error) {
            items.push({ relativePath: path, error: safeError(error) });
            previewSourcePaths.push(undefined);
          }
        }
        assertMediaPerImportBudget(config, grossEstimateUsd);
        for (const [index, realPath] of previewSourcePaths.entries()) {
          if (!realPath) continue;
          const item = items[index];
          let thumbId: ObjectId | undefined;
          let previewId: ObjectId | undefined;
          try {
            const thumb = await createWebpPreview(realPath, 256, 70);
            const large = await createWebpPreview(realPath, 1280, 80);
            thumbId = await uploadGridFs(
              db,
              "media_previews",
              `${importId}/${item.sha256}/thumbnail_256.webp`,
              thumb.data,
              { importId, sha256: item.sha256, role: "thumbnail" },
            );
            previewId = await uploadGridFs(
              db,
              "media_previews",
              `${importId}/${item.sha256}/preview_1280.webp`,
              large.data,
              { importId, sha256: item.sha256, role: "preview" },
            );
            item.thumbnail = {
              bucket: "media_previews",
              fileId: thumbId,
              mimeType: "image/webp",
              width: thumb.width,
              height: thumb.height,
              byteLength: thumb.data.byteLength,
            };
            item.preview = {
              bucket: "media_previews",
              fileId: previewId,
              mimeType: "image/webp",
              width: large.width,
              height: large.height,
              byteLength: large.data.byteLength,
            };
          } catch (error) {
            await Promise.all([
              deleteGridFs(db, "media_previews", thumbId),
              deleteGridFs(db, "media_previews", previewId),
            ]);
            items[index] = {
              relativePath: item.relativePath,
              error: safeError(error),
            };
          }
        }
        const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
        await db.collection("media_imports").insertOne({
          _id: importId,
          owner: auth.principal,
          status: "preview",
          source: { type: "mounted_folder", relativePath: input.relativePath },
          profileSnapshot: profile ?? null,
          requestedTasks,
          grossEstimateUsd,
          items,
          createdAt: new Date(),
          expiresAt,
        });
        return {
          importId,
          expiresAt,
          grossEstimateUsd,
          provider: profile
            ? {
              id: profile.id,
              name: profile.name,
              providerType: profile.providerType,
            }
            : { id: null, name: "Metadata only", providerType: "none" },
          requestedTasks,
          items: items.map(previewResponse),
        };
      }

      case "confirmImport": {
        const importId = new ObjectId(input.importId);
        const record = await db.collection("media_imports").findOne({
          _id: importId,
          owner: auth.principal,
          status: "preview",
          expiresAt: { $gt: new Date() },
        });
        if (!record) {
          throw new Error(
            "Import preview is missing, expired, or already confirmed",
          );
        }
        const profile = input.queueRecognition
          ? zMediaRecognitionProfile.parse(record.profileSnapshot)
          : null;
        const requestedTasks = profile
          ? normalizeRequestedTasks({
            requestedTasks: Array.isArray(record.requestedTasks)
              ? record.requestedTasks as MediaRecognitionTask[]
              : undefined,
            includeGlobalPhotoAnalysis:
              record.includeGlobalPhotoAnalysis === true,
          })
          : [];
        const consentReceiptId = randomUUID();
        const created: any[] = [];
        const duplicates: any[] = [];
        for (const item of record.items ?? []) {
          if (item.error) continue;
          const existing = await db.collection("media_assets").findOne({
            owner: auth.principal,
            sha256: item.sha256,
          });
          if (existing) {
            duplicates.push(existing._id);
            continue;
          }
          const assetId = new ObjectId();
          const now = new Date();
          const asset = {
            _id: assetId,
            owner: auth.principal,
            kind: item.kind,
            storageMode: "external_reference",
            fileName: item.fileName,
            mimeType: item.mimeType,
            byteLength: item.byteLength,
            sha256: item.sha256,
            source: {
              sourceRootId: "default",
              relativePath: item.relativePath,
            },
            pageCount: item.pageCount,
            width: item.width,
            height: item.height,
            thumbnail: item.thumbnail,
            preview: item.preview,
            metadata: item.metadata ?? {},
            capturedAt: item.capturedAt,
            capturedAtSource: item.capturedAt ? "exif" : undefined,
            status: profile ? "queued" : "staged",
            createdAt: now,
            updatedAt: now,
          };
          try {
            await db.collection("media_assets").insertOne(asset);
          } catch (error) {
            if ((error as any)?.code === 11000) {
              const raced = await db.collection("media_assets").findOne({
                owner: auth.principal,
                sha256: item.sha256,
              });
              if (raced) duplicates.push(raced._id);
              continue;
            }
            throw error;
          }
          await db.collection("media_metadata_versions").insertOne({
            assetId,
            version: 1,
            extractor: "ffprobe/pdf-lib",
            metadata: item.metadata ?? {},
            createdAt: now,
          });
          if (profile) {
            const job = await enqueueAsset(
              assetId,
              profile,
              requestedTasks,
              consentReceiptId,
            );
            created.push({ assetId, jobId: job.id });
          } else {
            created.push({ assetId, jobId: null });
          }
        }
        await db.collection("media_imports").updateOne(
          { _id: importId, status: "preview" },
          {
            $set: {
              status: "confirmed",
              confirmedAt: new Date(),
              consentReceipt: {
                id: consentReceiptId,
                principal: auth.principal,
                providerProfileId: profile?.id ?? null,
                recognitionQueued: Boolean(profile),
                requestedTasks,
              },
              createdAssetIds: created.map((entry) => entry.assetId),
              duplicateAssetIds: duplicates,
            },
            $unset: { expiresAt: "" },
          },
        );
        return { success: true, created, duplicates };
      }

      case "listAssets": {
        const query: any = { owner: auth.principal };
        if (input.status) query.status = input.status;
        if (input.before) query.createdAt = { $lt: new Date(input.before) };
        const assets = await db.collection("media_assets").find(query)
          .sort({ createdAt: -1, _id: -1 }).limit(input.limit).toArray();
        return {
          assets: assets.map((asset) => ({
            ...asset,
            thumbnailUrl: asset.thumbnail?.fileId
              ? `/api/files/${asset.thumbnail.fileId}?bucket=media_previews`
              : undefined,
            previewUrl: asset.preview?.fileId
              ? `/api/files/${asset.preview.fileId}?bucket=media_previews`
              : undefined,
          })),
        };
      }

      case "getAsset": {
        const asset = await db.collection("media_assets").findOne({
          _id: new ObjectId(input.assetId),
          owner: auth.principal,
        });
        if (!asset) throw new Error("Media asset not found");
        const [pages, annotations, visual, runs] = await Promise.all([
          db.collection("media_ocr_pages").find({
            assetId: asset._id,
            active: true,
          })
            .sort({ pageNumber: 1 }).toArray(),
          db.collection("media_annotations").find({
            assetId: asset._id,
            active: true,
          })
            .sort({ confidence: -1 }).toArray(),
          db.collection("media_visual_descriptions").findOne({
            assetId: asset._id,
            active: true,
          }, { projection: { embedding: 0 } }),
          db.collection("media_analysis_runs").find({ assetId: asset._id })
            .sort({ createdAt: -1 }).limit(20).toArray(),
        ]);
        return {
          asset: {
            ...asset,
            thumbnailUrl: asset.thumbnail?.fileId
              ? `/api/files/${asset.thumbnail.fileId}?bucket=media_previews`
              : undefined,
            previewUrl: asset.preview?.fileId
              ? `/api/files/${asset.preview.fileId}?bucket=media_previews`
              : undefined,
          },
          pages,
          annotations,
          visual,
          runs,
        };
      }

      case "search": {
        const visualDocs = await db.collection<any>(
          "media_visual_descriptions",
        ).find({ active: true }, {
          projection: {
            assetId: 1,
            runId: 1,
            visualUnderstanding: 1,
            "embedding.model": 1,
            "embedding.dimensions": 1,
            "embedding.values": 1,
          },
        }).limit(1_000).toArray();
        let semanticHits: Array<any & { semanticScore: number }> = [];
        let semanticUsage: Record<string, unknown> | null = null;
        if (visualDocs.length > 0 && config.activeProfileId) {
          const profile = selectProfile(config);
          const attemptId = `media-search:${randomUUID()}`;
          const reservedUsd = profile.providerType === "google-cloud"
            ? 0.0003
            : 0;
          if (profile.providerType === "google-cloud") {
            await reserveGcpBudget(
              db,
              auth.principal,
              attemptId,
              reservedUsd,
              config,
              profile.projectId,
            );
          }
          try {
            const queryEmbedding = await embedMediaQuery(profile, input.query);
            semanticHits = visualDocs.filter((item) =>
              item?.embedding?.model === queryEmbedding.model &&
              Number(item?.embedding?.dimensions) ===
                queryEmbedding.dimensions
            ).map((item) => ({
              ...item,
              semanticScore: cosineSimilarity(
                queryEmbedding.values,
                Array.isArray(item?.embedding?.values)
                  ? item.embedding.values.map(Number)
                  : [],
              ),
            })).filter((item) => item.semanticScore >= 0)
              .sort((left, right) => right.semanticScore - left.semanticScore)
              .slice(0, input.limit);
            semanticUsage = {
              providerProfileId: profile.id,
              model: queryEmbedding.model,
              tokenCount: queryEmbedding.tokenCount ?? 0,
              grossListPriceUsd: queryEmbedding.grossListPriceUsd,
            };
            if (profile.providerType === "google-cloud") {
              await finishGcpBudget(
                db,
                attemptId,
                reservedUsd,
                "committed",
              );
            }
          } catch (error) {
            if (profile.providerType === "google-cloud") {
              await finishGcpBudget(
                db,
                attemptId,
                reservedUsd,
                "unknown",
              );
            }
            throw error;
          }
        }
        const pageHits = await db.collection<any>("media_ocr_pages").find(
          { active: true, $text: { $search: input.query } },
          {
            projection: {
              score: { $meta: "textScore" },
              text: 1,
              pageNumber: 1,
              assetId: 1,
              runId: 1,
            },
          },
        ).sort({ score: { $meta: "textScore" } }).limit(input.limit).toArray();
        const labelHits = await db.collection<any>("media_annotations").find({
          active: true,
          label: {
            $regex: input.query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
            $options: "i",
          },
        }).limit(input.limit).toArray();
        const assetIds = [
          ...new Set(
            [...semanticHits, ...pageHits, ...labelHits].map((hit) =>
              String(hit.assetId)
            ),
          ),
        ].map((id) => new ObjectId(id));
        const assets = await db.collection("media_assets").find({
          _id: { $in: assetIds },
          owner: auth.principal,
        }).toArray();
        const byId = new Map(assets.map((asset) => [String(asset._id), asset]));
        const semanticResults: any[] = semanticHits.flatMap((hit) => {
          const asset = byId.get(String(hit.assetId));
          if (!asset || String(asset.currentRunId) !== String(hit.runId)) {
            return [];
          }
          const visual = hit.visualUnderstanding ?? {};
          return [{
            type: "semantic",
            assetId: asset._id,
            fileName: asset.fileName,
            shortCaption: visual.shortCaption,
            description: visual.description,
            scene: visual.scene,
            keywords: visual.keywords ?? [],
            semanticScore: hit.semanticScore,
            thumbnailUrl: asset.thumbnail?.fileId
              ? `/api/files/${asset.thumbnail.fileId}?bucket=media_previews`
              : undefined,
          }];
        });
        const pageResults: any[] = pageHits.flatMap((hit) => {
          const asset = byId.get(String(hit.assetId));
          if (!asset || String(asset.currentRunId) !== String(hit.runId)) {
            return [];
          }
          const text = String(hit.text ?? "");
          const index = text.toLowerCase().indexOf(input.query.toLowerCase());
          const start = Math.max(0, index < 0 ? 0 : index - 180);
          return [{
            type: "ocr",
            assetId: asset._id,
            fileName: asset.fileName,
            pageNumber: hit.pageNumber,
            snippet: text.slice(start, start + 500),
            score: hit.score,
            thumbnailUrl: asset.thumbnail?.fileId
              ? `/api/files/${asset.thumbnail.fileId}?bucket=media_previews`
              : undefined,
          }];
        });
        const labelResults: any[] = labelHits.flatMap((hit) => {
          const asset = byId.get(String(hit.assetId));
          if (!asset || String(asset.currentRunId) !== String(hit.runId)) {
            return [];
          }
          return [{
            type: hit.type,
            assetId: asset._id,
            fileName: asset.fileName,
            label: hit.label,
            confidence: hit.confidence,
            dataBoundary: hit.dataBoundary,
            thumbnailUrl: asset.thumbnail?.fileId
              ? `/api/files/${asset.thumbnail.fileId}?bucket=media_previews`
              : undefined,
          }];
        });
        return {
          results: [...semanticResults, ...pageResults, ...labelResults].slice(
            0,
            input.limit,
          ),
          semanticUsage,
        };
      }

      case "retry": {
        const asset = await db.collection("media_assets").findOne({
          _id: new ObjectId(input.assetId),
          owner: auth.principal,
        });
        if (!asset) throw new Error("Media asset not found");
        const profile = selectProfile(config, input.profileId);
        const requestedTasks = normalizeRequestedTasks(input);
        assertTasksAllowed(profile, requestedTasks);
        if (
          asset.kind === "pdf" &&
          requestedTasks.some((task) => task !== "ocr")
        ) throw new Error("PDF assets currently support only the OCR task");
        assertMediaPerImportBudget(
          config,
          estimateMediaGrossUsd(
            asset.kind,
            Number(asset.pageCount ?? 1),
            requestedTasks,
            profile,
          ),
        );
        const consentReceiptId = randomUUID();
        await db.collection("media_assets").updateOne(
          { _id: asset._id },
          {
            $set: { status: "queued", safeError: null, updatedAt: new Date() },
          },
        );
        const job = await enqueueAsset(
          asset._id,
          profile,
          requestedTasks,
          consentReceiptId,
        );
        return { success: true, jobId: job.id, consentReceiptId };
      }

      case "processAsset": {
        const profile = zMediaRecognitionProfile.parse(input.profileSnapshot);
        const requestedTasks = normalizeRequestedTasks(input);
        assertTasksAllowed(profile, requestedTasks);
        const asset = await db.collection("media_assets").findOne({
          _id: new ObjectId(input.assetId),
        });
        if (!asset) throw new Error("Media asset not found");
        if (!asset.source?.relativePath && !asset.managedOriginal?.fileId) {
          throw new Error("Media asset has no available original source");
        }

        let original: Uint8Array;
        if (asset.source?.relativePath) {
          const resolved = await resolveMediaSourcePath(
            asset.source.relativePath,
          );
          const current = await inspectLocalMedia(
            asset.source.relativePath,
            config.limits,
          );
          if (current.sha256 !== asset.sha256) {
            await db.collection("media_assets").updateOne(
              { _id: asset._id },
              { $set: { status: "source_changed", updatedAt: new Date() } },
            );
            throw new Error("Referenced original changed since import");
          }
          original = await Deno.readFile(resolved.realPath);
        } else {
          original = await downloadGridFs(
            db,
            "media_originals",
            objectId(asset.managedOriginal.fileId),
          );
        }

        let requestBytes = original;
        if (asset.kind === "image") {
          if (!asset.preview?.fileId) {
            throw new Error(
              "A sanitized preview is required before photo recognition",
            );
          }
          requestBytes = await downloadGridFs(
            db,
            "media_previews",
            objectId(asset.preview.fileId),
          );
        }
        const profileFingerprint = createHash("sha256")
          .update(JSON.stringify(profile)).digest("hex").slice(0, 16);
        const runId = createHash("sha256").update([
          String(asset._id),
          asset.sha256,
          profileFingerprint,
          requestedTasks.join("+"),
        ].join(":"))
          .digest("hex");
        const ready = await db.collection<any>("media_analysis_runs").findOne({
          _id: runId,
          state: "ready",
        });
        if (ready) {
          await db.collection("media_assets").updateOne(
            { _id: asset._id },
            {
              $set: {
                status: "ready",
                currentRunId: runId,
                updatedAt: new Date(),
              },
            },
          );
          return { success: true, reused: true, runId };
        }

        const estimatedGrossUsd = estimateMediaGrossUsd(
          asset.kind,
          Number(asset.pageCount ?? 1),
          requestedTasks,
          profile,
        );
        assertMediaPerImportBudget(config, estimatedGrossUsd);
        const attemptId = `${runId}:${input.jobId ?? randomUUID()}`;
        await db.collection<any>("media_analysis_runs").updateOne(
          { _id: runId },
          {
            $setOnInsert: {
              assetId: asset._id,
              runKey: runId,
              sourceHash: asset.sha256,
              providerSnapshot: profile,
              profileFingerprint,
              requestedTasks,
              consentReceiptId: input.consentReceiptId,
              createdAt: new Date(),
            },
            $set: {
              state: "building",
              attemptId,
              jobId: input.jobId,
              updatedAt: new Date(),
            },
          },
          { upsert: true },
        );
        await db.collection("media_assets").updateOne(
          { _id: asset._id },
          { $set: { status: "processing", updatedAt: new Date() } },
        );
        if (profile.providerType === "google-cloud") {
          try {
            await reserveGcpBudget(
              db,
              asset.owner,
              attemptId,
              estimatedGrossUsd,
              config,
              profile.projectId,
            );
          } catch (error) {
            const message = safeError(error);
            await Promise.all([
              db.collection<any>("media_analysis_runs").updateOne(
                { _id: runId },
                {
                  $set: {
                    state: "failed",
                    safeError: message,
                    updatedAt: new Date(),
                  },
                },
              ),
              db.collection("media_assets").updateOne(
                { _id: asset._id },
                {
                  $set: {
                    status: "budget_blocked",
                    safeError: message,
                    updatedAt: new Date(),
                  },
                },
              ),
            ]);
            throw error;
          }
        }
        try {
          const analysis = await analyzeWithMediaProvider({
            profile,
            bytes: requestBytes,
            mimeType: asset.kind === "image" ? "image/webp" : asset.mimeType,
            pageCount: Number(asset.pageCount ?? 1),
            requestedTasks,
            requestId: attemptId,
          });
          if (
            requestedTasks.includes("ocr") &&
            analysis.pages.length !== Number(asset.pageCount ?? 1)
          ) {
            throw new Error(
              `Provider returned ${analysis.pages.length} pages; expected ${
                asset.pageCount ?? 1
              }`,
            );
          }
          if (
            requestedTasks.includes("visual-understanding") &&
            (!analysis.visualUnderstanding || !analysis.embedding)
          ) {
            throw new Error(
              "Provider did not return visual understanding and semantic embedding",
            );
          }
          await persistAnalysis(db, asset, runId, analysis);
          await db.collection<any>("media_analysis_runs").updateOne(
            { _id: runId },
            {
              $set: {
                state: "ready",
                provenance: analysis.provenance,
                usage: analysis.usage,
                pageCount: analysis.pages.length,
                textLength: analysis.pages.reduce(
                  (sum, page) => sum + page.text.length,
                  0,
                ),
                completedAt: new Date(),
                updatedAt: new Date(),
              },
            },
          );
          await db.collection("media_assets").updateOne(
            { _id: asset._id },
            {
              $set: {
                status: "ready",
                currentRunId: runId,
                safeError: null,
                updatedAt: new Date(),
              },
            },
          );
          if (profile.providerType === "google-cloud") {
            await finishGcpBudget(
              db,
              attemptId,
              estimatedGrossUsd,
              "committed",
            );
          }
          return {
            success: true,
            runId,
            pages: analysis.pages.length,
            annotations: analysis.annotations.length,
            visualUnderstanding: Boolean(analysis.visualUnderstanding),
            usage: analysis.usage,
          };
        } catch (error) {
          const message = safeError(error);
          await db.collection<any>("media_analysis_runs").updateOne(
            { _id: runId },
            {
              $set: {
                state: "failed",
                safeError: message,
                updatedAt: new Date(),
              },
            },
          );
          await db.collection("media_assets").updateOne(
            { _id: asset._id },
            {
              $set: {
                status: "failed",
                safeError: message,
                updatedAt: new Date(),
              },
            },
          );
          if (profile.providerType === "google-cloud") {
            await finishGcpBudget(
              db,
              attemptId,
              estimatedGrossUsd,
              // A provider error can arrive after one of several billable
              // calls succeeded. Keep the whole reservation conservative.
              "unknown",
            );
          }
          throw error;
        }
      }

      case "testConnector": {
        const profile = selectProfile(config, input.profileId);
        if (profile.providerType === "self-hosted") {
          return await testSelfHostedProfile(profile);
        }
        const adc = await inspectGoogleAdc();
        if (!adc.configured) {
          throw new Error(`GOOGLE_ADC_UNAVAILABLE: ${adc.error ?? "unknown"}`);
        }
        const png = new Uint8Array(Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
          "base64",
        ));
        const started = performance.now();
        const runMetered = async <T>(
          service: "vertex-ai" | "document-ai",
          amount: number,
          call: (attemptId: string) => Promise<T>,
        ): Promise<T> => {
          const attemptId = `connector:${service}:${randomUUID()}`;
          await reserveGcpBudget(
            db,
            auth.principal,
            attemptId,
            amount,
            config,
            profile.projectId,
          );
          try {
            const result = await call(attemptId);
            await finishGcpBudget(
              db,
              attemptId,
              amount,
              "committed",
            );
            return result;
          } catch (error) {
            await finishGcpBudget(
              db,
              attemptId,
              amount,
              "unknown",
            );
            throw error;
          }
        };
        const visual = await runMetered(
          "vertex-ai",
          0.006,
          (requestId) =>
            analyzeWithMediaProvider({
              profile,
              bytes: png,
              mimeType: "image/png",
              pageCount: 1,
              requestedTasks: ["visual-understanding"],
              requestId,
            }),
        );
        let documentAi: unknown = null;
        if (input.includeDocumentAi && profile.documentAiProcessorId) {
          const pdf = await PDFDocument.create();
          const page = pdf.addPage([200, 200]);
          const font = await pdf.embedFont(StandardFonts.Helvetica);
          page.drawText("Mycelia connector test", { x: 20, y: 100, font });
          documentAi = await runMetered(
            "document-ai",
            0.0015,
            async (requestId) =>
              analyzeWithMediaProvider({
                profile,
                bytes: await pdf.save(),
                mimeType: "application/pdf",
                pageCount: 1,
                requestedTasks: ["ocr"],
                requestId,
              }),
          );
        }
        return {
          ok: true,
          latencyMs: Math.round(performance.now() - started),
          visual: {
            provenance: visual.provenance,
            shortCaption: visual.visualUnderstanding?.shortCaption,
            usage: visual.usage,
          },
          documentAi: (documentAi as any)?.provenance ?? null,
        };
      }

      case "deleteDerived": {
        const asset = await db.collection("media_assets").findOne({
          _id: new ObjectId(input.assetId),
          owner: auth.principal,
        });
        if (!asset) throw new Error("Media asset not found");
        if (input.target === "previews") {
          await Promise.all([
            deleteGridFs(db, "media_previews", asset.thumbnail?.fileId),
            deleteGridFs(db, "media_previews", asset.preview?.fileId),
          ]);
          await db.collection("media_assets").updateOne(
            { _id: asset._id },
            {
              $unset: { thumbnail: "", preview: "" },
              $set: { updatedAt: new Date() },
            },
          );
        } else if (input.target === "analysis") {
          await db.collection("media_visual_descriptions").deleteMany({
            assetId: asset._id,
          });
          await db.collection("media_ocr_pages").deleteMany({
            assetId: asset._id,
          });
          await db.collection("media_annotations").deleteMany({
            assetId: asset._id,
          });
          await db.collection<any>("media_analysis_runs").updateMany(
            { assetId: asset._id },
            { $set: { state: "deleted", deletedAt: new Date() } },
          );
          await db.collection("media_assets").updateOne(
            { _id: asset._id },
            {
              $unset: { currentRunId: "" },
              $set: { status: "staged", updatedAt: new Date() },
            },
          );
        } else {
          await db.collection("media_assets").updateOne(
            { _id: asset._id },
            { $unset: { source: "" }, $set: { updatedAt: new Date() } },
          );
        }
        return { success: true };
      }
    }
  }
}
