import { assertEquals } from "jsr:@std/assert@^1.0.15";
import { ObjectId } from "mongodb";
import { withFixtures } from "@/tests/fixtures.server.ts";
import { up as ensureMediaEvents } from "../../../migrations/0076_media_events.ts";

Deno.test(
  "media event migration stales overlapping historical losers",
  withFixtures(["Mongo"], async ({ db }) => {
    const winnerId = new ObjectId("000000000000000000000101");
    const loserId = new ObjectId("000000000000000000000102");
    const winnerOnly = new ObjectId("000000000000000000000201");
    const shared = new ObjectId("000000000000000000000202");
    const loserOnly = new ObjectId("000000000000000000000203");
    const createdAt = new Date("2026-08-20T12:00:00.000Z");

    await db.collection("media_events").insertMany([
      {
        _id: winnerId,
        owner: "admin",
        stableKey: "winner",
        status: "ready",
        assetIds: [winnerOnly, shared],
        consentReceiptId: "winner-receipt",
        currentRunId: "winner-run",
        analysis: { title: "winner" },
        createdAt,
        updatedAt: createdAt,
      },
      {
        _id: loserId,
        owner: "admin",
        stableKey: "loser",
        status: "ready",
        // Insert a unique membership before the conflict to prove rollback.
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

    await ensureMediaEvents(db);
    await ensureMediaEvents(db);

    const winner = await db.collection("media_events").findOne({
      _id: winnerId,
    });
    const loser = await db.collection("media_events").findOne({ _id: loserId });
    assertEquals(winner?.status, "ready");
    assertEquals(loser?.status, "stale");
    assertEquals(loser?.consentReceiptId, "loser-receipt");
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
      memberships.every((membership: { eventId?: ObjectId }) =>
        String(membership.eventId) === String(winnerId)
      ),
      true,
    );
  }),
);
