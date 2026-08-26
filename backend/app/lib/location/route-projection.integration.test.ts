import { expect } from "@std/expect";
import { ObjectId } from "mongodb";
import { withFixtures } from "@/tests/fixtures.server.ts";
import { up as createRouteProjection } from "../../../migrations/0069_location_route_projection.ts";
import {
  getMapRouteDetail,
  LOCATION_ROUTE_CONFLICTS,
  LOCATION_ROUTE_STATE,
  rebuildLocationRouteProjection,
} from "./route-projection.server.ts";

Deno.test(
  "independent simultaneous tracks remain separate and create review",
  withFixtures(["Mongo"], async ({ db }) => {
    await createRouteProjection(db);
    await createRouteProjection(db);
    const capeId = new ObjectId();
    const tbilisiId = new ObjectId();
    await db.collection("location_tracks").insertMany([
      {
        _id: capeId,
        fingerprint: "cape",
        displayName: "My Places",
        geometryCompleteness: "full",
      },
      {
        _id: tbilisiId,
        fingerprint: "tbilisi",
        displayName: "may6-track.gpx",
        geometryCompleteness: "full",
      },
    ]);
    const points = (lng: number, lat: number) =>
      Array.from({ length: 6 }, (_, index) => ({
        index,
        coordinates: [lng + index * 0.001, lat],
        ts: new Date(Date.UTC(2026, 4, 6, 12, index * 2, 0)),
        sourceFragmentIndex: 0,
        sourcePointIndex: index,
      }));
    await db.collection("location_track_geometry").insertMany([
      { trackId: capeId, chunkIndex: 0, points: points(18.4, -33.9) },
      { trackId: tbilisiId, chunkIndex: 0, points: points(44.8, 41.7) },
    ]);

    const rebuilt = await rebuildLocationRouteProjection(db, {
      onProgress: async ({ processed }) => {
        if (processed !== 1) return;
        await db.collection(LOCATION_ROUTE_STATE).updateOne(
          { _id: "current" },
          {
            $set: {
              dirty: true,
              sourceChangedAt: new Date(Date.now() + 60_000),
            },
          },
        );
      },
    });
    expect(rebuilt.conflicts).toBe(1);
    expect(
      await db.collection(LOCATION_ROUTE_CONFLICTS).countDocuments({
        status: "pending",
      }),
    ).toBe(1);

    const detail = await getMapRouteDetail(db, {
      start: new Date("2026-05-06T11:00:00Z"),
      end: new Date("2026-05-06T14:00:00Z"),
      bounds: { west: -180, east: 180, south: -90, north: 90 },
      zoom: 8,
      includeConnectors: false,
    });
    expect(
      new Set(detail.fragments.map((fragment) => String(fragment.trackId)))
        .size,
    ).toBe(2);
    expect(detail.connectors).toEqual([]);
    expect(detail.conflicts).toHaveLength(1);
    expect(
      await db.collection(LOCATION_ROUTE_STATE).findOne({
        _id: "current",
      }),
    ).toMatchObject({ ready: true, dirty: true, status: "stale" });
  }),
);
