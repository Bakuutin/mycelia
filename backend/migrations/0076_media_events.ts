import { type Db, type IndexSpecification, ObjectId } from "mongodb";
import { createHash } from "node:crypto";
import {
  ensureCollectionExists,
  ensureIndexExists,
} from "@/utils/migrations.ts";

const COLLECTIONS = [
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

const INDEXES: Array<{
  collection: string;
  keys: IndexSpecification;
  name: string;
  unique?: boolean;
  sparse?: boolean;
  expireAfterSeconds?: number;
}> = [
  {
    collection: "media_event_aggregation_previews",
    keys: { expiresAt: 1 },
    name: "media_event_aggregation_preview_ttl_v1",
    expireAfterSeconds: 0,
  },
  {
    collection: "media_event_analysis_previews",
    keys: { expiresAt: 1 },
    name: "media_event_analysis_preview_ttl_v1",
    expireAfterSeconds: 0,
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
    unique: true,
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
    unique: true,
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
    sparse: true,
  },
  {
    collection: "media_event_links",
    keys: { owner: 1, linkKey: 1 },
    name: "media_event_link_owner_key_v1",
    unique: true,
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
    unique: true,
  },
  {
    collection: "media_event_memberships",
    keys: { owner: 1, eventId: 1, status: 1 },
    name: "media_event_membership_owner_event_v1",
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
    unique: true,
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
    unique: true,
    sparse: true,
  },
];

export async function up(db: Db): Promise<void> {
  for (const collection of COLLECTIONS) {
    await ensureCollectionExists(db, collection);
  }
  for (const index of INDEXES) {
    await ensureIndexExists(db, index.collection, index.keys, {
      name: index.name,
      ...(index.unique === undefined ? {} : { unique: index.unique }),
      ...(index.sparse === undefined ? {} : { sparse: index.sparse }),
      ...(index.expireAfterSeconds === undefined
        ? {}
        : { expireAfterSeconds: index.expireAfterSeconds }),
    });
  }

  // Backfill any events created by a briefly deployed pre-membership build.
  // The deterministic id makes this idempotent; a pre-existing membership
  // remains the winner if historical events overlap.
  for await (
    const event of db.collection<any>("media_events").find({
      status: { $ne: "stale" },
      owner: { $type: "string" },
      assetIds: { $type: "array" },
    }, {
      projection: {
        owner: 1,
        assetIds: 1,
        consentReceiptId: 1,
        createdAt: 1,
      },
      sort: { _id: 1 },
    })
  ) {
    let overlapsAnotherEvent = false;
    for (const rawAssetId of event.assetIds ?? []) {
      if (!ObjectId.isValid(rawAssetId)) continue;
      const assetId = rawAssetId instanceof ObjectId
        ? rawAssetId
        : new ObjectId(String(rawAssetId));
      const membershipId = new ObjectId(
        createHash("sha256").update([
          "media-event-membership-v1",
          event.owner,
          String(assetId),
        ].join("\0")).digest("hex").slice(0, 24),
      );
      await db.collection("media_event_memberships").updateOne(
        { _id: membershipId },
        {
          $setOnInsert: {
            _id: membershipId,
            owner: event.owner,
            assetId,
            eventId: event._id,
            receiptId: event.consentReceiptId ?? `legacy:${event._id}`,
            status: "active",
            createdAt: event.createdAt ?? new Date(),
          },
        },
        { upsert: true },
      ).catch((error) => {
        if ((error as { code?: number })?.code !== 11000) throw error;
      });

      const membership = await db.collection<any>("media_event_memberships")
        .findOne(
          { owner: event.owner, assetId },
          { projection: { eventId: 1 } },
        );
      if (String(membership?.eventId ?? "") !== String(event._id)) {
        overlapsAnotherEvent = true;
        break;
      }
    }

    if (overlapsAnotherEvent) {
      await db.collection("media_event_memberships").deleteMany({
        owner: event.owner,
        eventId: event._id,
      });
      await db.collection("media_events").updateOne(
        { _id: event._id, status: { $ne: "stale" } },
        {
          $set: {
            status: "stale",
            safeError:
              "Overlapping membership was assigned to another historical event during backfill",
            updatedAt: new Date(),
          },
          $unset: {
            analysis: "",
            currentRunId: "",
            jobId: "",
            previewSnapshots: "",
          },
        },
      );
    }
  }
}

export async function down(db: Db): Promise<void> {
  // Event records and their links are durable user data. A code rollback only
  // removes indexes owned by this migration; it never drops the collections.
  for (const index of [...INDEXES].reverse()) {
    const collection = db.collection(index.collection);
    if (await collection.indexExists(index.name)) {
      await collection.dropIndex(index.name);
    }
  }
}
