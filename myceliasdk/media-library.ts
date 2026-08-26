import { z } from "zod";
import { zMediaAnalysisStatus, zMediaRecognitionTask } from "./media.ts";
import { zDateOrString, zObjectId } from "./zod-json-schema.ts";

export const zMediaFolderCampaignStatus = z.enum([
  "queued",
  "scanning",
  "preview_ready",
  "importing",
  "completed",
  "completed_with_errors",
  "failed",
  "cancelled",
]);

export const zMediaRecognitionBatchStatus = z.enum([
  "queued",
  "running",
  "paused",
  "completed",
  "completed_with_errors",
  "cancelled",
]);

export const zMediaBatchCounts = z.object({
  total: z.number().int().nonnegative().default(0),
  pending: z.number().int().nonnegative().default(0),
  queued: z.number().int().nonnegative().default(0),
  processing: z.number().int().nonnegative().default(0),
  ready: z.number().int().nonnegative().default(0),
  imported: z.number().int().nonnegative().default(0),
  duplicate: z.number().int().nonnegative().default(0),
  unsupported: z.number().int().nonnegative().default(0),
  changed: z.number().int().nonnegative().default(0),
  skipped: z.number().int().nonnegative().default(0),
  failed: z.number().int().nonnegative().default(0),
  cancelled: z.number().int().nonnegative().default(0),
}).partial().default({});

export const zMediaFolderCampaignProgress = z.object({
  stage: z.enum([
    "inventory",
    "metadata_scan",
    "awaiting_confirmation",
    "creating_previews",
    "completed",
    "failed",
    "cancelled",
  ]),
  processed: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  remaining: z.number().int().nonnegative(),
  percent: z.number().min(0).max(100),
  filesPerSecond: z.number().nonnegative().optional(),
  etaSeconds: z.number().int().nonnegative().optional(),
  waitingForRecovery: z.boolean().optional(),
  chunkSize: z.number().int().positive(),
  message: z.string().min(1),
  nextStep: z.string().min(1),
  startedAt: zDateOrString().optional(),
  lastProgressAt: zDateOrString().optional(),
});

export const zMediaSourceFolderListing = z.object({
  currentPath: z.string().min(1),
  parentPath: z.string().min(1).optional(),
  folders: z.array(z.object({
    name: z.string().min(1),
    relativePath: z.string().min(1),
  })),
});

export const zMediaFolderCampaign = z.object({
  _id: zObjectId(),
  owner: z.string().min(1),
  relativePath: z.string().min(1),
  status: zMediaFolderCampaignStatus,
  counts: zMediaBatchCounts,
  progress: zMediaFolderCampaignProgress.optional(),
  safeError: z.string().optional(),
  createdAt: zDateOrString(),
  updatedAt: zDateOrString(),
  completedAt: zDateOrString().optional(),
});

export const zMediaRecognitionBatch = z.object({
  _id: zObjectId(),
  owner: z.string().min(1),
  status: zMediaRecognitionBatchStatus,
  profileId: z.string().min(1),
  profileName: z.string().min(1),
  requestedTasks: z.array(zMediaRecognitionTask).min(1),
  authorizedGrossUsd: z.number().nonnegative(),
  counts: zMediaBatchCounts,
  cancelRequestedAt: zDateOrString().optional(),
  createdAt: zDateOrString(),
  updatedAt: zDateOrString(),
  completedAt: zDateOrString().optional(),
});

export const zMediaTimelineItem = z.object({
  assetId: zObjectId(),
  capturedAt: zDateOrString(),
  fileName: z.string(),
  status: zMediaAnalysisStatus,
  thumbnailUrl: z.string().optional(),
  shortCaption: z.string().optional(),
  location: z.object({
    latitude: z.number(),
    longitude: z.number(),
  }).optional(),
});

export const zMediaMapItem = z.object({
  assetId: zObjectId(),
  fileName: z.string(),
  status: zMediaAnalysisStatus,
  latitude: z.number(),
  longitude: z.number(),
  capturedAt: zDateOrString().optional(),
  thumbnailUrl: z.string().optional(),
  shortCaption: z.string().optional(),
});

export type MediaFolderCampaign = z.infer<typeof zMediaFolderCampaign>;
export type MediaFolderCampaignProgress = z.infer<
  typeof zMediaFolderCampaignProgress
>;
export type MediaSourceFolderListing = z.infer<
  typeof zMediaSourceFolderListing
>;
export type MediaRecognitionBatch = z.infer<typeof zMediaRecognitionBatch>;
export type MediaTimelineItem = z.infer<typeof zMediaTimelineItem>;
export type MediaMapItem = z.infer<typeof zMediaMapItem>;
