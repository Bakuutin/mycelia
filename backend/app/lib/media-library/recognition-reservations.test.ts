import {
  assertEquals,
  assertExists,
  assertRejects,
} from "jsr:@std/assert@^1.0.15";
import { ObjectId } from "mongodb";
import { withFixtures } from "@/tests/fixtures.server.ts";
import { Auth } from "@/lib/auth/core.server.ts";
import { up as createReservationIndexes } from "../../../migrations/0079_media_recognition_reservations.ts";
import {
  activateRecognitionReservations,
  activeRecognitionReservationAssetIds,
  cancelQueuedRecognitionChildren,
  ensureRecognitionCoordinator,
  materializeRecognitionBatch,
  processRecognitionBatch,
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
  "concurrent recognition confirmations persist one runnable coordinator",
  withFixtures(["Mongo"], async ({ db }) => {
    const batchId = new ObjectId();
    const owner = "coordinator-owner";
    const now = new Date();
    await db.collection("media_recognition_batches").insertOne({
      _id: batchId,
      owner,
      status: "queued",
      createdAt: now,
      updatedAt: now,
    });

    let enqueueCount = 0;
    const enqueue = async (requestedBatchId: ObjectId) => {
      enqueueCount += 1;
      const jobId = new ObjectId();
      await db.collection("jobs").insertOne({
        _id: jobId,
        type: "mediaRecognitionBatch",
        data: { type: "mediaRecognitionBatch", batchId: String(batchId) },
        state: "waiting",
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      assertEquals(requestedBatchId, batchId);
      return String(jobId);
    };
    const auth = new Auth({ principal: owner });

    const results = await Promise.all([
      ensureRecognitionCoordinator(db, batchId, auth, enqueue),
      ensureRecognitionCoordinator(db, batchId, auth, enqueue),
    ]);

    assertEquals(enqueueCount, 1);
    assertEquals(new Set(results.filter(Boolean)).size, 1);
    const durable = await db.collection("media_recognition_batches").findOne({
      _id: batchId,
    });
    assertExists(durable?.coordinatorJobId);
    assertEquals(results.includes(String(durable.coordinatorJobId)), true);
    assertEquals(durable.coordinatorEnqueueClaim, undefined);
    assertEquals(
      await db.collection("jobs").countDocuments({
        type: "mediaRecognitionBatch",
        "data.batchId": String(batchId),
        state: { $in: ["waiting", "active", "delayed"] },
      }),
      1,
    );
  }),
);

Deno.test(
  "recognition processing persists its trusted current coordinator",
  withFixtures(["Mongo"], async ({ db }) => {
    const batchId = new ObjectId();
    const staleCoordinatorJobId = new ObjectId();
    const currentCoordinatorJobId = new ObjectId();
    const now = new Date();
    await db.collection("media_recognition_batches").insertOne({
      _id: batchId,
      owner: "current-coordinator-owner",
      status: "completed",
      coordinatorJobId: staleCoordinatorJobId,
      coordinatorEnqueueClaim: {
        id: "stale-claim",
        expiresAt: new Date(now.getTime() + 60_000),
      },
      counts: { total: 0 },
      createdAt: now,
      updatedAt: now,
    });

    const result = await processRecognitionBatch(
      db,
      batchId,
      currentCoordinatorJobId,
    ) as any;

    assertEquals(result.hasMore, false);
    const durable = await db.collection("media_recognition_batches").findOne({
      _id: batchId,
    });
    assertEquals(durable?.coordinatorJobId, currentCoordinatorJobId);
    assertEquals(durable?.coordinatorEnqueueClaim, undefined);
  }),
);

Deno.test(
  "cancelled recognition batch keeps polling until active work settles",
  withFixtures(["Mongo"], async ({ db }) => {
    const owner = "cancel-progress-owner";
    const batchId = new ObjectId();
    const queuedAssetId = new ObjectId();
    const pendingAssetId = new ObjectId();
    const queuedJobId = new ObjectId();
    const now = new Date();

    await db.collection("media_recognition_batches").insertOne({
      _id: batchId,
      owner,
      status: "running",
      cancelRequestedAt: now,
      counts: { total: 2, queued: 1, pending: 1 },
      createdAt: now,
      updatedAt: now,
    });
    await db.collection("media_assets").insertOne({
      _id: queuedAssetId,
      owner,
      kind: "image",
      status: "processing",
      currentRunId: "active-run",
      createdAt: now,
      updatedAt: now,
    });
    await db.collection("jobs").insertOne({
      _id: queuedJobId,
      type: "mediaRecognition",
      state: "active",
      createdAt: now,
      updatedAt: now,
    });
    await db.collection("media_recognition_batch_items").insertMany([
      {
        _id: new ObjectId(),
        batchId,
        owner,
        assetId: queuedAssetId,
        sha256: "a".repeat(64),
        jobId: queuedJobId,
        state: "processing",
        createdAt: now,
        updatedAt: now,
      },
      {
        _id: new ObjectId(),
        batchId,
        owner,
        assetId: pendingAssetId,
        sha256: "b".repeat(64),
        state: "pending",
        createdAt: now,
        updatedAt: now,
      },
    ]);

    const waiting = await processRecognitionBatch(db, batchId) as any;
    assertEquals(waiting.hasMore, true);
    assertEquals(waiting.counts.processing, 1);
    assertEquals(waiting.counts.cancelled, 1);
    assertEquals(waiting.progress.processed, 1);
    assertEquals(waiting.progress.total, 2);

    await db.collection("jobs").updateOne(
      { _id: queuedJobId },
      { $set: { state: "completed", updatedAt: new Date() } },
    );
    await db.collection("media_assets").updateOne(
      { _id: queuedAssetId },
      {
        $set: {
          status: "ready",
          currentRunId: "finished-run",
          updatedAt: new Date(),
        },
      },
    );

    const terminal = await processRecognitionBatch(db, batchId) as any;
    assertEquals(terminal.hasMore, false);
    assertEquals(terminal.progress.stage, "cancelled");
    assertEquals(terminal.progress.processed, 2);
    assertEquals(terminal.progress.percent, 100);
  }),
);

Deno.test(
  "batch cancellation removes queued children and leaves active providers",
  withFixtures(["Mongo"], async ({ db }) => {
    const owner = "cancel-children-owner";
    const batchId = new ObjectId();
    const queuedAssetId = new ObjectId();
    const activeAssetId = new ObjectId();
    const queuedJobId = new ObjectId();
    const activeJobId = new ObjectId();
    const now = new Date();
    const batch = {
      _id: batchId,
      owner,
      status: "running",
      cancelRequestedAt: now,
      createdAt: now,
      updatedAt: now,
    };
    await db.collection("media_recognition_batches").insertOne(batch);
    await db.collection("media_assets").insertMany([
      {
        _id: queuedAssetId,
        owner,
        kind: "image",
        status: "queued",
        createdAt: now,
        updatedAt: now,
      },
      {
        _id: activeAssetId,
        owner,
        kind: "image",
        status: "processing",
        currentRunId: "provider-call",
        createdAt: now,
        updatedAt: now,
      },
    ]);
    await db.collection("jobs").insertMany([
      {
        _id: queuedJobId,
        type: "mediaRecognition",
        state: "waiting",
        createdAt: now,
        updatedAt: now,
      },
      {
        _id: activeJobId,
        type: "mediaRecognition",
        state: "active",
        createdAt: now,
        updatedAt: now,
      },
    ]);
    await db.collection("media_recognition_batch_items").insertMany([
      {
        _id: new ObjectId(),
        batchId,
        owner,
        assetId: queuedAssetId,
        jobId: queuedJobId,
        state: "queued",
        createdAt: now,
        updatedAt: now,
      },
      {
        _id: new ObjectId(),
        batchId,
        owner,
        assetId: activeAssetId,
        jobId: activeJobId,
        // Exercise the queue/Mongo race where the item has not observed that
        // its child already entered the provider call.
        state: "queued",
        createdAt: now,
        updatedAt: now,
      },
    ]);

    const removed: string[] = [];
    const result = await cancelQueuedRecognitionChildren(
      db,
      batch,
      async (jobId, persistedJob, beforeRemove) => {
        if (persistedJob?.state === "active") return "active";
        await beforeRemove?.();
        removed.push(jobId);
        return "cancelled";
      },
      async () => undefined,
    );

    assertEquals(result, { cancelled: 1, active: 1 });
    assertEquals(removed, [String(queuedJobId)]);
    assertEquals(
      (await db.collection("jobs").findOne({ _id: queuedJobId }))?.state,
      "cancelled",
    );
    assertEquals(
      (await db.collection("jobs").findOne({ _id: activeJobId }))?.state,
      "active",
    );
    assertEquals(
      (await db.collection("media_recognition_batch_items").findOne({
        jobId: queuedJobId,
      }))?.state,
      "cancelled",
    );
    assertEquals(
      (await db.collection("media_recognition_batch_items").findOne({
        jobId: activeJobId,
      }))?.state,
      "queued",
    );
    assertEquals(
      (await db.collection("media_assets").findOne({
        _id: queuedAssetId,
      }))?.status,
      "staged",
    );
    assertEquals(
      (await db.collection("media_assets").findOne({
        _id: activeAssetId,
      }))?.status,
      "processing",
    );
  }),
);

Deno.test(
  "cancelled recognition batch closes a fresh unqueued claiming item",
  withFixtures(["Mongo"], async ({ db }) => {
    const owner = "cancel-fresh-claim-owner";
    const batchId = new ObjectId();
    const assetId = new ObjectId();
    const now = new Date();
    await db.collection("media_recognition_batches").insertOne({
      _id: batchId,
      owner,
      status: "running",
      cancelRequestedAt: now,
      counts: { total: 1, pending: 1 },
      createdAt: now,
      updatedAt: now,
    });
    await db.collection("media_assets").insertOne({
      _id: assetId,
      owner,
      kind: "image",
      status: "queued",
      createdAt: now,
      updatedAt: now,
    });
    await db.collection("media_recognition_batch_items").insertOne({
      _id: new ObjectId(),
      batchId,
      owner,
      assetId,
      state: "claiming",
      claimedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    const result = await processRecognitionBatch(db, batchId) as any;

    assertEquals(result.hasMore, false);
    assertEquals(result.progress.stage, "cancelled");
    assertEquals(result.progress.percent, 100);
    assertEquals(result.counts.cancelled, 1);
    assertEquals(
      (await db.collection("media_recognition_batch_items").findOne({
        batchId,
      }))?.state,
      "cancelled",
    );
    assertEquals(
      (await db.collection("media_assets").findOne({ _id: assetId }))?.status,
      "staged",
    );
  }),
);

Deno.test(
  "cancelled recognition batch keeps a claiming active child open",
  withFixtures(["Mongo"], async ({ db }) => {
    const owner = "cancel-claiming-active-owner";
    const batchId = new ObjectId();
    const assetId = new ObjectId();
    const jobId = new ObjectId();
    const now = new Date();
    await db.collection("media_recognition_batches").insertOne({
      _id: batchId,
      owner,
      status: "running",
      cancelRequestedAt: now,
      counts: { total: 1, pending: 1 },
      createdAt: now,
      updatedAt: now,
    });
    await db.collection("media_assets").insertOne({
      _id: assetId,
      owner,
      kind: "image",
      status: "processing",
      currentRunId: "provider-call",
      createdAt: now,
      updatedAt: now,
    });
    await db.collection("jobs").insertOne({
      _id: jobId,
      type: "mediaRecognition",
      state: "active",
      createdAt: now,
      updatedAt: now,
    });
    await db.collection("media_recognition_batch_items").insertOne({
      _id: new ObjectId(),
      batchId,
      owner,
      assetId,
      jobId,
      state: "claiming",
      claimedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    const result = await processRecognitionBatch(db, batchId) as any;

    assertEquals(result.hasMore, true);
    assertEquals(result.counts.processing, 1);
    assertEquals(result.progress.percent, 0);
    assertEquals(
      (await db.collection("media_recognition_batch_items").findOne({
        batchId,
      }))?.state,
      "processing",
    );
    assertEquals(
      (await db.collection("media_assets").findOne({ _id: assetId }))?.status,
      "processing",
    );
  }),
);

Deno.test(
  "queued child cancellation resumes after a crash before Bull removal",
  withFixtures(["Mongo"], async ({ db }) => {
    const owner = "cancel-before-remove-owner";
    const batchId = new ObjectId();
    const assetId = new ObjectId();
    const jobId = new ObjectId();
    const now = new Date();
    const batch = {
      _id: batchId,
      owner,
      status: "running",
      cancelRequestedAt: now,
      createdAt: now,
      updatedAt: now,
    };
    await db.collection("media_recognition_batches").insertOne(batch);
    await db.collection("media_assets").insertOne({
      _id: assetId,
      owner,
      kind: "image",
      status: "queued",
      createdAt: now,
      updatedAt: now,
    });
    await db.collection("jobs").insertOne({
      _id: jobId,
      type: "mediaRecognition",
      state: "waiting",
      createdAt: now,
      updatedAt: now,
    });
    await db.collection("media_recognition_batch_items").insertOne({
      _id: new ObjectId(),
      batchId,
      owner,
      assetId,
      jobId,
      state: "queued",
      createdAt: now,
      updatedAt: now,
    });

    await assertRejects(
      () =>
        cancelQueuedRecognitionChildren(
          db,
          batch,
          async (_jobId, _persistedJob, beforeRemove) => {
            await beforeRemove?.();
            throw new Error("simulated crash before Bull removal");
          },
          async () => undefined,
        ),
      Error,
      "simulated crash before Bull removal",
    );

    const interruptedJob = await db.collection("jobs").findOne({ _id: jobId });
    assertEquals(interruptedJob?.state, "cancelled");
    assertEquals(
      interruptedJob?.cancelReason,
      "media_recognition_batch_cancelled",
    );
    assertExists(interruptedJob?.mediaBatchCancellation);
    assertEquals(
      (await db.collection("media_recognition_batch_items").findOne({
        batchId,
      }))?.state,
      "queued",
    );
    assertEquals(
      (await db.collection("media_assets").findOne({ _id: assetId }))?.status,
      "queued",
    );

    await cancelQueuedRecognitionChildren(
      db,
      batch,
      async (_jobId, _persistedJob, beforeRemove) => {
        await beforeRemove?.();
        return "cancelled";
      },
      async () => undefined,
    );

    assertEquals(
      (await db.collection("media_recognition_batch_items").findOne({
        batchId,
      }))?.state,
      "cancelled",
    );
    assertEquals(
      (await db.collection("media_assets").findOne({ _id: assetId }))?.status,
      "staged",
    );
  }),
);

Deno.test(
  "queued child cancellation resumes after asset reset before item close",
  withFixtures(["Mongo"], async ({ db }) => {
    const owner = "cancel-after-asset-owner";
    const batchId = new ObjectId();
    const assetId = new ObjectId();
    const jobId = new ObjectId();
    const now = new Date();
    const batch = {
      _id: batchId,
      owner,
      status: "running",
      cancelRequestedAt: now,
      createdAt: now,
      updatedAt: now,
    };
    await db.collection("media_recognition_batches").insertOne(batch);
    await db.collection("media_assets").insertOne({
      _id: assetId,
      owner,
      kind: "image",
      status: "queued",
      createdAt: now,
      updatedAt: now,
    });
    await db.collection("jobs").insertOne({
      _id: jobId,
      type: "mediaRecognition",
      state: "waiting",
      createdAt: now,
      updatedAt: now,
    });
    await db.collection("media_recognition_batch_items").insertOne({
      _id: new ObjectId(),
      batchId,
      owner,
      assetId,
      jobId,
      state: "queued",
      createdAt: now,
      updatedAt: now,
    });

    await assertRejects(
      () =>
        cancelQueuedRecognitionChildren(
          db,
          batch,
          async (_jobId, _persistedJob, beforeRemove) => {
            await beforeRemove?.();
            return "cancelled";
          },
          async () => undefined,
          {
            afterAssetReset: () =>
              Promise.reject(
                new Error("simulated crash after asset reset"),
              ),
          },
        ),
      Error,
      "simulated crash after asset reset",
    );

    assertEquals(
      (await db.collection("jobs").findOne({ _id: jobId }))?.state,
      "cancelled",
    );
    assertEquals(
      (await db.collection("media_assets").findOne({ _id: assetId }))?.status,
      "staged",
    );
    assertEquals(
      (await db.collection("media_recognition_batch_items").findOne({
        batchId,
      }))?.state,
      "queued",
    );

    await cancelQueuedRecognitionChildren(
      db,
      batch,
      async (_jobId, _persistedJob, beforeRemove) => {
        await beforeRemove?.();
        return "cancelled";
      },
      async () => undefined,
    );

    assertEquals(
      (await db.collection("media_recognition_batch_items").findOne({
        batchId,
      }))?.state,
      "cancelled",
    );
    assertEquals(
      (await db.collection("media_assets").findOne({ _id: assetId }))?.status,
      "staged",
    );
  }),
);

Deno.test(
  "terminal child reconciliation stages an untouched queued asset first",
  withFixtures(["Mongo"], async ({ db }) => {
    const owner = "cancel-active-race-owner";
    const batchId = new ObjectId();
    const assetId = new ObjectId();
    const jobId = new ObjectId();
    const now = new Date();
    const batch = {
      _id: batchId,
      owner,
      status: "running",
      cancelRequestedAt: now,
      createdAt: now,
      updatedAt: now,
    };
    await db.collection("media_recognition_batches").insertOne(batch);
    await db.collection("media_assets").insertOne({
      _id: assetId,
      owner,
      kind: "image",
      status: "queued",
      createdAt: now,
      updatedAt: now,
    });
    await db.collection("jobs").insertOne({
      _id: jobId,
      type: "mediaRecognition",
      state: "failed",
      failedReason: "cancelled before execution",
      createdAt: now,
      updatedAt: now,
    });
    await db.collection("media_recognition_batch_items").insertOne({
      _id: new ObjectId(),
      batchId,
      owner,
      assetId,
      jobId,
      state: "queued",
      createdAt: now,
      updatedAt: now,
    });

    const reconciled = await reconcileRecognitionBatch(db, batch);

    assertEquals(reconciled.status, "cancelled");
    assertEquals(reconciled.counts.failed, 1);
    assertEquals(
      (await db.collection("media_recognition_batch_items").findOne({
        batchId,
      }))?.state,
      "failed",
    );
    assertEquals(
      (await db.collection("media_assets").findOne({ _id: assetId }))?.status,
      "staged",
    );
  }),
);

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
