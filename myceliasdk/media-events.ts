import { z } from "zod";
import { zDateOrString, zObjectId } from "./zod-json-schema.ts";

const zEvidenceRef = z.string().trim().min(1).max(120);
const zConfidence = z.number().min(0).max(1);

export const zMediaEventType = z.enum([
  "trip",
  "meeting",
  "walk",
  "concert",
  "work_session",
  "meal",
  "celebration",
  "sports",
  "nature",
  "other",
  "unknown",
]);

export const zMediaEventPlaceKind = z.enum([
  "home",
  "office",
  "street",
  "park",
  "venue",
  "restaurant",
  "transport",
  "nature",
  "other",
  "unknown",
]);

export const zMediaEventParticipantRole = z.enum([
  "participants",
  "audience",
  "performers",
  "speakers",
  "staff",
  "bystanders",
  "unknown",
]);

const zVisibleCountRange = z.object({
  min: z.number().int().min(0).max(10_000),
  max: z.number().int().min(0).max(10_000),
}).strict().refine((range) => range.min <= range.max, {
  message: "Visible people range minimum must not exceed maximum",
});

/**
 * Provider-neutral, privacy-preserving understanding of a group of previews.
 * Evidence refs are ephemeral manifest refs; the server resolves them to
 * owner-scoped asset IDs before persisting highlights or relationships.
 */
export const zMediaEventUnderstanding = z.object({
  schemaVersion: z.literal("mycelia.media-event-output.v1"),
  title: z.string().trim().min(1).max(240),
  eventType: zMediaEventType,
  description: z.string().trim().min(1).max(8_000),
  temporalLabel: z.string().trim().min(1).max(240),
  place: z.object({
    kind: zMediaEventPlaceKind,
    visualSummary: z.string().trim().min(1).max(1_000),
    confidence: zConfidence,
    evidenceRefs: z.array(zEvidenceRef).max(16),
  }).strict(),
  participants: z.object({
    visiblePeopleRange: zVisibleCountRange,
    groups: z.array(
      z.object({
        role: zMediaEventParticipantRole,
        visibleCountRange: zVisibleCountRange,
        evidenceRefs: z.array(zEvidenceRef).max(16),
        confidence: zConfidence,
      }).strict(),
    ).max(30),
  }).strict(),
  keyActions: z.array(
    z.object({
      text: z.string().trim().min(1).max(500),
      evidenceRefs: z.array(zEvidenceRef).max(16),
      confidence: zConfidence,
    }).strict(),
  ).max(40),
  highlights: z.array(
    z.object({
      ref: zEvidenceRef,
      rank: z.number().int().min(1).max(100),
      reason: z.string().trim().min(1).max(500),
      confidence: zConfidence,
    }).strict(),
  ).max(16),
  keywords: z.array(z.string().trim().min(1).max(120)).max(80),
  confidence: zConfidence,
  warnings: z.array(z.string().trim().min(1).max(500)).max(30),
}).strict();

export const zMediaEventStatus = z.enum([
  "clustered",
  "queued",
  "processing",
  "ready",
  "failed",
  "budget_blocked",
  "recognition_disabled",
  "stale",
]);

export const zMediaEventRunState = z.enum([
  "pending",
  "building",
  "ready",
  "failed",
  "provider_outcome_unknown",
]);

export const zMediaEventCoordinate = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
}).strict();

export const zMediaEvent = z.object({
  _id: zObjectId(),
  owner: z.string().trim().min(1).max(512),
  stableKey: z.string().trim().min(1).max(512),
  status: zMediaEventStatus,
  assetIds: z.array(zObjectId()).min(2).max(500),
  startAt: zDateOrString(),
  endAt: zDateOrString(),
  centroid: zMediaEventCoordinate.optional(),
  representativeAssetIds: z.array(zObjectId()).min(1).max(32),
  analysis: zMediaEventUnderstanding.optional(),
  currentRunId: z.string().trim().min(1).max(512).optional(),
  jobId: zObjectId().optional(),
  objectId: zObjectId().optional(),
  publishedRunId: z.string().trim().min(1).max(512).optional(),
  deletionGeneration: z.number().int().nonnegative().optional(),
  deletionTombstoneId: z.string().length(64).optional(),
  providerDeletionPending: z.object({
    id: z.string().trim().min(1).max(512),
    assetId: zObjectId(),
    startedAt: zDateOrString(),
  }).strict().optional(),
  providerCallPermit: z.object({
    id: z.string().trim().min(1).max(512),
    runId: z.string().trim().min(1).max(512),
    jobId: z.string().trim().min(1).max(512),
    deletionGeneration: z.number().int().nonnegative(),
    acquiredAt: zDateOrString(),
    leaseExpiresAt: zDateOrString(),
  }).strict().optional(),
  publicationClaimId: z.string().trim().min(1).max(512).optional(),
  publicationLeaseExpiresAt: zDateOrString().optional(),
  publicationReview: z.object({
    runId: z.string().trim().min(1).max(512),
    principal: z.string().trim().min(1).max(512),
    reviewedSensitiveText: z.literal(true),
    reviewedAt: zDateOrString(),
  }).strict().optional(),
  providerSnapshot: z.record(z.string(), z.unknown()).optional(),
  profileFingerprint: z.string().trim().min(1).max(128).optional(),
  consentReceiptId: z.string().trim().min(1).max(512).optional(),
  consentReceipt: z.object({
    id: z.string().trim().min(1).max(512),
    hash: z.string().length(64),
    principal: z.string().trim().min(1).max(512),
    groupStableKey: z.string().trim().min(1).max(512),
    assetIds: z.array(zObjectId()).min(2).max(500),
    sourceHashes: z.array(z.string().length(64)).min(2).max(500),
    representativeAssetIds: z.array(zObjectId()).min(2).max(32),
    providerSnapshot: z.record(z.string(), z.unknown()).nullable(),
    profileFingerprint: z.string().trim().min(1).max(128).nullable(),
    privacyVersion: z.literal("preview-only-no-identity-v1"),
    costCeilingUsd: z.number().nonnegative().max(10),
    queueAnalysis: z.boolean(),
    confirmedAt: zDateOrString(),
  }).strict().optional(),
  sourceHashes: z.array(z.string().length(64)).max(500).optional(),
  previewSnapshots: z.array(
    z.object({
      assetId: zObjectId(),
      sha256: z.string().length(64),
      previewFileId: zObjectId(),
      thumbnailFileId: zObjectId().optional(),
    }).strict(),
  ).max(32).optional(),
  estimatedGrossUsd: z.number().nonnegative().max(10).optional(),
  safeError: z.string().trim().min(1).max(1_000).optional(),
  linkWarning: z.string().trim().min(1).max(1_000).optional(),
  createdAt: zDateOrString(),
  updatedAt: zDateOrString(),
}).strict().superRefine((event, context) => {
  if (event.startAt > event.endAt) {
    context.addIssue({
      code: "custom",
      message: "Media event startAt must not be after endAt",
      path: ["endAt"],
    });
  }
  const assetIds = new Set(event.assetIds.map((id) => id.toHexString()));
  if (
    event.representativeAssetIds.some((id) => !assetIds.has(id.toHexString()))
  ) {
    context.addIssue({
      code: "custom",
      message: "Representative assets must belong to the media event",
      path: ["representativeAssetIds"],
    });
  }
  if (
    event.sourceHashes && event.sourceHashes.length !== event.assetIds.length
  ) {
    context.addIssue({
      code: "custom",
      message: "Source hashes must align one-to-one with event assets",
      path: ["sourceHashes"],
    });
  }
});

export const zMediaEventLinkTargetType = z.enum([
  "audio_source",
  "transcription",
  "object",
]);

export const zMediaEventLinkStatus = z.enum([
  "suggested",
  "confirmed",
  "dismissed",
]);

export const zMediaEventLinkRelation = z.enum([
  "temporal_overlap",
  "semantic",
  "manual",
]);

export const zMediaEventLink = z.object({
  _id: zObjectId(),
  owner: z.string().trim().min(1).max(512),
  linkKey: z.string().trim().min(1).max(512),
  eventId: zObjectId(),
  targetType: zMediaEventLinkTargetType,
  targetId: zObjectId(),
  status: zMediaEventLinkStatus,
  relation: zMediaEventLinkRelation,
  overlap: z.object({
    startAt: zDateOrString(),
    endAt: zDateOrString(),
    seconds: z.number().nonnegative(),
  }).strict().optional(),
  confidence: zConfidence,
  reason: z.string().trim().min(1).max(1_000).optional(),
  createdAt: zDateOrString(),
  updatedAt: zDateOrString(),
}).strict();

export const zMediaEventRun = z.object({
  _id: z.string().trim().min(1).max(512),
  owner: z.string().trim().min(1).max(512),
  eventId: zObjectId(),
  runKey: z.string().trim().min(1).max(512),
  state: zMediaEventRunState,
  profileId: z.string().trim().min(1).max(240),
  representativeAssetIds: z.array(zObjectId()).min(1).max(32),
  sourceHashes: z.array(z.string().length(64)).max(500).optional(),
  profileFingerprint: z.string().trim().min(1).max(128).optional(),
  providerSnapshot: z.record(z.string(), z.unknown()).optional(),
  consentReceiptId: z.string().trim().min(1).max(512).optional(),
  deletionGeneration: z.number().int().nonnegative().optional(),
  retryNonce: z.string().trim().min(1).max(512).optional(),
  estimatedGrossUsd: z.number().nonnegative().max(10).optional(),
  attemptId: z.string().trim().min(1).max(512).optional(),
  jobId: z.string().trim().min(1).max(512).optional(),
  executionClaim: z.object({
    id: z.string().trim().min(1).max(512),
    jobId: z.string().trim().min(1).max(512),
    phase: z.enum(["claimed", "started", "outcome_unknown"]),
    claimedAt: zDateOrString(),
    leaseExpiresAt: zDateOrString(),
    providerStartedAt: zDateOrString().optional(),
    outcomeUnknownAt: zDateOrString().optional(),
  }).strict().optional(),
  analysis: zMediaEventUnderstanding.optional(),
  provenance: z.object({
    providerType: z.enum(["google-cloud", "self-hosted"]),
    providerProfileId: z.string().trim().min(1).max(240),
    service: z.string().trim().min(1).max(240),
    location: z.string().trim().min(1).max(240),
    modelVersion: z.string().trim().min(1).max(240).optional(),
    responseId: z.string().trim().min(1).max(512).optional(),
    processedAt: z.string().datetime(),
    promptVersion: z.string().trim().min(1).max(120),
    privacyVersion: z.string().trim().min(1).max(120),
  }).strict().optional(),
  usage: z.object({
    service: z.enum(["google-cloud", "self-hosted"]),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    reasoningTokens: z.number().int().nonnegative(),
    grossListPriceUsd: z.number().nonnegative().max(10),
  }).strict().optional(),
  settlementPending: z.object({
    target: z.enum(["committed", "released", "unknown"]),
    requestedAt: zDateOrString(),
    attempts: z.number().int().positive(),
    lastError: z.string().trim().min(1).max(1_000),
    lastAttemptAt: zDateOrString().optional(),
  }).strict().optional(),
  budgetSettlementState: z.enum([
    "committed",
    "released",
    "unknown",
    "not_applicable",
  ]).optional(),
  invalidatedAt: zDateOrString().optional(),
  invalidationReason: z.string().trim().min(1).max(1_000).optional(),
  safeError: z.string().trim().min(1).max(1_000).optional(),
  createdAt: zDateOrString(),
  updatedAt: zDateOrString(),
  completedAt: zDateOrString().optional(),
}).strict();

export type MediaEventUnderstanding = z.infer<
  typeof zMediaEventUnderstanding
>;
export type MediaEvent = z.infer<typeof zMediaEvent>;
export type MediaEventLink = z.infer<typeof zMediaEventLink>;
export type MediaEventRun = z.infer<typeof zMediaEventRun>;
export type MediaEventStatus = z.infer<typeof zMediaEventStatus>;
export type MediaEventRunState = z.infer<typeof zMediaEventRunState>;
export type MediaEventType = z.infer<typeof zMediaEventType>;
export type MediaEventCoordinate = z.infer<typeof zMediaEventCoordinate>;
export type MediaEventLinkTargetType = z.infer<
  typeof zMediaEventLinkTargetType
>;
export type MediaEventLinkStatus = z.infer<typeof zMediaEventLinkStatus>;
export type MediaEventLinkRelation = z.infer<typeof zMediaEventLinkRelation>;
