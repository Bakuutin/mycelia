import { assertEquals, assertExists } from "jsr:@std/assert@^1.0.15";
import { ObjectId } from "mongodb";
import { withFixtures } from "@/tests/fixtures.server.ts";
import { up as createReservationIndexes } from "../../../migrations/0079_media_recognition_reservations.ts";
import {
  activateRecognitionReservations,
  activeRecognitionReservationAssetIds,
  materializeRecognitionBatch,
  reconcileRecognitionBatch,
  releaseRecognitionReservations,
  reserveRecognitionAssets,
} from "./resource.server.ts";

const COLLECTION = "media_recognition_asset_reservations";

type TestIndex = {
  name?: string;
  key?: Record<string, number>;
  unique?: boolean;
  expireAfterSeconds?: number;
};

function sortedIds(ids: ObjectId[]): string[] {
  return ids.map(String).sort();
}

Deno.test(
  "0079 creates the exact reservation indexes and is idempotent",
  withFixtures(["Mongo"], async ({ db }) => {
    await createReservationIndexes(db);
    await createReservationIndexes(db);

    const indexes = await db.collection(COLLECTION).listIndexes()
      .toArray() as TestIndex[];
    assertEquals(
      indexes.map((index) => index.name).sort(),
      [
        "_id_",
        "media_recognition_reservation_batch_v1",
        "media_recognition_reservation_owner_asset_v1",
        "media_recognition_reservation_preparing_ttl_v1",
      ].sort(),
    );

    const ownerAsset = indexes.find((index) =>
      index.name === "media_recognition_reservation_owner_asset_v1"
    );
    assertExists(ownerAsset);
    assertEquals(ownerAsset.key, { owner: 1, assetId: 1 });
    assertEquals(ownerAsset.unique, true);

    const batch = indexes.find((index) =>
      index.name === "media_recognition_reservation_batch_v1"
    );
    assertExists(batch);
    assertEquals(batch.key, { batchId: 1 });
    assertEquals(Boolean(batch.unique), false);

    const ttl = indexes.find((index) =>
      index.name === "media_recognition_reservation_preparing_ttl_v1"
    );
    assertExists(ttl);
    assertEquals(ttl.key, { expiresAt: 1 });
    assertEquals(ttl.expireAfterSeconds, 0);
  }),
);

Deno.test(
  "recognition reservations isolate owners and keep active batches disjoint",
  withFixtures(["Mongo"], async ({ db }) => {
    await createReservationIndexes(db);

    const owner = "reservation-owner";
    const otherOwner = "reservation-other-owner";
    const firstBatchId = new ObjectId();
    const secondBatchId = new ObjectId();
    const partialRetryBatchId = new ObjectId();
    const otherOwnerBatchId = new ObjectId();
    const assetA = new ObjectId();
    const assetB = new ObjectId();
    const assetC = new ObjectId();
    const now = new Date();

    const first = await reserveRecognitionAssets(
      db,
      owner,
      firstBatchId,
      [{ assetId: assetA, sha256: "a".repeat(64) }],
      now,
    );
    assertEquals(sortedIds(first.reservedAssetIds), [String(assetA)]);
    assertEquals(first.conflictAssetIds, []);

    const idempotent = await reserveRecognitionAssets(
      db,
      owner,
      firstBatchId,
      [{ assetId: assetA, sha256: "b".repeat(64) }],
      now,
    );
    assertEquals(sortedIds(idempotent.reservedAssetIds), [String(assetA)]);
    assertEquals(idempotent.conflictAssetIds, []);
    assertEquals(
      await db.collection(COLLECTION).countDocuments({
        owner,
        assetId: assetA,
      }),
      1,
    );
    assertEquals(
      (await db.collection(COLLECTION).findOne({ owner, assetId: assetA }))
        ?.sha256,
      "a".repeat(64),
    );

    const conflict = await reserveRecognitionAssets(
      db,
      owner,
      secondBatchId,
      [{ assetId: assetA, sha256: "a".repeat(64) }],
      now,
    );
    assertEquals(conflict.reservedAssetIds, []);
    assertEquals(sortedIds(conflict.conflictAssetIds), [String(assetA)]);

    const disjoint = await reserveRecognitionAssets(
      db,
      owner,
      secondBatchId,
      [{ assetId: assetB, sha256: "c".repeat(64) }],
      now,
    );
    assertEquals(sortedIds(disjoint.reservedAssetIds), [String(assetB)]);
    assertEquals(disjoint.conflictAssetIds, []);

    const otherOwnerResult = await reserveRecognitionAssets(
      db,
      otherOwner,
      otherOwnerBatchId,
      [{ assetId: assetA, sha256: "a".repeat(64) }],
      now,
    );
    assertEquals(sortedIds(otherOwnerResult.reservedAssetIds), [
      String(assetA),
    ]);
    assertEquals(otherOwnerResult.conflictAssetIds, []);

    const partialRetry = await reserveRecognitionAssets(
      db,
      owner,
      partialRetryBatchId,
      [
        { assetId: assetA, sha256: "a".repeat(64) },
        { assetId: assetC, sha256: "d".repeat(64) },
      ],
      now,
      true,
    );
    assertEquals(sortedIds(partialRetry.reservedAssetIds), [String(assetC)]);
    assertEquals(sortedIds(partialRetry.conflictAssetIds), [String(assetA)]);

    await Promise.all([
      activateRecognitionReservations(db, firstBatchId),
      activateRecognitionReservations(db, secondBatchId),
      activateRecognitionReservations(db, partialRetryBatchId),
      activateRecognitionReservations(db, otherOwnerBatchId),
    ]);
    assertEquals(
      sortedIds(await activeRecognitionReservationAssetIds(db, owner, now)),
      sortedIds([assetA, assetB, assetC]),
    );
    assertEquals(
      sortedIds(
        await activeRecognitionReservationAssetIds(db, otherOwner, now),
      ),
      [String(assetA)],
    );

    const active = await db.collection(COLLECTION).findOne({
      owner,
      assetId: assetA,
    });
    assertEquals(active?.state, "active");
    assertEquals(active?.expiresAt, undefined);

    await releaseRecognitionReservations(db, firstBatchId);
    assertEquals(
      await db.collection(COLLECTION).countDocuments({
        owner,
        assetId: assetA,
      }),
      0,
    );
    assertEquals(
      await db.collection(COLLECTION).countDocuments({
        owner: otherOwner,
        assetId: assetA,
      }),
      1,
    );

    const successorBatchId = new ObjectId();
    const successor = await reserveRecognitionAssets(
      db,
      owner,
      successorBatchId,
      [{ assetId: assetA, sha256: "a".repeat(64) }],
      now,
    );
    assertEquals(sortedIds(successor.reservedAssetIds), [String(assetA)]);
    assertEquals(successor.conflictAssetIds, []);
  }),
);

Deno.test(
  "concurrent same-owner reservation attempts choose exactly one batch",
  withFixtures(["Mongo"], async ({ db }) => {
    await createReservationIndexes(db);

    const owner = "concurrent-reservation-owner";
    const assetId = new ObjectId();
    const firstBatchId = new ObjectId();
    const secondBatchId = new ObjectId();
    const assetRefs = [{ assetId, sha256: "f".repeat(64) }];
    const now = new Date();

    const results = await Promise.all([
      reserveRecognitionAssets(db, owner, firstBatchId, assetRefs, now),
      reserveRecognitionAssets(db, owner, secondBatchId, assetRefs, now),
    ]);

    assertEquals(
      results.filter((result) => result.reservedAssetIds.length === 1).length,
      1,
    );
    assertEquals(
      results.filter((result) => result.conflictAssetIds.length === 1).length,
      1,
    );
    const durable = await db.collection(COLLECTION).findOne({ owner, assetId });
    assertExists(durable);
    assertEquals(
      [String(firstBatchId), String(secondBatchId)].includes(
        String(durable.batchId),
      ),
      true,
    );
    assertEquals(
      await db.collection(COLLECTION).countDocuments({ owner, assetId }),
      1,
    );
  }),
);

Deno.test(
  "an expired preparing reservation can be taken over by a new batch",
  withFixtures(["Mongo"], async ({ db }) => {
    await createReservationIndexes(db);

    const owner = "expired-reservation-owner";
    const assetId = new ObjectId();
    const oldBatchId = new ObjectId();
    const newBatchId = new ObjectId();
    const preparedAt = new Date("2026-08-26T00:00:00.000Z");
    const afterPrepareLease = new Date(
      preparedAt.getTime() + 15 * 60 * 1_000 + 1,
    );

    const oldReservation = await reserveRecognitionAssets(
      db,
      owner,
      oldBatchId,
      [{ assetId, sha256: "e".repeat(64) }],
      preparedAt,
    );
    assertEquals(sortedIds(oldReservation.reservedAssetIds), [String(assetId)]);

    const takeover = await reserveRecognitionAssets(
      db,
      owner,
      newBatchId,
      [{ assetId, sha256: "e".repeat(64) }],
      afterPrepareLease,
    );
    assertEquals(sortedIds(takeover.reservedAssetIds), [String(assetId)]);
    assertEquals(takeover.conflictAssetIds, []);

    const durable = await db.collection(COLLECTION).findOne({ owner, assetId });
    assertEquals(durable?.batchId, newBatchId);
    assertEquals(durable?.state, "preparing");
    assertEquals(
      await db.collection(COLLECTION).countDocuments({ owner, assetId }),
      1,
    );
  }),
);

Deno.test(
  "retry crash recovery keeps pending work queued and releases only after terminal",
  withFixtures(["Mongo"], async ({ db }) => {
    await createReservationIndexes(db);

    const owner = "retry-recovery-owner";
    const batchId = new ObjectId();
    const assetId = new ObjectId();
    const now = new Date();
    const batch = {
      _id: batchId,
      owner,
      status: "completed_with_errors",
      counts: { total: 1, failed: 1 },
      retryReservationClaim: {
        id: "expired-retry-claim",
        expiresAt: new Date(now.getTime() - 1_000),
      },
      createdAt: now,
      updatedAt: now,
    };
    await db.collection("media_recognition_batches").insertOne(batch);
    const itemId = new ObjectId();
    await db.collection("media_recognition_batch_items").insertOne({
      _id: itemId,
      batchId,
      owner,
      assetId,
      sha256: "9".repeat(64),
      state: "pending",
      createdAt: now,
      updatedAt: now,
    });
    await reserveRecognitionAssets(
      db,
      owner,
      batchId,
      [{ assetId, sha256: "9".repeat(64) }],
      now,
    );
    await activateRecognitionReservations(db, batchId);

    const recovered = await reconcileRecognitionBatch(db, batch);
    assertEquals(recovered.status, "queued");
    assertEquals(
      await db.collection(COLLECTION).countDocuments({ batchId }),
      1,
    );

    await db.collection("media_recognition_batch_items").updateOne(
      { _id: itemId },
      { $set: { state: "failed", updatedAt: new Date() } },
    );
    const terminal = await reconcileRecognitionBatch(db, {
      ...recovered,
      retryReservationClaim: undefined,
    });
    assertEquals(terminal.status, "completed_with_errors");
    assertEquals(
      await db.collection(COLLECTION).countDocuments({ batchId }),
      0,
    );
  }),
);

Deno.test(
  "durable pending batch refs resume item materialization after a crash",
  withFixtures(["Mongo"], async ({ db }) => {
    await createReservationIndexes(db);

    const batchId = new ObjectId();
    const assetId = new ObjectId();
    const now = new Date();
    const refs = [{ assetId, sha256: "8".repeat(64) }];
    const batch = {
      _id: batchId,
      owner: "materialization-owner",
      status: "queued",
      materializationPending: true,
      materializationAssetRefs: refs,
      counts: { total: 1, pending: 1 },
      createdAt: now,
      updatedAt: now,
    };
    await db.collection("media_recognition_batches").insertOne(batch);

    const resumed = await materializeRecognitionBatch(db, batch, refs, now);

    assertEquals(resumed.status, "queued");
    assertExists(resumed.materializedAt);
    assertEquals(resumed.materializationPending, undefined);
    assertEquals(resumed.materializationAssetRefs, undefined);
    assertEquals(
      await db.collection("media_recognition_batch_items").countDocuments({
        batchId,
        assetId,
        state: "pending",
      }),
      1,
    );
    assertEquals(
      (await db.collection(COLLECTION).findOne({ batchId, assetId }))?.state,
      "active",
    );
  }),
);

Deno.test(
  "cancellation wins a concurrent pending materialization",
  withFixtures(["Mongo"], async ({ db }) => {
    await createReservationIndexes(db);

    const batchId = new ObjectId();
    const assetId = new ObjectId();
    const now = new Date();
    const refs = [{ assetId, sha256: "7".repeat(64) }];
    const cancelled = {
      _id: batchId,
      owner: "cancel-materialization-owner",
      status: "cancelled",
      materializationPending: true,
      materializationAssetRefs: refs,
      cancelRequestedAt: now,
      counts: { total: 1, pending: 1 },
      createdAt: now,
      updatedAt: now,
    };
    await db.collection("media_recognition_batches").insertOne(cancelled);

    const result = await materializeRecognitionBatch(
      db,
      cancelled,
      refs,
      now,
    );

    assertEquals(result.status, "cancelled");
    assertEquals(
      await db.collection("media_recognition_batch_items").countDocuments({
        batchId,
        state: "cancelled",
      }),
      1,
    );
    assertEquals(
      await db.collection(COLLECTION).countDocuments({ batchId }),
      0,
    );
  }),
);
