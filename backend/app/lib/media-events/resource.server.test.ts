import {
  assertEquals,
  assertRejects,
  assertThrows,
} from "jsr:@std/assert@^1.0.15";
import { ObjectId } from "mongodb";
import { createHash } from "node:crypto";
import { Auth } from "@/lib/auth/core.server.ts";
import { ResourceManager } from "@/lib/auth/resources.ts";
import { withFixtures } from "@/tests/fixtures.server.ts";
import {
  acquireMediaEventProviderCallPermit,
  buildConsentReceipt,
  enqueueMediaEvent,
  ensureCanonicalEvent,
  ephemeralMediaEventPreviewRef,
  fenceMediaAssetDerivedDeletion,
  invalidateMediaEventsForAsset,
  loadEventCandidateAssets,
  mediaEventJobId,
  mediaEventPreviewGroupResponse,
  mediaEventRequestSchema,
  MediaEventsResource,
  neutralizeMediaEventMarkdown,
  persistImmutableConsentReceipt,
  prepareAggregationPreviewResponse,
  publishCanonicalEventObject,
  reconcileExpiredMediaEventRuns,
  recoverPreProviderMediaEventCrash,
  releaseMediaEventProviderCallPermit,
  renewMediaEventProviderCallPermit,
  reserveEventMemberships,
  resolveMediaEventEvidenceRefs,
  reviewAndPublishMediaEvent,
} from "./resource.server.ts";
import {
  analyzeWithMediaEventProvider,
  buildGoogleMediaEventRequest,
} from "./provider.server.ts";

const understanding = {
  schemaVersion: "mycelia.media-event-output.v1" as const,
  title: "Прогулка в парке",
  eventType: "walk" as const,
  description: "Несколько кадров одной прогулки.",
  temporalLabel: "Вечером",
  place: {
    kind: "park" as const,
    visualSummary: "Городской парк",
    confidence: 0.9,
    evidenceRefs: ["preview-1"],
  },
  participants: {
    visiblePeopleRange: { min: 1, max: 3 },
    groups: [],
  },
  keyActions: [],
  highlights: [{
    ref: "preview-1",
    rank: 1,
    reason: "Лучше всего передаёт атмосферу",
    confidence: 0.85,
  }],
  keywords: ["парк"],
  confidence: 0.88,
  warnings: [],
};

async function insertCanonicalEventAssets(
  db: any,
  owner: string,
  ids: ObjectId[],
) {
  const assets = ids.map((id, index) => ({
    _id: id,
    owner,
    kind: "image",
    fileName: `${index}.jpg`,
    sha256: String(index + 1).repeat(64),
    capturedAt: new Date(Date.UTC(2026, 7, 20, 12, index)),
    preview: { fileId: new ObjectId() },
  }));
  await db.collection("media_assets").insertMany(assets);
  await db.collection("media_previews.files").insertMany(
    assets.map((asset) => ({
      _id: asset.preview.fileId,
      length: 1,
      metadata: {
        state: "canonical",
        assetId: asset._id,
        sha256: asset.sha256,
        role: "preview",
      },
    })),
  );
  return assets;
}

function testMembershipId(owner: string, assetId: ObjectId) {
  return new ObjectId(
    createHash("sha256").update(
      ["media-event-membership-v1", owner, String(assetId)].join("\0"),
    ).digest("hex").slice(0, 24),
  );
}

async function insertActiveEventMembership(
  db: any,
  owner: string,
  eventId: ObjectId,
  assetId: ObjectId,
  receiptId = "test-receipt",
) {
  await db.collection("media_event_memberships").updateOne(
    { _id: testMembershipId(owner, assetId) },
    {
      $setOnInsert: {
        owner,
        eventId,
        assetId,
        receiptId,
        status: "active",
        createdAt: new Date(),
      },
    },
    { upsert: true },
  );
}

async function fenceAndInvalidateEventAsset(
  db: any,
  owner: string,
  eventId: ObjectId,
  assetId: ObjectId,
) {
  await insertActiveEventMembership(db, owner, eventId, assetId);
  await fenceMediaAssetDerivedDeletion(db, owner, assetId);
  return await invalidateMediaEventsForAsset(db, owner, assetId);
}

Deno.test("media event actions require bounded inputs and explicit consent", () => {
  const previewId = new ObjectId().toString();
  assertThrows(() =>
    mediaEventRequestSchema.parse({
      action: "confirmAggregation",
      previewId,
      selectedGroupIndexes: [0],
      consent: false,
    })
  );
  assertThrows(() =>
    mediaEventRequestSchema.parse({
      action: "previewAggregation",
      assetIds: [previewId, previewId],
    })
  );
  assertThrows(() =>
    mediaEventRequestSchema.parse({
      action: "confirmAggregation",
      previewId,
      selectedGroupIndexes: [0, 0],
      consent: true,
    })
  );
  const parsed = mediaEventRequestSchema.parse({
    action: "previewAggregation",
    maxGapMinutes: 60,
    maxDistanceKm: 5,
    limit: 200,
  });
  if (parsed.action !== "previewAggregation") {
    throw new Error("expected preview aggregation input");
  }
  assertEquals(parsed.maxGapMinutes, 60);
  assertEquals(parsed.maxDistanceKm, 5);
  assertEquals(parsed.limit, 200);
  const localOnly = mediaEventRequestSchema.parse({
    action: "confirmAggregation",
    previewId,
    selectedGroupIndexes: [0],
    consent: true,
  });
  if (localOnly.action !== "confirmAggregation") {
    throw new Error("expected confirmation input");
  }
  assertEquals(localOnly.queueAnalysis, false);
  assertThrows(() =>
    mediaEventRequestSchema.parse({
      action: "retry",
      eventId: previewId,
    })
  );
});

Deno.test("preview disclosure identifies every exact provider frame", () => {
  const ids = [new ObjectId(), new ObjectId(), new ObjectId()];
  const assets = new Map(ids.map((id, index) => [String(id), {
    _id: id,
    fileName: `photo-${index}.jpg`,
    capturedAt: new Date(1_000 * index),
    thumbnail: { fileId: new ObjectId() },
  }]));
  const response = mediaEventPreviewGroupResponse({
    stableKey: "stable",
    startAt: new Date(0),
    endAt: new Date(2_000),
    assetIds: ids,
    sourceHashes: ids.map(() => "a".repeat(64)),
    representativeAssetIds: [ids[0], ids[2]],
    previewSnapshots: [],
    estimatedGrossUsd: 0.02,
  }, assets);
  assertEquals(response.assets.map((asset) => asset.assetId), ids);
  assertEquals(
    response.providerAssets.map((asset) => asset.assetId),
    [ids[0], ids[2]],
  );
});

Deno.test(
  "aggregation skips null-time legacy previews and exposes an eligible singleton",
  withFixtures(["Mongo"], async ({ db }) => {
    const owner = "media-ui-smoke";
    const legacyId = new ObjectId();
    const modernId = new ObjectId();
    const legacyFileId = new ObjectId();
    const modernFileId = new ObjectId();
    const importId = new ObjectId();
    const legacySha = "a".repeat(64);
    const modernSha = "b".repeat(64);
    await db.collection("media_assets").insertMany([
      {
        _id: legacyId,
        owner,
        kind: "image",
        fileName: "legacy.jpg",
        sha256: legacySha,
        capturedAt: null,
        preview: { fileId: legacyFileId },
      },
      {
        _id: modernId,
        owner,
        kind: "image",
        fileName: "modern.jpg",
        sha256: modernSha,
        capturedAt: new Date("2026-08-22T08:01:00.000Z"),
        preview: { fileId: modernFileId },
      },
    ]);
    await db.collection("media_previews.files").insertMany([
      {
        _id: legacyFileId,
        length: 128,
        // Exact live legacy shape: no state, assetId, owner or confirmedAt.
        metadata: {
          importId,
          sha256: legacySha,
          role: "preview",
        },
      },
      {
        _id: modernFileId,
        length: 128,
        metadata: {
          state: "canonical",
          assetId: modernId,
          owner,
          sha256: modernSha,
          role: "preview",
        },
      },
    ]);
    const auth = new Auth({ principal: owner, policies: [] });
    const config = {
      enabled: false,
      profiles: [],
      eventAggregation: {
        maxGapMinutes: 240,
        maxDistanceKm: 25,
        linkWindowMinutes: 90,
        maxAssetsPerEvent: 50,
        maxPreviewsPerAnalysis: 8,
        perEventGrossLimitUsd: 0.02,
      },
    } as any;

    const automatic = await prepareAggregationPreviewResponse(
      db,
      auth,
      { action: "previewAggregation", limit: 200 },
      config,
    );
    assertEquals(automatic instanceof Response, false);
    assertEquals((automatic as any).groups, []);
    assertEquals((automatic as any).eligibleAssetCount, 1);
    assertEquals((automatic as any).groupedAssetCount, 0);
    assertEquals(
      (automatic as any).singletons.map((asset: any) => String(asset.assetId)),
      [String(modernId)],
    );

    const explicit = await prepareAggregationPreviewResponse(
      db,
      auth,
      {
        action: "previewAggregation",
        assetIds: [String(legacyId), String(modernId)],
        limit: 200,
      },
      config,
    );
    assertEquals(explicit instanceof Response, true);
    assertEquals((explicit as Response).status, 400);

    // A legacy preview with a real time remains compatible when its immutable
    // sha/role match and no other owner's asset points at the GridFS file.
    await db.collection("media_assets").updateOne(
      { _id: legacyId, owner },
      { $set: { capturedAt: new Date("2026-08-22T08:00:00.000Z") } },
    );
    assertEquals(
      (await loadEventCandidateAssets(db, owner, [
        String(legacyId),
        String(modernId),
      ])).map((asset) => String(asset._id)),
      [String(legacyId), String(modernId)],
    );

    await db.collection("media_assets").insertOne({
      _id: new ObjectId(),
      owner: "another-owner",
      kind: "image",
      sha256: legacySha,
      capturedAt: new Date("2026-08-22T08:00:00.000Z"),
      preview: { fileId: legacyFileId },
    });
    await assertRejects(
      () =>
        loadEventCandidateAssets(db, owner, [
          String(legacyId),
          String(modernId),
        ]),
      Error,
      "canonical sanitized preview",
    );
  }),
);

Deno.test("provider manifests contain only ephemeral refs, never durable ids", () => {
  const durableAssetId = new ObjectId().toString();
  const durableSha = "a".repeat(64);
  const sourcePath = "/private/photo.jpg";
  const ref = ephemeralMediaEventPreviewRef(0);
  const request = buildGoogleMediaEventRequest({
    profile: {
      id: "google-events",
      name: "Google events",
      providerType: "google-cloud",
      enabled: true,
      concurrency: 1,
      projectId: "media-event-test-project",
      location: "eu",
      vertexModel: "gemini-3.5-flash-lite",
      embeddingModel: "gemini-embedding-001",
      embeddingLocation: "europe-west4",
      documentAiProcessorVersion: "pretrained-ocr-v2.1-2024-08-07",
      allowGlobalPhotoAnalysis: false,
    },
    requestId: "ephemeral-request",
    previews: [{
      ref,
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: "image/webp",
      width: 10,
      height: 10,
      offsetSeconds: 0,
    }],
    totalAssetCount: 2,
    durationSeconds: 60,
  });
  const serialized = JSON.stringify(request);
  assertEquals(serialized.includes(ref), true);
  assertEquals(serialized.includes(durableAssetId), false);
  assertEquals(serialized.includes(durableSha), false);
  assertEquals(serialized.includes(sourcePath), false);

  const resolved = resolveMediaEventEvidenceRefs(
    understanding,
    new Map([
      ["preview-1", durableAssetId],
    ]),
  );
  assertEquals(resolved.place.evidenceRefs, [durableAssetId]);
  assertEquals(resolved.highlights[0].ref, durableAssetId);
});

Deno.test(
  "publishing a ready event is owner-safe and idempotent",
  withFixtures(["Mongo"], async ({ db }) => {
    const eventId = new ObjectId();
    const assetIds = [new ObjectId(), new ObjectId()];
    const runId = "ready-media-event-run";
    const now = new Date("2026-08-22T12:00:00.000Z");
    const adversarialUnderstanding = {
      ...understanding,
      description:
        "Tracker ![pixel](https://tracker.example/p.gif) <img src=x>",
      keyActions: [{
        text: "Open [link](https://tracker.example/click)",
        evidenceRefs: [],
        confidence: 0.7,
      }],
    };
    const event = {
      _id: eventId,
      owner: "admin",
      stableKey: "media-event-v1:stable",
      status: "ready",
      deletionGeneration: 0,
      consentReceiptId: "ready-publish-receipt",
      assetIds,
      startAt: now,
      endAt: new Date(now.getTime() + 3_600_000),
      representativeAssetIds: [assetIds[0], assetIds[1]],
      analysis: adversarialUnderstanding,
      currentRunId: runId,
      publicationReview: {
        runId,
        principal: "admin",
        reviewedSensitiveText: true,
        reviewedAt: now,
      },
      createdAt: now,
      updatedAt: now,
    };
    await db.collection("media_events").insertOne(event);
    await db.collection("media_event_runs").insertOne({
      _id: runId,
      eventId,
      owner: "admin",
      state: "ready",
      deletionGeneration: 0,
      consentReceiptId: "ready-publish-receipt",
      analysis: adversarialUnderstanding,
      provenance: {
        providerType: "self-hosted",
        privacyVersion: "preview-only-no-identity-v1",
      },
    });

    const first = await publishCanonicalEventObject(
      db,
      event,
      () => Promise.resolve(),
    );
    const second = await publishCanonicalEventObject(
      db,
      event,
      () => Promise.resolve(),
    );
    assertEquals(first, second);
    assertEquals(
      await db.collection("objects").countDocuments({
        "metadata.mediaEvent.eventId": String(eventId),
      }),
      1,
    );
    const object = await db.collection("objects").findOne({ _id: first });
    assertEquals(object?._listCategories, ["event"]);
    assertEquals(object?.isEvent, true);
    assertEquals(object?.timeRanges?.[0]?.start, now);
    assertEquals(String(object?.details).includes("!["), false);
    assertEquals(String(object?.details).includes("]("), false);
    assertEquals(String(object?.details).includes("<img"), false);
    assertEquals(String(object?.details).includes("https://"), false);

    await db.collection("objects").updateOne(
      { _id: first },
      { $set: { name: "User title", details: "User-edited details" } },
    );
    await publishCanonicalEventObject(db, event, () => Promise.resolve());
    const preserved = await db.collection("objects").findOne({ _id: first });
    assertEquals(preserved?.name, "User title");
    assertEquals(preserved?.details, "User-edited details");

    await assertRejects(
      () =>
        publishCanonicalEventObject(
          db,
          { ...event, owner: "another-owner" },
          () => Promise.resolve(),
        ),
      Error,
      "restricted to the admin owner",
    );
  }),
);

Deno.test("provider-derived Object text is neutralized for Markdown sinks", () => {
  const escaped = neutralizeMediaEventMarkdown(
    "![pixel](https://tracker.example/p) <script> data://payload",
  );
  assertEquals(escaped.includes("!["), false);
  assertEquals(escaped.includes("]("), false);
  assertEquals(escaped.includes("https://"), false);
  assertEquals(escaped.includes("<script>"), false);
});

Deno.test(
  "invalidation between Object write and final event CAS leaves a stale Object",
  withFixtures(["Mongo"], async ({ db }) => {
    const owner = "admin";
    const eventId = new ObjectId();
    const assetIds = [new ObjectId(), new ObjectId()];
    const runId = "publish-invalidation-run";
    const now = new Date("2026-08-22T12:00:00.000Z");
    const event = {
      _id: eventId,
      owner,
      stableKey: "publish-invalidation-stable",
      status: "ready",
      deletionGeneration: 0,
      consentReceiptId: "publish-invalidation-receipt",
      assetIds,
      startAt: now,
      endAt: new Date(now.getTime() + 60_000),
      representativeAssetIds: assetIds,
      analysis: understanding,
      currentRunId: runId,
      publicationReview: {
        runId,
        principal: owner,
        reviewedSensitiveText: true,
        reviewedAt: now,
      },
      createdAt: now,
      updatedAt: now,
    };
    await db.collection("media_events").insertOne(event);
    await db.collection("media_event_runs").insertOne({
      _id: runId,
      eventId,
      owner,
      state: "ready",
      deletionGeneration: 0,
      consentReceiptId: "publish-invalidation-receipt",
      analysis: understanding,
      provenance: {
        providerType: "self-hosted",
        privacyVersion: "preview-only-no-identity-v1",
      },
    });
    await assertRejects(
      () =>
        publishCanonicalEventObject(
          db,
          event,
          () => Promise.resolve(),
          async () => {
            await fenceAndInvalidateEventAsset(
              db,
              owner,
              eventId,
              assetIds[0],
            );
          },
        ),
      Error,
      "changed before publication completed",
    );
    const object = await db.collection("objects").findOne({
      "metadata.mediaEvent.eventId": String(eventId),
    });
    assertEquals(object?.metadata?.mediaEvent?.stale, true);
    assertEquals(
      (await db.collection("media_events").findOne({ _id: eventId }))?.status,
      "stale",
    );
  }),
);

Deno.test(
  "invalidation tombstone cannot be cleared while republishing an existing Object",
  withFixtures(["Mongo"], async ({ db }) => {
    const owner = "admin";
    const eventId = new ObjectId();
    const assetIds = [new ObjectId(), new ObjectId()];
    const now = new Date("2026-08-22T12:00:00.000Z");
    const firstRunId = "existing-object-first-run";
    const secondRunId = "existing-object-second-run";
    const event = {
      _id: eventId,
      owner,
      stableKey: "existing-object-invalidation-stable",
      status: "ready",
      deletionGeneration: 0,
      consentReceiptId: "existing-object-first-receipt",
      assetIds,
      startAt: now,
      endAt: new Date(now.getTime() + 60_000),
      representativeAssetIds: assetIds,
      analysis: understanding,
      currentRunId: firstRunId,
      publicationReview: {
        runId: firstRunId,
        principal: owner,
        reviewedSensitiveText: true,
        reviewedAt: now,
      },
      createdAt: now,
      updatedAt: now,
    };
    await db.collection("media_events").insertOne(event);
    await db.collection("media_event_runs").insertOne({
      _id: firstRunId,
      eventId,
      owner,
      state: "ready",
      deletionGeneration: 0,
      consentReceiptId: event.consentReceiptId,
      analysis: understanding,
      provenance: { providerType: "self-hosted" },
    });
    const objectId = await publishCanonicalEventObject(
      db,
      event,
      () => Promise.resolve(),
    );
    const secondReceipt = "existing-object-second-receipt";
    const secondEvent = {
      ...event,
      currentRunId: secondRunId,
      consentReceiptId: secondReceipt,
      publicationReview: {
        runId: secondRunId,
        principal: owner,
        reviewedSensitiveText: true,
        reviewedAt: now,
      },
    };
    await db.collection("media_events").updateOne(
      { _id: eventId },
      {
        $set: {
          currentRunId: secondRunId,
          consentReceiptId: secondReceipt,
          publicationReview: secondEvent.publicationReview,
        },
      },
    );
    await db.collection("media_event_runs").insertOne({
      _id: secondRunId,
      eventId,
      owner,
      state: "ready",
      deletionGeneration: 0,
      consentReceiptId: secondReceipt,
      analysis: understanding,
      provenance: { providerType: "self-hosted" },
    });
    await assertRejects(
      () =>
        publishCanonicalEventObject(
          db,
          secondEvent,
          () => Promise.resolve(),
          async () => {
            await fenceAndInvalidateEventAsset(
              db,
              owner,
              eventId,
              assetIds[0],
            );
          },
        ),
      Error,
      "changed before publication completed",
    );
    const object = await db.collection("objects").findOne({ _id: objectId });
    assertEquals(object?.metadata?.mediaEvent?.stale, true);
    assertEquals(object?.metadata?.mediaEvent?.deletionGeneration, 1);
    assertEquals(object?.metadata?.mediaEvent?.publicationState, "invalidated");
    assertEquals(object?.isEvent, false);
  }),
);

Deno.test(
  "expired publication claim activates only a previously fenced pending Object",
  withFixtures(["Mongo"], async ({ db }) => {
    const owner = "admin";
    const eventId = new ObjectId();
    const assetIds = [new ObjectId(), new ObjectId()];
    const runId = "expired-publication-run";
    const now = new Date("2026-08-22T12:00:00.000Z");
    const publishedObjectId = new ObjectId(
      createHash("sha256").update(
        ["media-event-object-v1", owner, String(eventId)].join("\0"),
      ).digest("hex").slice(0, 24),
    );
    const event = {
      _id: eventId,
      owner,
      stableKey: "expired-publication-stable",
      status: "ready",
      deletionGeneration: 0,
      consentReceiptId: "expired-publication-receipt",
      assetIds,
      startAt: now,
      endAt: new Date(now.getTime() + 60_000),
      representativeAssetIds: assetIds,
      analysis: understanding,
      currentRunId: runId,
      publishedRunId: runId,
      objectId: publishedObjectId,
      publicationClaimId: "expired-claim",
      publicationLeaseExpiresAt: new Date(now.getTime() - 60_000),
      publicationReview: {
        runId,
        principal: owner,
        reviewedSensitiveText: true,
        reviewedAt: now,
      },
      createdAt: now,
      updatedAt: now,
    };
    await db.collection("media_events").insertOne(event);
    await db.collection("media_event_runs").insertOne({
      _id: runId,
      eventId,
      owner,
      state: "ready",
      deletionGeneration: 0,
      consentReceiptId: "expired-publication-receipt",
      analysis: understanding,
      provenance: {
        providerType: "self-hosted",
        privacyVersion: "preview-only-no-identity-v1",
      },
    });
    await db.collection("media_event_publication_claims").insertOne({
      _id: eventId,
      owner,
      runId,
      deletionGeneration: 0,
      state: "publishing",
      claimId: "expired-claim",
      leaseExpiresAt: new Date(Date.now() - 60_000),
    });
    await db.collection("objects").insertOne({
      _id: publishedObjectId,
      name: understanding.title,
      details: understanding.description,
      isEvent: false,
      _listCategories: [],
      metadata: {
        mediaEvent: {
          eventId: String(eventId),
          runId,
          latestAnalysisRunId: runId,
          deletionGeneration: 0,
          publicationState: "pending",
          stale: true,
          staleReason: "Publication pending fenced activation",
        },
      },
      version: 1,
    });
    assertEquals(
      await reviewAndPublishMediaEvent(db, owner, eventId, runId),
      publishedObjectId,
    );
    const object = await db.collection("objects").findOne({
      _id: publishedObjectId,
    });
    assertEquals(object?.isEvent, true);
    assertEquals(object?._listCategories, ["event"]);
    assertEquals(object?.metadata?.mediaEvent?.publicationState, "live");
    assertEquals(object?.timeRanges?.[0]?.start, now);
  }),
);

Deno.test(
  "automatic previews choose recent assets that are not already assigned",
  withFixtures(["Mongo"], async ({ db }) => {
    const owner = "candidate-owner";
    const assets = Array.from({ length: 4 }, (_, index) => ({
      _id: new ObjectId(),
      owner,
      kind: "image",
      preview: { fileId: new ObjectId() },
      capturedAt: new Date(`2026-08-2${index + 1}T12:00:00.000Z`),
      fileName: `${index}.jpg`,
      sha256: String(index).repeat(64),
    }));
    await db.collection("media_assets").insertMany(assets);
    await db.collection("media_previews.files").insertMany(
      assets.map((asset) => ({
        _id: asset.preview.fileId,
        length: 128,
        metadata: {
          state: "canonical",
          assetId: asset._id,
          owner,
          sha256: asset.sha256,
          role: "preview",
        },
      })),
    );
    await db.collection("media_events").insertOne({
      _id: new ObjectId(),
      owner,
      status: "ready",
      assetIds: [assets[3]._id],
    });
    const candidates = await loadEventCandidateAssets(
      db,
      owner,
      undefined,
      2,
    );
    assertEquals(
      candidates.map((asset) => asset._id),
      [assets[2]._id, assets[1]._id],
    );
  }),
);

Deno.test(
  "membership reservations reject overlapping confirmations atomically",
  withFixtures(["Mongo"], async ({ db }) => {
    const owner = "membership-owner";
    const firstEvent = new ObjectId();
    const secondEvent = new ObjectId();
    const [a, b, c] = [new ObjectId(), new ObjectId(), new ObjectId()];
    const assets = await insertCanonicalEventAssets(db, owner, [a, b, c]);
    await reserveEventMemberships(
      db,
      owner,
      firstEvent,
      assets.slice(0, 2),
      "receipt-a",
    );
    await assertRejects(
      () =>
        reserveEventMemberships(
          db,
          owner,
          secondEvent,
          [assets[2], assets[1]],
          "receipt-b",
        ),
      Error,
      "already confirmed",
    );
    const memberships = await db.collection("media_event_memberships").find({
      owner,
    }).sort({ assetId: 1 }).toArray();
    assertEquals(memberships.length, 2);
    assertEquals(
      memberships.every((entry: any) =>
        String(entry.eventId) === String(firstEvent)
      ),
      true,
    );
    assertEquals(
      memberships.some((entry: any) => String(entry.assetId) === String(c)),
      false,
    );
  }),
);

Deno.test(
  "derived deletion fence wins against a late event membership reservation",
  withFixtures(["Mongo"], async ({ db }) => {
    const owner = "deletion-fence-owner";
    const eventId = new ObjectId();
    const assetId = new ObjectId();
    const [asset] = await insertCanonicalEventAssets(db, owner, [assetId]);
    await reserveEventMemberships(
      db,
      owner,
      eventId,
      [asset],
      "initial-receipt",
    );
    await db.collection("media_assets").updateOne(
      { _id: assetId, owner },
      {
        $set: {
          derivedDeletionPending: {
            target: "analysis",
            startedAt: new Date(),
          },
        },
      },
    );
    await fenceMediaAssetDerivedDeletion(db, owner, assetId);
    await assertRejects(
      () => loadEventCandidateAssets(db, owner, [String(assetId)]),
      Error,
      "owned photo",
    );
    await assertRejects(
      () =>
        reserveEventMemberships(
          db,
          owner,
          eventId,
          [asset],
          "late-receipt",
        ),
      Error,
      "deletion before reservation",
    );
    await invalidateMediaEventsForAsset(db, owner, assetId);
    const membership = await db.collection("media_event_memberships").findOne({
      assetId,
      owner,
    });
    assertEquals(membership?.status, "deleted");
    await db.collection("media_assets").updateOne(
      { _id: assetId, owner },
      { $unset: { derivedDeletionPending: "" } },
    );
    const [currentAsset] = await loadEventCandidateAssets(
      db,
      owner,
      [String(assetId)],
    );
    await reserveEventMemberships(
      db,
      owner,
      eventId,
      [currentAsset],
      "rebuilt-receipt",
    );
    assertEquals(
      (await db.collection("media_event_memberships").findOne({
        assetId,
        owner,
      }))?.status,
      "reserved",
    );
  }),
);

Deno.test(
  "provider permit and derived deletion fence cannot cross their call boundary",
  withFixtures(["Mongo"], async ({ db }) => {
    const owner = "provider-delete-fence-owner";
    const eventId = new ObjectId();
    const jobId = new ObjectId().toString();
    const receiptId = "provider-delete-receipt";
    const assets = await insertCanonicalEventAssets(
      db,
      owner,
      [new ObjectId(), new ObjectId()],
    );
    await db.collection("media_events").insertOne({
      _id: eventId,
      owner,
      status: "processing",
      deletionGeneration: 0,
      consentReceiptId: receiptId,
      profileFingerprint: "provider-delete-profile",
      jobId: new ObjectId(jobId),
      assetIds: assets.map((asset) => asset._id),
    });
    await insertActiveEventMembership(
      db,
      owner,
      eventId,
      assets[0]._id,
      receiptId,
    );
    const permit = await acquireMediaEventProviderCallPermit(
      db,
      await db.collection("media_events").findOne({ _id: eventId }),
      "provider-delete-run",
      jobId,
    );
    await assertRejects(
      () => fenceMediaAssetDerivedDeletion(db, owner, assets[0]._id),
      Error,
      "currently calling its provider",
    );
    assertEquals(
      (await db.collection("media_event_memberships").findOne({
        owner,
        assetId: assets[0]._id,
      }))?.status,
      "active",
    );
    await releaseMediaEventProviderCallPermit(
      db,
      eventId,
      owner,
      permit.id,
    );
    await fenceMediaAssetDerivedDeletion(db, owner, assets[0]._id);
    await assertRejects(
      async () =>
        acquireMediaEventProviderCallPermit(
          db,
          await db.collection("media_events").findOne({ _id: eventId }),
          "late-provider-run",
          jobId,
        ),
      Error,
      "entered deletion",
    );
  }),
);

Deno.test(
  "deletion during post-renew start fences prevents the later fetch",
  withFixtures(["Mongo"], async ({ db }) => {
    const owner = "expired-provider-permit-owner";
    const eventId = new ObjectId();
    const jobId = new ObjectId().toString();
    const runId = "expired-provider-permit-run";
    const receiptId = "expired-provider-permit-receipt";
    const assets = await insertCanonicalEventAssets(
      db,
      owner,
      [new ObjectId(), new ObjectId()],
    );
    const event = {
      _id: eventId,
      owner,
      status: "processing",
      deletionGeneration: 0,
      consentReceiptId: receiptId,
      profileFingerprint: "expired-provider-profile",
      jobId: new ObjectId(jobId),
      assetIds: assets.map((asset) => asset._id),
    };
    await db.collection("media_events").insertOne(event);
    await insertActiveEventMembership(
      db,
      owner,
      eventId,
      assets[0]._id,
      receiptId,
    );
    const permit = await acquireMediaEventProviderCallPermit(
      db,
      event,
      runId,
      jobId,
    );
    await renewMediaEventProviderCallPermit(
      db,
      event,
      permit.id,
      runId,
      jobId,
    );
    // Simulate an unbounded durable start-fence pause after the first renewal.
    await db.collection("media_events").updateOne(
      { _id: eventId, "providerCallPermit.id": permit.id },
      {
        $set: {
          "providerCallPermit.leaseExpiresAt": new Date(
            Date.now() - 60_000,
          ),
        },
      },
    );
    await fenceMediaAssetDerivedDeletion(db, owner, assets[0]._id);

    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = () => {
      fetchCalls++;
      return Promise.resolve(new Response("{}"));
    };
    try {
      await assertRejects(
        () =>
          analyzeWithMediaEventProvider({
            profile: {
              id: "self-hosted-events",
              name: "Self-hosted events",
              providerType: "self-hosted",
              enabled: true,
              concurrency: 1,
              baseUrl: "http://127.0.0.1:9999",
            },
            requestId: "must-not-fetch",
            previews: [0, 1].map((index) => ({
              ref: `preview-${index + 1}`,
              bytes: new Uint8Array([index + 1]),
              mimeType: "image/webp" as const,
              width: 32,
              height: 32,
              offsetSeconds: index,
            })),
            totalAssetCount: 2,
            durationSeconds: 1,
          }, {
            prepared: { providerType: "self-hosted" },
            assertPermission: () =>
              renewMediaEventProviderCallPermit(
                db,
                event,
                permit.id,
                runId,
                jobId,
              ).then(() => undefined),
          }),
        Error,
        "deletion won",
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
    assertEquals(fetchCalls, 0);
  }),
);

Deno.test(
  "fresh aggregation reactivates a stale canonical event with a new receipt",
  withFixtures(["Mongo"], async ({ db }) => {
    const owner = "stale-rebuild-owner";
    const assetIds = [new ObjectId(), new ObjectId()];
    const assets = await insertCanonicalEventAssets(db, owner, assetIds);
    const stableKey = "stale-rebuild-stable";
    const eventId = new ObjectId(
      createHash("sha256").update(
        ["media-event-v1", owner, stableKey].join("\0"),
      ).digest("hex").slice(0, 24),
    );
    const objectId = new ObjectId();
    const startAt = new Date("2026-08-22T10:00:00.000Z");
    const endAt = new Date("2026-08-22T10:05:00.000Z");
    await db.collection("media_events").insertOne({
      _id: eventId,
      owner,
      stableKey,
      status: "stale",
      assetIds,
      sourceHashes: assets.map((asset) => asset.sha256),
      startAt,
      endAt,
      representativeAssetIds: assetIds,
      consentReceiptId: "old-receipt",
      objectId,
      safeError: "old preview was deleted",
      createdAt: startAt,
      updatedAt: startAt,
    });
    for (const assetId of assetIds) {
      const membershipId = new ObjectId(
        createHash("sha256").update(
          ["media-event-membership-v1", owner, String(assetId)].join("\0"),
        ).digest("hex").slice(0, 24),
      );
      await db.collection("media_event_memberships").insertOne({
        _id: membershipId,
        owner,
        assetId,
        eventId,
        receiptId: "old-receipt",
        status: "deleted",
      });
    }
    const receipt = buildConsentReceipt({
      id: "fresh-receipt",
      principal: owner,
      groupStableKey: stableKey,
      assetIds,
      sourceHashes: assets.map((asset) => asset.sha256),
      representativeAssetIds: assetIds,
      providerSnapshot: null,
      profileFingerprint: null,
      privacyVersion: "preview-only-no-identity-v1",
      costCeilingUsd: 0,
      queueAnalysis: false,
      confirmedAt: endAt,
    });
    await reserveEventMemberships(db, owner, eventId, assets, receipt.id);
    const event = await ensureCanonicalEvent(
      db,
      owner,
      {
        stableKey,
        startAt,
        endAt,
        assetIds,
        sourceHashes: assets.map((asset) => asset.sha256),
        representativeAssetIds: assetIds,
        previewSnapshots: assets.map((asset) => ({
          assetId: asset._id,
          sha256: asset.sha256,
          previewFileId: asset.preview.fileId,
        })),
        estimatedGrossUsd: 0,
      },
      undefined,
      receipt,
    );
    assertEquals(event.status, "clustered");
    assertEquals(event.consentReceiptId, receipt.id);
    assertEquals(event.objectId, objectId);
    assertEquals(event.safeError, undefined);
  }),
);

Deno.test(
  "consent receipts are immutable and hash-bound",
  withFixtures(["Mongo"], async ({ db }) => {
    const eventId = new ObjectId();
    const ids = [new ObjectId(), new ObjectId()];
    const receipt = buildConsentReceipt({
      id: "receipt-immutable",
      principal: "receipt-owner",
      groupStableKey: "stable-receipt",
      assetIds: ids,
      sourceHashes: ["a".repeat(64), "b".repeat(64)],
      representativeAssetIds: ids,
      providerSnapshot: null,
      profileFingerprint: null,
      privacyVersion: "preview-only-no-identity-v1",
      costCeilingUsd: 0,
      queueAnalysis: false,
      confirmedAt: new Date("2026-08-22T00:00:00.000Z"),
    });
    await persistImmutableConsentReceipt(db, eventId, receipt);
    await persistImmutableConsentReceipt(db, eventId, receipt);
    assertEquals(
      await db.collection("media_event_consent_receipts").countDocuments(),
      1,
    );
    await assertRejects(
      () =>
        persistImmutableConsentReceipt(db, eventId, {
          ...receipt,
          costCeilingUsd: 1,
        }),
      Error,
      "integrity check failed",
    );
  }),
);

Deno.test(
  "failed persisted jobs are never reported as reusable queue success",
  withFixtures(["Mongo"], async ({ db }) => {
    const eventId = new ObjectId();
    const profile = {
      id: "self-hosted-events",
      name: "Self hosted events",
      providerType: "self-hosted" as const,
      enabled: true,
      concurrency: 1,
      baseUrl: "http://127.0.0.1:9000",
    };
    const sourceHashes = ["a".repeat(64), "b".repeat(64)];
    const consentReceiptId = "failed-job-receipt";
    const jobId = mediaEventJobId({
      eventId,
      profileFingerprint: "ignored",
      sourceHashes,
      consentReceiptId,
    });
    // mediaEventJobId uses the actual profile fingerprint, so derive it by
    // observing the deterministic job id from the same canonical JSON hash.
    const fingerprint = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(JSON.stringify(profile)),
    );
    const canonicalJobId = mediaEventJobId({
      eventId,
      profileFingerprint: Array.from(new Uint8Array(fingerprint)).map((byte) =>
        byte.toString(16).padStart(2, "0")
      ).join("").slice(0, 24),
      sourceHashes,
      consentReceiptId,
    });
    assertEquals(typeof jobId, "string");
    await db.collection("jobs").insertOne({
      _id: new ObjectId(canonicalJobId),
      type: "mediaEventAggregation",
      state: "failed",
      data: {
        type: "mediaEventAggregation",
        eventId: String(eventId),
        profileSnapshot: profile,
        consentReceiptId,
      },
    });
    await assertRejects(
      () =>
        enqueueMediaEvent(
          db,
          eventId,
          profile,
          consentReceiptId,
          new Auth({ principal: "job-owner" }),
          sourceHashes,
        ),
      Error,
      "not runnable (failed)",
    );
  }),
);

Deno.test(
  "pre-provider crash releases an unstarted GCP reservation",
  withFixtures(["Mongo"], async ({ db }) => {
    const runId = "recoverable-run";
    const claimId = "run-claim";
    const attemptId = `${runId}:${claimId}`;
    const now = new Date("2026-08-22T12:00:00.000Z");
    const projectId = "media-event-test-project";
    const ledgerId = `${projectId}:2026-08`;
    await db.collection("media_event_runs").insertOne({
      _id: runId,
      state: "building",
      attemptId,
      jobId: new ObjectId().toString(),
      executionClaim: {
        id: claimId,
        phase: "started",
        providerStartedAt: new Date(now.getTime() - 120_000),
        leaseExpiresAt: new Date(now.getTime() - 60_000),
      },
    });
    await db.collection("gcp_usage_events").insertOne({
      attemptId,
      principal: "owner",
      projectId,
      ledgerId,
      month: "2026-08",
      day: "2026-08-22",
      state: "reserved",
      grossListPriceUsd: 0.02,
      accountingVersion: 2,
      execution: {
        id: "budget-claim",
        state: "claimed",
        claimedAt: new Date(now.getTime() - 120_000),
        leaseExpiresAt: new Date(now.getTime() - 60_000),
      },
    });
    await db.collection("gcp_usage_months").insertOne({
      _id: ledgerId,
      grossReservedUsd: 0.02,
      grossCommittedUsd: 0,
      reservationAttemptIds: [attemptId],
      settlementAttemptIds: [],
      days: { "2026-08-22": { grossUsd: 0.02 } },
    });
    const recovered = await recoverPreProviderMediaEventCrash(db, runId, {
      id: "google-events",
      name: "Google events",
      providerType: "google-cloud",
      enabled: true,
      concurrency: 1,
      projectId,
      location: "eu",
      vertexModel: "gemini-3.5-flash-lite",
      embeddingModel: "gemini-embedding-001",
      embeddingLocation: "europe-west4",
      documentAiProcessorVersion: "pretrained-ocr-v2.1-2024-08-07",
      allowGlobalPhotoAnalysis: false,
    }, now);
    assertEquals(recovered, true);
    assertEquals(
      (await db.collection("gcp_usage_events").findOne({ attemptId }))?.state,
      "released",
    );
    assertEquals(
      (await db.collection("media_event_runs").findOne({ _id: runId }))?.state,
      "failed",
    );
  }),
);

Deno.test(
  "read reconciliation settles an expired provider-started run as unknown",
  withFixtures(["Mongo"], async ({ db }) => {
    const owner = "expired-run-owner";
    const eventId = new ObjectId();
    const runId = "expired-started-run";
    const claimId = "expired-started-claim";
    const attemptId = `${runId}:${claimId}`;
    const jobId = new ObjectId().toString();
    const now = new Date("2026-08-22T13:00:00.000Z");
    const projectId = "expired-run-project";
    const ledgerId = `${projectId}:2026-08`;
    const profile = {
      id: "google-events",
      name: "Google events",
      providerType: "google-cloud" as const,
      enabled: true,
      concurrency: 1,
      projectId,
      location: "eu",
      vertexModel: "gemini-3.5-flash-lite",
      embeddingModel: "gemini-embedding-001",
      embeddingLocation: "europe-west4",
      documentAiProcessorVersion: "pretrained-ocr-v2.1-2024-08-07",
      allowGlobalPhotoAnalysis: false,
    };
    await db.collection("media_events").insertOne({
      _id: eventId,
      owner,
      status: "processing",
      deletionGeneration: 0,
      consentReceiptId: "expired-started-receipt",
      profileFingerprint: "expired-started-profile",
      jobId: new ObjectId(jobId),
    });
    await db.collection("media_event_runs").insertOne({
      _id: runId,
      owner,
      eventId,
      state: "building",
      deletionGeneration: 0,
      consentReceiptId: "expired-started-receipt",
      profileFingerprint: "expired-started-profile",
      providerSnapshot: profile,
      attemptId,
      jobId,
      executionClaim: {
        id: claimId,
        jobId,
        phase: "started",
        providerStartedAt: new Date(now.getTime() - 120_000),
        leaseExpiresAt: new Date(now.getTime() - 60_000),
      },
    });
    await db.collection("gcp_usage_events").insertOne({
      attemptId,
      principal: owner,
      projectId,
      ledgerId,
      month: "2026-08",
      day: "2026-08-22",
      state: "reserved",
      grossListPriceUsd: 0.02,
      accountingVersion: 2,
      execution: {
        id: "expired-budget-claim",
        state: "started",
        claimedAt: new Date(now.getTime() - 180_000),
        startedAt: new Date(now.getTime() - 120_000),
        leaseExpiresAt: new Date(now.getTime() - 60_000),
      },
    });
    await db.collection("gcp_usage_months").insertOne({
      _id: ledgerId,
      grossReservedUsd: 0.02,
      grossCommittedUsd: 0,
      reservationAttemptIds: [attemptId],
      settlementAttemptIds: [],
      days: { "2026-08-22": { grossUsd: 0.02 } },
    });
    assertEquals(
      await reconcileExpiredMediaEventRuns(db, owner, now),
      {
        released: 0,
        outcomeUnknown: 1,
        settlementReconciled: 0,
        settlementPending: 0,
      },
    );
    assertEquals(
      (await db.collection("gcp_usage_events").findOne({ attemptId }))?.state,
      "unknown",
    );
    assertEquals(
      (await db.collection("media_event_runs").findOne({ _id: runId }))?.state,
      "provider_outcome_unknown",
    );
    assertEquals(
      (await db.collection("media_events").findOne({ _id: eventId }))?.status,
      "failed",
    );
  }),
);

Deno.test(
  "expired old run reconciliation cannot fail a newer event generation",
  withFixtures(["Mongo"], async ({ db }) => {
    const owner = "reconcile-generation-owner";
    const eventId = new ObjectId();
    const oldJobId = new ObjectId().toString();
    const newJobId = new ObjectId();
    const now = new Date("2026-08-22T13:30:00.000Z");
    await db.collection("media_events").insertOne({
      _id: eventId,
      owner,
      status: "processing",
      deletionGeneration: 1,
      consentReceiptId: "new-receipt",
      profileFingerprint: "new-profile",
      jobId: newJobId,
    });
    await db.collection("media_event_runs").insertOne({
      _id: "old-expired-generation-run",
      owner,
      eventId,
      state: "building",
      deletionGeneration: 0,
      consentReceiptId: "old-receipt",
      profileFingerprint: "old-profile",
      providerSnapshot: {
        id: "old-selfhost",
        name: "Old selfhost",
        providerType: "self-hosted",
        enabled: true,
        concurrency: 1,
        baseUrl: "http://127.0.0.1:9000",
      },
      attemptId: "old-expired-generation-run:claim",
      jobId: oldJobId,
      executionClaim: {
        id: "claim",
        jobId: oldJobId,
        phase: "claimed",
        claimedAt: new Date(now.getTime() - 120_000),
        leaseExpiresAt: new Date(now.getTime() - 60_000),
      },
    });
    assertEquals(
      (await reconcileExpiredMediaEventRuns(db, owner, now)).released,
      1,
    );
    const event = await db.collection("media_events").findOne({ _id: eventId });
    assertEquals(event?.status, "processing");
    assertEquals(event?.consentReceiptId, "new-receipt");
    assertEquals(event?.jobId, newJobId);
  }),
);

Deno.test(
  "invalidation persists a failed budget settlement until global reconciliation",
  withFixtures(["Mongo"], async ({ db }) => {
    const owner = "invalidation-settlement-owner";
    const eventId = new ObjectId();
    const assetId = new ObjectId();
    const runId = "invalidation-settlement-run";
    const claimId = "invalidation-settlement-claim";
    const attemptId = `${runId}:${claimId}`;
    const jobId = new ObjectId().toString();
    const now = new Date("2026-08-22T14:00:00.000Z");
    const projectId = "invalidation-settlement-project";
    const ledgerId = `${projectId}:2026-08`;
    await db.collection("media_events").insertOne({
      _id: eventId,
      owner,
      status: "processing",
      deletionGeneration: 0,
      consentReceiptId: "invalidation-settlement-receipt",
      profileFingerprint: "invalidation-settlement-profile",
      jobId: new ObjectId(jobId),
      assetIds: [assetId, new ObjectId()],
    });
    await db.collection("media_event_runs").insertOne({
      _id: runId,
      owner,
      eventId,
      state: "building",
      deletionGeneration: 0,
      consentReceiptId: "invalidation-settlement-receipt",
      profileFingerprint: "invalidation-settlement-profile",
      providerSnapshot: { providerType: "google-cloud" },
      attemptId,
      jobId,
      executionClaim: {
        id: claimId,
        jobId,
        phase: "started",
        providerStartedAt: new Date(now.getTime() - 120_000),
        leaseExpiresAt: new Date(now.getTime() - 60_000),
      },
      analysis: understanding,
    });
    await db.collection("gcp_usage_events").insertOne({
      attemptId,
      principal: owner,
      projectId,
      ledgerId,
      month: "2026-08",
      day: "2026-08-22",
      state: "reserved",
      grossListPriceUsd: 0.02,
      accountingVersion: 2,
      execution: {
        id: "invalidation-settlement-budget-claim",
        state: "started",
        claimedAt: new Date(now.getTime() - 180_000),
        startedAt: new Date(now.getTime() - 120_000),
        leaseExpiresAt: new Date(now.getTime() - 60_000),
      },
    });
    await fenceAndInvalidateEventAsset(db, owner, eventId, assetId);
    let run = await db.collection("media_event_runs").findOne({ _id: runId });
    assertEquals(run?.state, "building");
    assertEquals(run?.settlementPending?.target, "unknown");
    assertEquals(run?.analysis, undefined);
    await db.collection("gcp_usage_months").insertOne({
      _id: ledgerId,
      grossReservedUsd: 0.02,
      grossCommittedUsd: 0,
      reservationAttemptIds: [attemptId],
      settlementAttemptIds: [],
      days: { "2026-08-22": { grossUsd: 0.02 } },
    });
    const result = await reconcileExpiredMediaEventRuns(db, owner, now);
    assertEquals(result.settlementReconciled, 1);
    assertEquals(result.settlementPending, 0);
    run = await db.collection("media_event_runs").findOne({ _id: runId });
    assertEquals(run?.state, "provider_outcome_unknown");
    assertEquals(run?.settlementPending, undefined);
    assertEquals(
      (await db.collection("gcp_usage_events").findOne({ attemptId }))?.state,
      "unknown",
    );
  }),
);

Deno.test(
  "derived-media invalidation fences events and discloses stale publication",
  withFixtures(["Mongo"], async ({ db }) => {
    const owner = "admin";
    const eventId = new ObjectId();
    const assetId = new ObjectId();
    const objectId = new ObjectId();
    await db.collection("media_events").insertOne({
      _id: eventId,
      owner,
      status: "ready",
      deletionGeneration: 0,
      assetIds: [assetId, new ObjectId()],
      analysis: understanding,
      currentRunId: "run",
      previewSnapshots: [{ assetId, previewFileId: new ObjectId() }],
      objectId,
    });
    await db.collection("media_event_runs").insertOne({
      _id: "run",
      owner,
      eventId,
      state: "ready",
      providerSnapshot: { providerType: "self-hosted" },
      analysis: understanding,
    });
    await db.collection("media_event_links").insertOne({
      _id: new ObjectId(),
      owner,
      eventId,
    });
    await db.collection("objects").insertOne({
      _id: objectId,
      isEvent: true,
      _listCategories: ["event"],
      metadata: {
        mediaEvent: { eventId: String(eventId), deletionGeneration: 0 },
      },
    });
    assertEquals(
      (await fenceAndInvalidateEventAsset(db, owner, eventId, assetId))
        .invalidatedEvents,
      1,
    );
    const event = await db.collection("media_events").findOne({ _id: eventId });
    assertEquals(event?.status, "stale");
    assertEquals(event?.analysis, undefined);
    assertEquals(event?.currentRunId, undefined);
    assertEquals(
      await db.collection("media_event_runs").countDocuments({ eventId }),
      1,
    );
    assertEquals(
      Boolean(
        (await db.collection("media_event_runs").findOne({ eventId }))
          ?.invalidatedAt,
      ),
      true,
    );
    assertEquals(
      (await db.collection("media_event_runs").findOne({ eventId }))?.analysis,
      undefined,
    );
    assertEquals(
      (await db.collection("objects").findOne({ _id: objectId }))?.metadata
        ?.mediaEvent?.stale,
      true,
    );
    assertEquals(
      (await db.collection("objects").findOne({ _id: objectId }))?.isEvent,
      false,
    );
  }),
);

async function assertPolicyDenied(promise: Promise<void>) {
  try {
    await promise;
    throw new Error("expected policy denial");
  } catch (error) {
    if (error instanceof Response) {
      assertEquals(error.status, 403);
      return;
    }
    throw error;
  }
}

Deno.test("media event actions declare cross-resource object permissions", async () => {
  const resource = new MediaEventsResource();
  const manager = new ResourceManager();
  const id = new ObjectId().toString();
  const actions = (input: unknown) =>
    resource.extractActions(mediaEventRequestSchema.parse(input));
  const confirm = actions({
    action: "confirmAggregation",
    previewId: id,
    selectedGroupIndexes: [0],
    consent: true,
    queueAnalysis: false,
  });
  const base = new Auth({
    principal: "owner",
    policies: [{
      resource: "media-events/confirmAggregation",
      action: "use",
      effect: "allow",
    }],
  });
  await assertPolicyDenied(manager.ensureAllowed(base, ...confirm));
  await manager.ensureAllowed(
    new Auth({
      principal: "owner",
      policies: [
        ...base.policies,
        { resource: "objects", action: "read", effect: "allow" },
      ],
    }),
    ...confirm,
  );

  const publish = actions({
    action: "publishEvent",
    eventId: id,
    analysisRunId: "reviewed-run",
    confirm: true,
    reviewedSensitiveText: true,
  });
  await assertPolicyDenied(manager.ensureAllowed(
    new Auth({
      principal: "owner",
      policies: [
        {
          resource: "media-events/publishEvent",
          action: "use",
          effect: "allow",
        },
        { resource: "objects", action: "read", effect: "allow" },
        { resource: "objects", action: "create", effect: "allow" },
      ],
    }),
    ...publish,
  ));
  await manager.ensureAllowed(
    new Auth({
      principal: "owner",
      policies: [
        {
          resource: "media-events/publishEvent",
          action: "use",
          effect: "allow",
        },
        { resource: "objects", action: "read", effect: "allow" },
        { resource: "objects", action: "create", effect: "allow" },
        { resource: "objects", action: "update", effect: "allow" },
      ],
    }),
    ...publish,
  );

  const process = actions({
    action: "processEvent",
    eventId: id,
    profileSnapshot: {},
    consentReceiptId: "receipt",
    jobId: id,
  });
  assertEquals(process, [{
    path: ["media-events", "processEvent"],
    actions: ["process"],
  }]);
});
