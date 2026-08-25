import { assertEquals, assertExists } from "jsr:@std/assert@^1.0.15";
import { type Db, ObjectId } from "mongodb";
import { withFixtures } from "@/tests/fixtures.server.ts";
import {
  MEDIA_EVENT_HARDENING_COLLECTIONS,
  MEDIA_EVENT_HARDENING_INDEXES,
  up as hardenMediaEvents,
} from "../../../migrations/0077_media_event_hardening.ts";

async function ensureTestCollection(db: Db, name: string) {
  if ((await db.listCollections({ name }).toArray()).length === 0) {
    await db.createCollection(name);
  }
}

Deno.test(
  "0077 repairs an early-0076 partial schema idempotently",
  withFixtures(["Mongo"], async ({ db }) => {
    // This is the observed live drift: 0076 was recorded after only these
    // event collections existed. Objects predate the media-event feature.
    for (
      const name of [
        "media_events",
        "media_event_runs",
        "media_event_aggregation_previews",
        "media_event_links",
        "objects",
      ]
    ) {
      await ensureTestCollection(db, name);
    }

    const winnerId = new ObjectId("000000000000000000000101");
    const loserId = new ObjectId("000000000000000000000102");
    const winnerOnly = new ObjectId("000000000000000000000201");
    const shared = new ObjectId("000000000000000000000202");
    const loserOnly = new ObjectId("000000000000000000000203");
    const createdAt = new Date("2026-08-20T12:00:00.000Z");
    const receipt = {
      id: "winner-receipt",
      hash: "a".repeat(64),
      principal: "admin",
      groupStableKey: "winner",
      assetIds: [winnerOnly, shared],
      sourceHashes: ["b".repeat(64), "c".repeat(64)],
      representativeAssetIds: [winnerOnly, shared],
      providerSnapshot: null,
      profileFingerprint: null,
      privacyVersion: "preview-only-no-identity-v1",
      costCeilingUsd: 0,
      queueAnalysis: false,
      confirmedAt: createdAt,
    };
    await db.collection("media_events").insertMany([
      {
        _id: winnerId,
        owner: "admin",
        stableKey: "winner",
        status: "ready",
        assetIds: [winnerOnly, shared],
        consentReceiptId: receipt.id,
        consentReceipt: receipt,
        currentRunId: "winner-run",
        analysis: { title: "winner" },
        publicationReview: {
          runId: "winner-run",
          principal: "admin",
          reviewedSensitiveText: true,
          reviewedAt: createdAt,
        },
        createdAt,
        updatedAt: createdAt,
      },
      {
        _id: loserId,
        owner: "admin",
        stableKey: "loser",
        status: "ready",
        // A unique membership is inserted before the shared conflict so the
        // migration must roll it back when this historical event loses.
        assetIds: [loserOnly, shared],
        consentReceiptId: "loser-receipt",
        currentRunId: "loser-run",
        jobId: new ObjectId(),
        previewSnapshots: [{ assetId: loserOnly }],
        analysis: { title: "loser" },
        createdAt,
        updatedAt: createdAt,
      },
    ]);
    await db.collection("media_event_runs").insertOne({
      _id: "winner-run",
      runKey: "winner-run",
      owner: "admin",
      eventId: winnerId,
      state: "ready",
      createdAt,
      updatedAt: createdAt,
    });
    await db.collection("objects").insertMany([
      {
        _id: new ObjectId(),
        isEvent: true,
        _listCategories: ["event"],
        metadata: { mediaEvent: { eventId: winnerId, stale: false } },
      },
      {
        _id: new ObjectId(),
        isEvent: true,
        _listCategories: ["event"],
        metadata: { mediaEvent: { eventId: loserId, stale: false } },
      },
    ]);

    await hardenMediaEvents(db);
    const firstLoser = await db.collection("media_events").findOne({
      _id: loserId,
    });
    const firstTombstone = firstLoser?.deletionTombstoneId;
    const readDurableState = () =>
      Promise.all([
        db.collection("media_events").find({ owner: "admin" }).sort({ _id: 1 })
          .toArray(),
        db.collection("media_event_memberships").find({ owner: "admin" }).sort(
          { _id: 1 },
        ).toArray(),
        db.collection("media_event_runs").find({ owner: "admin" }).sort({
          _id: 1,
        }).toArray(),
        db.collection("media_event_consent_receipts").find({ owner: "admin" })
          .sort({ _id: 1 }).toArray(),
        db.collection("media_event_publication_reviews").find({
          owner: "admin",
        })
          .sort({ _id: 1 }).toArray(),
        db.collection("objects").find({
          "metadata.mediaEvent.eventId": { $in: [winnerId, loserId] },
        }).sort({ _id: 1 }).toArray(),
      ]);
    const firstDurableState = await readDurableState();
    await hardenMediaEvents(db);
    assertEquals(await readDurableState(), firstDurableState);

    const collectionNames = new Set(
      (await db.listCollections().toArray()).map((entry: { name: string }) =>
        entry.name
      ),
    );
    for (const name of MEDIA_EVENT_HARDENING_COLLECTIONS) {
      assertEquals(collectionNames.has(name), true, `missing ${name}`);
    }

    for (const required of MEDIA_EVENT_HARDENING_INDEXES) {
      const actual = (await db.collection(required.collection).listIndexes()
        .toArray()).find((index: { name?: string }) =>
          index.name === required.name
        );
      assertExists(actual, `missing ${required.collection}.${required.name}`);
      assertEquals(actual.key, required.keys, `${required.name} keys`);
      assertEquals(
        Boolean(actual.unique),
        Boolean(required.options?.unique),
        `${required.name} unique`,
      );
      assertEquals(
        Boolean(actual.sparse),
        Boolean(required.options?.sparse),
        `${required.name} sparse`,
      );
      assertEquals(
        actual.expireAfterSeconds ?? null,
        required.options?.expireAfterSeconds ?? null,
        `${required.name} TTL`,
      );
      assertEquals(
        actual.partialFilterExpression ?? null,
        required.options?.partialFilterExpression ?? null,
        `${required.name} partial filter`,
      );
    }

    const reservedTtl = (await db.collection("media_event_memberships")
      .listIndexes().toArray()).find((index: { name?: string }) =>
        index.name === "media_event_membership_reservation_ttl_v1"
      );
    assertEquals(reservedTtl?.key, { reservationExpiresAt: 1 });
    assertEquals(reservedTtl?.expireAfterSeconds, 0);
    assertEquals(reservedTtl?.partialFilterExpression, { status: "reserved" });

    const winner = await db.collection("media_events").findOne({
      _id: winnerId,
    });
    const loser = await db.collection("media_events").findOne({ _id: loserId });
    assertEquals(winner?.status, "ready");
    assertEquals(winner?.deletionGeneration, 0);
    assertEquals(loser?.status, "stale");
    assertEquals(loser?.deletionGeneration, 1);
    assertEquals(loser?.deletionTombstoneId, firstTombstone);
    assertEquals(String(loser?.deletionTombstoneId).length, 64);
    assertEquals(loser?.analysis, undefined);
    assertEquals(loser?.currentRunId, undefined);
    assertEquals(loser?.jobId, undefined);
    assertEquals(loser?.previewSnapshots, undefined);

    const memberships = await db.collection("media_event_memberships")
      .find({ owner: "admin" })
      .sort({ assetId: 1 })
      .toArray();
    assertEquals(memberships.length, 2);
    assertEquals(
      memberships.every((membership: Record<string, any>) =>
        membership.status === "active" &&
        String(membership.eventId) === String(winnerId) &&
        membership.reservationExpiresAt === undefined
      ),
      true,
    );

    assertEquals(
      (await db.collection("media_event_runs").findOne({ _id: "winner-run" }))
        ?.deletionGeneration,
      0,
    );
    assertExists(
      await db.collection("media_event_consent_receipts").findOne({
        _id: receipt.id,
        owner: "admin",
        eventId: winnerId,
      }),
    );
    assertExists(
      await db.collection("media_event_publication_reviews").findOne({
        owner: "admin",
        eventId: winnerId,
        runId: "winner-run",
      }),
    );

    const winnerObject = await db.collection("objects").findOne({
      "metadata.mediaEvent.eventId": winnerId,
    });
    const loserObject = await db.collection("objects").findOne({
      "metadata.mediaEvent.eventId": loserId,
    });
    assertEquals(winnerObject?.metadata?.mediaEvent?.deletionGeneration, 0);
    assertEquals(loserObject?.isEvent, false);
    assertEquals(loserObject?._listCategories, []);
    assertEquals(loserObject?.metadata?.mediaEvent?.stale, true);
    assertEquals(
      loserObject?.metadata?.mediaEvent?.deletionTombstoneId,
      firstTombstone,
    );
  }),
);
