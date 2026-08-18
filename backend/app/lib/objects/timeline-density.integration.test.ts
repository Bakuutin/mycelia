import { expect } from "@std/expect";
import { type Db, ObjectId } from "mongodb";
import { withFixtures } from "@/tests/fixtures.server.ts";
import { up as ensureTimelineRangeIndex } from "../../../migrations/0043_timeline_object_range_index.ts";
import { up as ensureObjectDensityCollections } from "../../../migrations/0052_object_timeline_density.ts";
import { getObjectTimelineDensity } from "./timeline-density.server.ts";
import {
  drainObjectDensityPending,
  ObjectDensityLeaseConflictError,
  persistObjectDensityChange,
  rebuildObjectTimelineDensity,
  recoverObjectDensityPending,
} from "./timeline-density.worker.ts";
import {
  OBJECT_TIMELINE_DENSITY_COLLECTION,
  OBJECT_TIMELINE_DENSITY_INDEX,
  OBJECT_TIMELINE_DENSITY_PENDING_COLLECTION,
  OBJECT_TIMELINE_DENSITY_SOURCE_COLLECTION,
  OBJECT_TIMELINE_DENSITY_STATE_COLLECTION,
} from "./timeline-density.ts";
import { TIMELINE_OBJECT_RANGE_INDEX } from "./timeline-query.ts";

async function setupDensity(db: Db) {
  await ensureTimelineRangeIndex(db);
  await ensureObjectDensityCollections(db);
}

Deno.test(
  "object density rebuild always discovers and covers the full canonical range",
  withFixtures(["Mongo"], async ({ db }) => {
    await setupDensity(db);
    await db.collection("objects").insertMany([
      {
        _id: new ObjectId(),
        isPerson: true,
        timeRanges: [{ start: new Date("2020-01-02T03:15:00.000Z") }],
      },
      {
        _id: new ObjectId(),
        isEvent: true,
        timeRanges: [{ start: new Date("2030-06-07T08:45:00.000Z") }],
      },
    ]);

    const result = await rebuildObjectTimelineDensity(db, {
      windowMs: 20 * 365 * 24 * 60 * 60 * 1_000,
    });
    expect(result.ready).toBe(true);
    expect(result.start).toEqual(new Date("2020-01-02T03:00:00.000Z"));
    expect(result.end).toEqual(new Date("2030-06-07T09:00:00.000Z"));
    expect(result.sourceObjects).toBe(2);
    expect(
      await db.collection(OBJECT_TIMELINE_DENSITY_COLLECTION).countDocuments({
        resolution: "1hour",
      }),
    ).toBe(2);
    expect(
      await db.collection(OBJECT_TIMELINE_DENSITY_COLLECTION).indexExists(
        OBJECT_TIMELINE_DENSITY_INDEX,
      ),
    ).toBe(true);
  }),
);

Deno.test(
  "object density rebuild lease rejects a concurrent generation",
  withFixtures(["Mongo"], async ({ db }) => {
    await setupDensity(db);
    await db.collection("objects").insertOne({
      _id: new ObjectId(),
      isPerson: true,
      timeRanges: [{ start: new Date("2026-08-18T01:00:00.000Z") }],
    });

    let enteredResolve!: () => void;
    let releaseResolve!: () => void;
    const entered = new Promise<void>((resolve) => enteredResolve = resolve);
    const release = new Promise<void>((resolve) => releaseResolve = resolve);
    const first = rebuildObjectTimelineDensity(db, {
      leaseOwner: "first",
      onProgress: async () => {
        enteredResolve();
        await release;
      },
    });
    await entered;
    await expect(
      rebuildObjectTimelineDensity(db, { leaseOwner: "second" }),
    ).rejects.toBeInstanceOf(ObjectDensityLeaseConflictError);
    releaseResolve();
    expect((await first).ready).toBe(true);
  }),
);

Deno.test(
  "durable recovery coalesces a burst into unique bucket recalculations",
  withFixtures(["Mongo"], async ({ db }) => {
    await setupDensity(db);
    expect((await rebuildObjectTimelineDensity(db)).ready).toBe(true);
    const sameHour = new Date("2026-08-18T01:10:00.000Z");
    const ids = Array.from({ length: 20 }, () => new ObjectId());
    await db.collection("objects").insertMany(ids.map((_id) => ({
      _id,
      isPerson: true,
      timeRanges: [{ start: sameHour }],
    })));
    for (const id of ids) {
      await persistObjectDensityChange(db, {
        operationType: "insert",
        documentId: id,
      });
    }
    expect(
      await db.collection(OBJECT_TIMELINE_DENSITY_PENDING_COLLECTION)
        .countDocuments(),
    ).toBe(20);

    const recovered = await recoverObjectDensityPending(db, {
      drainNow: true,
    });
    expect(recovered?.busy).toBe(false);
    expect(recovered?.processedObjects).toBe(20);
    expect(recovered?.recalculatedBuckets).toBe(3);
    expect(recovered?.ready).toBe(true);
    expect(
      await db.collection(OBJECT_TIMELINE_DENSITY_PENDING_COLLECTION)
        .countDocuments(),
    ).toBe(0);
    const state = await db.collection(OBJECT_TIMELINE_DENSITY_STATE_COLLECTION)
      .findOne({ _id: "current" });
    expect(state?.dirty).toBe(false);
    expect(state?.pendingWrites).toEqual([]);
  }),
);

Deno.test(
  "incremental failure keeps pending work, marks buckets stale, and reports repair state",
  withFixtures(["Mongo"], async ({ db }) => {
    await setupDensity(db);
    const id = new ObjectId();
    await db.collection("objects").insertOne({
      _id: id,
      isPerson: true,
      timeRanges: [{ start: new Date("2026-08-18T01:00:00.000Z") }],
    });
    await rebuildObjectTimelineDensity(db);
    await db.collection("objects").updateOne(
      { _id: id },
      {
        $set: { timeRanges: [{ start: new Date("2026-08-18T02:00:00.000Z") }] },
      },
    );
    await persistObjectDensityChange(db, {
      operationType: "update",
      documentId: id,
    });
    await db.collection("objects").dropIndex(TIMELINE_OBJECT_RANGE_INDEX);

    await expect(drainObjectDensityPending(db)).rejects.toThrow();
    const failed = await db.collection(OBJECT_TIMELINE_DENSITY_STATE_COLLECTION)
      .findOne({ _id: "current" });
    expect(failed?.ready).toBe(false);
    expect(failed?.dirty).toBe(true);
    expect(failed?.repairStatus).toBe("failed");
    expect(
      await db.collection(OBJECT_TIMELINE_DENSITY_PENDING_COLLECTION)
        .countDocuments(),
    ).toBe(1);
    const visible = await getObjectTimelineDensity({
      start: "2026-08-18T00:00:00.000Z",
      end: "2026-08-18T03:00:00.000Z",
      resolution: "1hour",
    }, db);
    expect(visible.ready).toBe(false);
    expect(visible.dirty).toBe(true);
    expect(visible.repairStatus).toBe("failed");
    expect(visible.buckets.every((bucket) => bucket.stale)).toBe(true);

    await ensureTimelineRangeIndex(db);
    expect((await drainObjectDensityPending(db)).ready).toBe(true);
    const repaired = await getObjectTimelineDensity({
      start: "2026-08-18T00:00:00.000Z",
      end: "2026-08-18T03:00:00.000Z",
      resolution: "1hour",
    }, db);
    expect(
      repaired.buckets.map((
        bucket,
      ) => [bucket.start.getUTCHours(), bucket.total]),
    ).toEqual([[2, 1]]);
  }),
);

Deno.test(
  "rebuild seeds the scanned old source when a move lands between bucket and source writes",
  withFixtures(["Mongo"], async ({ db }) => {
    await setupDensity(db);
    const movingId = new ObjectId();
    await db.collection("objects").insertMany([
      {
        _id: movingId,
        isPerson: true,
        timeRanges: [{ start: new Date("2026-01-01T01:00:00.000Z") }],
      },
      {
        _id: new ObjectId(),
        isEvent: true,
        timeRanges: [{ start: new Date("2026-01-04T01:00:00.000Z") }],
      },
    ]);

    let materializedResolve!: () => void;
    let continueResolve!: () => void;
    const materialized = new Promise<void>((resolve) => {
      materializedResolve = resolve;
    });
    const continueBuild = new Promise<void>((resolve) => {
      continueResolve = resolve;
    });
    let paused = false;
    const rebuild = rebuildObjectTimelineDensity(db, {
      windowMs: 24 * 60 * 60 * 1_000,
      onHourBucketsMaterialized: async () => {
        if (paused) return;
        paused = true;
        materializedResolve();
        await continueBuild;
      },
    });
    await materialized;
    await db.collection("objects").updateOne(
      { _id: movingId },
      {
        $set: {
          timeRanges: [{ start: new Date("2026-01-03T01:00:00.000Z") }],
        },
      },
    );
    await persistObjectDensityChange(db, {
      operationType: "update",
      documentId: movingId,
    });
    const beforeSourceWrite = await db.collection(
      OBJECT_TIMELINE_DENSITY_PENDING_COLLECTION,
    ).findOne({ _id: movingId });
    expect(beforeSourceWrite?.oldSource).toBeNull();
    continueResolve();
    expect((await rebuild).ready).toBe(true);

    const hours = await db.collection(OBJECT_TIMELINE_DENSITY_COLLECTION).find(
      { resolution: "1hour" },
      { sort: { start: 1 } },
    ).toArray();
    expect(hours.map((bucket: any) => [
      bucket.start.toISOString(),
      bucket.total,
    ])).toEqual([
      ["2026-01-03T01:00:00.000Z", 1],
      ["2026-01-04T01:00:00.000Z", 1],
    ]);
    const source = await db.collection(
      OBJECT_TIMELINE_DENSITY_SOURCE_COLLECTION,
    ).findOne({ _id: movingId });
    expect(source?.starts).toEqual([
      new Date("2026-01-03T01:00:00.000Z"),
    ]);
  }),
);

Deno.test(
  "post-build drain preserves the earliest source when an object moves between windows",
  withFixtures(["Mongo"], async ({ db }) => {
    await setupDensity(db);
    const movingId = new ObjectId();
    await db.collection("objects").insertMany([
      {
        _id: movingId,
        isPerson: true,
        timeRanges: [{ start: new Date("2026-01-01T01:00:00.000Z") }],
      },
      {
        _id: new ObjectId(),
        isEvent: true,
        timeRanges: [{ start: new Date("2026-01-04T01:00:00.000Z") }],
      },
    ]);

    let firstWindowResolve!: () => void;
    let continueResolve!: () => void;
    const firstWindow = new Promise<void>((resolve) => {
      firstWindowResolve = resolve;
    });
    const continueBuild = new Promise<void>((resolve) => {
      continueResolve = resolve;
    });
    let paused = false;
    const rebuild = rebuildObjectTimelineDensity(db, {
      windowMs: 24 * 60 * 60 * 1_000,
      onProgress: async () => {
        if (paused) return;
        paused = true;
        firstWindowResolve();
        await continueBuild;
      },
    });
    await firstWindow;
    await db.collection("objects").updateOne(
      { _id: movingId },
      {
        $set: { timeRanges: [{ start: new Date("2026-01-03T01:00:00.000Z") }] },
      },
    );
    await persistObjectDensityChange(db, {
      operationType: "update",
      documentId: movingId,
    });
    const queued = await db.collection(
      OBJECT_TIMELINE_DENSITY_PENDING_COLLECTION,
    )
      .findOne({ _id: movingId });
    expect(queued?.oldSource?.starts).toEqual([
      new Date("2026-01-01T01:00:00.000Z"),
    ]);
    continueResolve();
    expect((await rebuild).ready).toBe(true);

    const hours = await db.collection(OBJECT_TIMELINE_DENSITY_COLLECTION).find(
      { resolution: "1hour" },
      { sort: { start: 1 } },
    ).toArray();
    expect(hours.map((bucket: any) => [
      bucket.start.toISOString(),
      bucket.total,
    ]))
      .toEqual([
        ["2026-01-03T01:00:00.000Z", 1],
        ["2026-01-04T01:00:00.000Z", 1],
      ]);
    const source = await db.collection(
      OBJECT_TIMELINE_DENSITY_SOURCE_COLLECTION,
    )
      .findOne({ _id: movingId });
    expect(source?.starts).toEqual([new Date("2026-01-03T01:00:00.000Z")]);
    const state = await db.collection(OBJECT_TIMELINE_DENSITY_STATE_COLLECTION)
      .findOne({ _id: "current" });
    expect(state?.ready).toBe(true);
    expect(state?.dirty).toBe(false);
  }),
);
