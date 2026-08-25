import {
  type CreateIndexesOptions,
  type Db,
  type IndexSpecification,
  ObjectId,
} from "mongodb";
import { createHash } from "node:crypto";
import { ensureCollectionExists } from "@/utils/migrations.ts";

export const MEDIA_EVENT_HARDENING_COLLECTIONS = [
  "media_event_aggregation_previews",
  "media_event_analysis_previews",
  "media_events",
  "media_event_runs",
  "media_event_links",
  "media_event_memberships",
  "media_event_consent_receipts",
  "media_event_publication_claims",
  "media_event_publication_reviews",
] as const;

type RequiredIndex = {
  collection: string;
  keys: IndexSpecification;
  name: string;
  options?: Omit<CreateIndexesOptions, "name">;
};

export const MEDIA_EVENT_HARDENING_INDEXES: RequiredIndex[] = [
  {
    collection: "media_event_aggregation_previews",
    keys: { expiresAt: 1 },
    name: "media_event_aggregation_preview_ttl_v1",
    options: { expireAfterSeconds: 0 },
  },
  {
    collection: "media_event_analysis_previews",
    keys: { expiresAt: 1 },
    name: "media_event_analysis_preview_ttl_v1",
    options: { expireAfterSeconds: 0 },
  },
  {
    collection: "media_event_analysis_previews",
    keys: { owner: 1, eventId: 1, createdAt: -1 },
    name: "media_event_analysis_preview_owner_event_v1",
  },
  {
    collection: "media_event_aggregation_previews",
    keys: { owner: 1, createdAt: -1 },
    name: "media_event_aggregation_preview_owner_v1",
  },
  {
    collection: "media_events",
    keys: { owner: 1, stableKey: 1 },
    name: "media_event_owner_stable_key_v1",
    options: { unique: true },
  },
  {
    collection: "media_events",
    keys: { owner: 1, startAt: -1, _id: -1 },
    name: "media_event_owner_timeline_v1",
  },
  {
    collection: "media_events",
    keys: { owner: 1, status: 1, updatedAt: -1 },
    name: "media_event_owner_status_v1",
  },
  {
    collection: "media_event_runs",
    keys: { owner: 1, runKey: 1 },
    name: "media_event_run_owner_key_v1",
    options: { unique: true },
  },
  {
    collection: "media_event_runs",
    keys: { owner: 1, eventId: 1, createdAt: -1 },
    name: "media_event_run_owner_event_v1",
  },
  {
    collection: "media_event_runs",
    keys: { state: 1, "executionClaim.leaseExpiresAt": 1, owner: 1 },
    name: "media_event_run_expired_claim_v1",
  },
  {
    collection: "media_event_runs",
    keys: { "settlementPending.target": 1, owner: 1 },
    name: "media_event_run_pending_settlement_v1",
    options: { sparse: true },
  },
  {
    collection: "media_event_links",
    keys: { owner: 1, linkKey: 1 },
    name: "media_event_link_owner_key_v1",
    options: { unique: true },
  },
  {
    collection: "media_event_links",
    keys: { owner: 1, eventId: 1, status: 1, createdAt: -1 },
    name: "media_event_link_owner_event_v1",
  },
  {
    collection: "media_event_memberships",
    keys: { owner: 1, assetId: 1 },
    name: "media_event_membership_owner_asset_v1",
    options: { unique: true },
  },
  {
    collection: "media_event_memberships",
    keys: { owner: 1, eventId: 1, status: 1 },
    name: "media_event_membership_owner_event_v1",
  },
  {
    collection: "media_event_memberships",
    keys: { reservationExpiresAt: 1 },
    name: "media_event_membership_reservation_ttl_v1",
    options: {
      expireAfterSeconds: 0,
      partialFilterExpression: { status: "reserved" },
    },
  },
  {
    collection: "media_event_consent_receipts",
    keys: { owner: 1, eventId: 1, createdAt: -1 },
    name: "media_event_consent_owner_event_v1",
  },
  {
    collection: "media_event_publication_claims",
    keys: { owner: 1, state: 1, updatedAt: -1 },
    name: "media_event_publication_owner_state_v1",
  },
  {
    collection: "media_event_publication_reviews",
    keys: { owner: 1, eventId: 1, runId: 1 },
    name: "media_event_publication_review_owner_event_run_v1",
    options: { unique: true },
  },
  {
    collection: "source_files",
    keys: { created_by: 1, start: 1, end: 1, _id: 1 },
    name: "source_files_media_event_overlap_v1",
  },
  {
    collection: "transcriptions",
    keys: { original: 1, start: 1, end: 1, _id: 1 },
    name: "transcriptions_media_event_overlap_v1",
  },
  {
    collection: "objects",
    keys: { "metadata.mediaEvent.eventId": 1 },
    name: "objects_media_event_id_v1",
    options: { unique: true, sparse: true },
  },
];

function hash(parts: unknown[]): string {
  return createHash("sha256").update(parts.map(String).join("\0")).digest(
    "hex",
  );
}

function membershipId(owner: string, assetId: ObjectId): ObjectId {
  return new ObjectId(
    hash(["media-event-membership-v1", owner, assetId]).slice(0, 24),
  );
}

function reviewId(owner: string, eventId: ObjectId, runId: string): string {
  return hash([
    "media-event-publication-review-v1",
    owner,
    eventId,
    runId,
  ]);
}

function stableTombstone(owner: string, eventId: ObjectId): string {
  return hash(["media-event-hardening-stale-v1", owner, eventId]);
}

function sameDocument(left: unknown, right: unknown): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

async function ensureExactIndex(db: Db, required: RequiredIndex) {
  await ensureCollectionExists(db, required.collection);
  const collection = db.collection(required.collection);
  const existing = (await collection.listIndexes().toArray()).find((index) =>
    index.name === required.name
  );
  const options = required.options ?? {};
  const matches = existing &&
    sameDocument(existing.key, required.keys) &&
    Boolean(existing.unique) === Boolean(options.unique) &&
    Boolean(existing.sparse) === Boolean(options.sparse) &&
    (existing.expireAfterSeconds ?? null) ===
      (options.expireAfterSeconds ?? null) &&
    sameDocument(
      existing.partialFilterExpression,
      options.partialFilterExpression,
    );
  if (matches) return;
  if (existing) await collection.dropIndex(required.name);
  await collection.createIndex(required.keys, {
    name: required.name,
    ...options,
  });
}

async function normalizeMembershipIds(db: Db) {
  const memberships = db.collection<any>("media_event_memberships");
  for await (
    const membership of memberships.find({
      owner: { $type: "string" },
      assetId: { $exists: true },
    })
  ) {
    if (!ObjectId.isValid(membership.assetId)) continue;
    const assetId = membership.assetId instanceof ObjectId
      ? membership.assetId
      : new ObjectId(String(membership.assetId));
    const expectedId = membershipId(membership.owner, assetId);
    if (String(membership._id) === String(expectedId)) continue;
    const deterministic = await memberships.findOne({ _id: expectedId });
    if (deterministic) {
      await memberships.deleteOne({ _id: membership._id });
      continue;
    }
    const replacement = { ...membership, _id: expectedId, assetId };
    await memberships.deleteOne({ _id: membership._id });
    await memberships.updateOne(
      { _id: expectedId },
      { $setOnInsert: replacement },
      { upsert: true },
    );
  }
}

async function staleEvent(
  db: Db,
  event: any,
  reason: string,
): Promise<void> {
  const generation = Math.max(0, Number(event.deletionGeneration ?? 0)) + 1;
  const tombstoneId = stableTombstone(event.owner, event._id);
  const changed = await db.collection("media_events").updateOne(
    { _id: event._id, owner: event.owner, status: { $ne: "stale" } },
    {
      $set: {
        status: "stale",
        safeError: reason,
        deletionGeneration: generation,
        deletionTombstoneId: tombstoneId,
        updatedAt: new Date(),
      },
      $unset: {
        analysis: "",
        currentRunId: "",
        jobId: "",
        previewSnapshots: "",
        providerCallPermit: "",
        providerDeletionPending: "",
        publicationClaimId: "",
        publicationLeaseExpiresAt: "",
      },
    },
  );
  if (changed.modifiedCount !== 1) return;
  await db.collection("media_event_publication_claims").updateMany(
    { owner: event.owner, _id: event._id },
    {
      $set: {
        state: "invalidated",
        safeError: reason,
        deletionGeneration: generation,
        deletionTombstoneId: tombstoneId,
        updatedAt: new Date(),
      },
    },
  );
  await db.collection("media_event_runs").updateMany(
    { owner: event.owner, eventId: event._id },
    {
      $set: {
        invalidatedAt: new Date(),
        invalidationReason: reason,
        updatedAt: new Date(),
      },
    },
  );
  await Promise.all([
    db.collection("media_event_links").deleteMany({
      owner: event.owner,
      eventId: event._id,
    }),
    db.collection("media_event_analysis_previews").deleteMany({
      owner: event.owner,
      eventId: event._id,
    }),
  ]);
  await db.collection("objects").updateMany(
    {
      "metadata.mediaEvent.eventId": event._id,
    },
    {
      $set: {
        isEvent: false,
        _listCategories: [],
        "metadata.mediaEvent.stale": true,
        "metadata.mediaEvent.staleReason": reason,
        "metadata.mediaEvent.publicationState": "invalidated",
        "metadata.mediaEvent.deletionGeneration": generation,
        "metadata.mediaEvent.deletionTombstoneId": tombstoneId,
        updatedAt: new Date(),
      },
    },
  );
}

async function backfillMemberships(db: Db) {
  await normalizeMembershipIds(db);
  const memberships = db.collection<any>("media_event_memberships");
  for await (
    const event of db.collection<any>("media_events").find({
      status: { $ne: "stale" },
      owner: { $type: "string" },
      assetIds: { $type: "array" },
    }, {
      sort: { _id: 1 },
    })
  ) {
    let conflict = false;
    for (const rawAssetId of event.assetIds ?? []) {
      if (!ObjectId.isValid(rawAssetId)) {
        conflict = true;
        break;
      }
      const assetId = rawAssetId instanceof ObjectId
        ? rawAssetId
        : new ObjectId(String(rawAssetId));
      const id = membershipId(event.owner, assetId);
      try {
        await memberships.updateOne(
          { _id: id },
          {
            $setOnInsert: {
              _id: id,
              owner: event.owner,
              assetId,
              eventId: event._id,
              receiptId: event.consentReceiptId ?? `legacy:${event._id}`,
              status: "active",
              createdAt: event.createdAt ?? new Date(),
            },
          },
          { upsert: true },
        );
      } catch (error) {
        if ((error as { code?: number })?.code !== 11000) throw error;
      }
      const membership = await memberships.findOne({
        owner: event.owner,
        assetId,
      });
      if (
        String(membership?.eventId ?? "") !== String(event._id) ||
        membership?.status === "deleted" ||
        membership?.status === "deleting" ||
        !["active", "reserved"].includes(membership?.status) ||
        (membership?.status === "reserved" &&
          membership?.receiptId !==
            (event.consentReceiptId ?? `legacy:${event._id}`))
      ) {
        conflict = true;
        break;
      }
    }
    if (!conflict) continue;
    await memberships.deleteMany({
      owner: event.owner,
      eventId: event._id,
      status: { $in: ["active", "reserved"] },
    });
    await staleEvent(
      db,
      event,
      "Overlapping membership was assigned to another historical event during media-event hardening",
    );
  }
}

async function materializeGenerationsAndAudit(db: Db) {
  await db.collection("media_events").updateMany(
    { status: { $ne: "stale" }, deletionGeneration: { $exists: false } },
    { $set: { deletionGeneration: 0 } },
  );
  for await (
    const event of db.collection<any>("media_events").find({ status: "stale" })
  ) {
    const generation = Math.max(1, Number(event.deletionGeneration ?? 1));
    const tombstoneId = event.deletionTombstoneId ??
      stableTombstone(event.owner, event._id);
    await db.collection("media_events").updateOne(
      { _id: event._id, owner: event.owner },
      {
        $set: {
          deletionGeneration: generation,
          deletionTombstoneId: tombstoneId,
        },
      },
    );
    await db.collection("media_event_memberships").deleteMany({
      owner: event.owner,
      eventId: event._id,
      status: { $in: ["active", "reserved"] },
    });
    await db.collection("media_event_publication_claims").updateMany(
      {
        _id: event._id,
        owner: event.owner,
        $or: [
          { state: { $ne: "invalidated" } },
          { deletionGeneration: { $ne: generation } },
          { deletionTombstoneId: { $ne: tombstoneId } },
        ],
      },
      {
        $set: {
          state: "invalidated",
          deletionGeneration: generation,
          deletionTombstoneId: tombstoneId,
          updatedAt: new Date(),
        },
      },
    );
    await db.collection("objects").updateMany(
      {
        "metadata.mediaEvent.eventId": event._id,
        $or: [
          { isEvent: { $ne: false } },
          { _listCategories: { $ne: [] } },
          { "metadata.mediaEvent.stale": { $ne: true } },
          {
            "metadata.mediaEvent.publicationState": { $ne: "invalidated" },
          },
          {
            "metadata.mediaEvent.deletionGeneration": { $ne: generation },
          },
          {
            "metadata.mediaEvent.deletionTombstoneId": { $ne: tombstoneId },
          },
        ],
      },
      {
        $set: {
          isEvent: false,
          _listCategories: [],
          "metadata.mediaEvent.stale": true,
          "metadata.mediaEvent.publicationState": "invalidated",
          "metadata.mediaEvent.deletionGeneration": generation,
          "metadata.mediaEvent.deletionTombstoneId": tombstoneId,
          updatedAt: new Date(),
        },
      },
    );
  }
  await db.collection("media_event_runs").updateMany(
    { deletionGeneration: { $exists: false } },
    { $set: { deletionGeneration: 0 } },
  );

  for await (
    const claim of db.collection<any>("media_event_publication_claims").find({
      deletionGeneration: { $exists: false },
    })
  ) {
    const event = await db.collection<any>("media_events").findOne({
      _id: claim._id,
      owner: claim.owner,
    }, { projection: { deletionGeneration: 1 } });
    await db.collection("media_event_publication_claims").updateOne(
      { _id: claim._id, deletionGeneration: { $exists: false } },
      { $set: { deletionGeneration: Number(event?.deletionGeneration ?? 0) } },
    );
  }

  for await (
    const object of db.collection<any>("objects").find({
      "metadata.mediaEvent.eventId": { $exists: true },
      "metadata.mediaEvent.deletionGeneration": { $exists: false },
    })
  ) {
    const eventId = object.metadata?.mediaEvent?.eventId;
    const event = ObjectId.isValid(eventId)
      ? await db.collection<any>("media_events").findOne({
        _id: eventId instanceof ObjectId ? eventId : new ObjectId(eventId),
      })
      : null;
    const generation = Number(event?.deletionGeneration ?? 0);
    const set: Record<string, unknown> = {
      "metadata.mediaEvent.deletionGeneration": generation,
    };
    if (event?.status === "stale") {
      set.isEvent = false;
      set._listCategories = [];
      set["metadata.mediaEvent.stale"] = true;
      set["metadata.mediaEvent.publicationState"] = "invalidated";
      set["metadata.mediaEvent.deletionTombstoneId"] =
        event.deletionTombstoneId;
    }
    await db.collection("objects").updateOne({ _id: object._id }, {
      $set: set,
    });
  }

  for await (
    const event of db.collection<any>("media_events").find({
      consentReceipt: { $type: "object" },
      consentReceiptId: { $type: "string" },
    })
  ) {
    if (event.consentReceipt?.id !== event.consentReceiptId) continue;
    const expected = {
      _id: event.consentReceiptId,
      owner: event.owner,
      eventId: event._id,
      receipt: event.consentReceipt,
      createdAt: event.consentReceipt.confirmedAt ?? event.createdAt ??
        new Date(),
    };
    await db.collection("media_event_consent_receipts").updateOne(
      { _id: event.consentReceiptId },
      {
        $setOnInsert: expected,
      },
      { upsert: true },
    );
    const durable = await db.collection<any>("media_event_consent_receipts")
      .findOne({ _id: event.consentReceiptId });
    if (
      !durable || durable.owner !== expected.owner ||
      String(durable.eventId) !== String(expected.eventId) ||
      !sameDocument(durable.receipt, expected.receipt)
    ) {
      throw new Error(
        `Conflicting immutable media event consent receipt ${event.consentReceiptId}`,
      );
    }
  }

  for await (
    const event of db.collection<any>("media_events").find({
      "publicationReview.runId": { $type: "string" },
      "publicationReview.reviewedSensitiveText": true,
    })
  ) {
    const review = event.publicationReview;
    const id = reviewId(event.owner, event._id, review.runId);
    const expected = {
      _id: id,
      owner: event.owner,
      eventId: event._id,
      runId: review.runId,
      reviewedSensitiveText: true,
      reviewedAt: review.reviewedAt ?? event.updatedAt ?? new Date(),
    };
    await db.collection<any>("media_event_publication_reviews").updateOne(
      { _id: id },
      {
        $setOnInsert: expected,
      },
      { upsert: true },
    );
    const durable = await db.collection<any>("media_event_publication_reviews")
      .findOne({ _id: id });
    if (
      !durable || durable.owner !== expected.owner ||
      String(durable.eventId) !== String(expected.eventId) ||
      durable.runId !== expected.runId ||
      durable.reviewedSensitiveText !== true
    ) {
      throw new Error(
        `Conflicting immutable media event publication review ${id}`,
      );
    }
  }
}

export async function up(db: Db): Promise<void> {
  for (const collection of MEDIA_EVENT_HARDENING_COLLECTIONS) {
    await ensureCollectionExists(db, collection);
  }

  await materializeGenerationsAndAudit(db);
  await backfillMemberships(db);

  // The unique membership index must be created only after historical overlap
  // reconciliation. Every other index is safe to reassert in declared order.
  for (const index of MEDIA_EVENT_HARDENING_INDEXES) {
    await ensureExactIndex(db, index);
  }
}

export async function down(_db: Db): Promise<void> {
  // This migration repairs a previously recorded but partially applied schema.
  // Its collections, audit records, tombstones and safety indexes are durable
  // runtime invariants and intentionally survive a code rollback.
}
