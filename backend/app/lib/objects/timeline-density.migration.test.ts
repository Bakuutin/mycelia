import { expect } from "@std/expect";
import type { Db } from "mongodb";
import { withFixtures } from "@/tests/fixtures.server.ts";
import { up as ensureDurableDensityQueue } from "../../../migrations/0053_object_timeline_density_durable_queue.ts";
import {
  OBJECT_TIMELINE_DENSITY_PENDING_COLLECTION,
  OBJECT_TIMELINE_DENSITY_PENDING_INDEX,
  OBJECT_TIMELINE_DENSITY_STATE_COLLECTION,
} from "./timeline-density.ts";

type DensityStateDocument = {
  _id: string;
  [key: string]: unknown;
};

Deno.test(
  "density durable queue migration creates missing schema idempotently",
  withFixtures(["Mongo"], async ({ db }) => {
    const database = db as Db;
    await ensureDurableDensityQueue(database);
    await ensureDurableDensityQueue(database);

    expect(
      await database.collection(OBJECT_TIMELINE_DENSITY_PENDING_COLLECTION)
        .indexExists(OBJECT_TIMELINE_DENSITY_PENDING_INDEX),
    ).toBe(true);
    expect(
      await database.collection<DensityStateDocument>(
        OBJECT_TIMELINE_DENSITY_STATE_COLLECTION,
      ).findOne({ _id: "current" }),
    ).toMatchObject({
      ready: false,
      building: false,
      dirty: true,
      repairStatus: "not-built",
      hasFullRebuild: false,
      changeSequence: 0,
      processedSequence: 0,
      pendingWrites: [],
    });
  }),
);

Deno.test(
  "density durable queue migration preserves existing ready data",
  withFixtures(["Mongo"], async ({ db }) => {
    const database = db as Db;
    const calculatedAt = new Date("2026-08-18T12:00:00.000Z");
    await database.collection<DensityStateDocument>(
      OBJECT_TIMELINE_DENSITY_STATE_COLLECTION,
    ).insertOne({
      _id: "current",
      ready: true,
      calculatedAt,
      sourceObjects: 247_000,
      changeSequence: 12,
      rolloutNote: "keep-me",
    });

    await ensureDurableDensityQueue(database);
    const state = await database.collection<DensityStateDocument>(
      OBJECT_TIMELINE_DENSITY_STATE_COLLECTION,
    ).findOne({ _id: "current" });
    expect(state).toMatchObject({
      ready: true,
      building: false,
      dirty: false,
      repairStatus: "ready",
      hasFullRebuild: true,
      changeSequence: 12,
      processedSequence: 12,
      pendingWrites: [],
      calculatedAt,
      sourceObjects: 247_000,
      rolloutNote: "keep-me",
    });

    await database.collection<DensityStateDocument>(
      OBJECT_TIMELINE_DENSITY_STATE_COLLECTION,
    ).updateOne(
      { _id: "current" },
      {
        $set: {
          dirty: true,
          repairStatus: "failed",
          pendingWrites: [{ token: "keep-token", sequence: 13 }],
        },
      },
    );
    await ensureDurableDensityQueue(database);
    expect(
      await database.collection<DensityStateDocument>(
        OBJECT_TIMELINE_DENSITY_STATE_COLLECTION,
      ).findOne({ _id: "current" }),
    ).toMatchObject({
      ready: true,
      dirty: true,
      repairStatus: "failed",
      pendingWrites: [{ token: "keep-token", sequence: 13 }],
      calculatedAt,
      sourceObjects: 247_000,
      rolloutNote: "keep-me",
    });
  }),
);
