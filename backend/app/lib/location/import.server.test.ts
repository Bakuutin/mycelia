import { expect } from "@std/expect";
import { ObjectId } from "bson";
import {
  analyzeLocationDataset,
  pointHash,
  trackFingerprint,
} from "./import.server.ts";
import type { ParsedPoint, ParseResult } from "./parse.server.ts";

Deno.test("point hashes preserve valid same-time coordinate variants", () => {
  const ts = new Date("2026-08-17T10:00:00Z");
  expect(pointHash({ ts, lat: 41.7, lng: 44.8 })).not.toBe(
    pointHash({ ts, lat: 41.7002, lng: 44.8002 }),
  );
});

Deno.test("track fingerprint matches GPX/KMZ geometry despite elevation placeholders", () => {
  const common = {
    kind: "untimed-path" as const,
    sourceIndex: 0,
  };
  expect(trackFingerprint({
    ...common,
    coordinates: [{ lat: 41.7, lng: 44.8 }],
  })).toBe(trackFingerprint({
    ...common,
    coordinates: [{ lat: 41.7, lng: 44.8, ele: 0 }],
  }));
});

Deno.test("analysis handles more than 1000 matches and within-file duplicates", async () => {
  const sourceImportId = new ObjectId();
  const points: ParsedPoint[] = Array.from({ length: 2500 }, (_, index) => ({
    ts: new Date(Date.UTC(2026, 0, 1, 0, 0, 0, index)),
    lat: 41.7,
    lng: 44.8,
  }));
  const dataset: ParseResult = {
    points: [...points, points[1200]],
    tracks: [],
    bookmarks: [],
    datasetMetadata: {},
    skipped: 0,
    untimedCoordinates: 0,
    invalidCoordinates: 0,
    invalidTimestamps: 0,
    unpairedCoordinates: 0,
    unpairedTimestamps: 0,
    unsupportedGeometries: 0,
  };
  const stored = new Map(points.map((point) => [pointHash(point), {
    hash: pointHash(point),
    ts: point.ts,
    loc: { type: "Point", coordinates: [point.lng, point.lat] },
    importIds: [sourceImportId],
    visible: true,
  }]));
  const mongo = async (input: any): Promise<any> => {
    if (input.action === "findOne") return null;
    if (input.action === "find" && input.collection === "location_points") {
      const hashes: string[] = input.query.hash?.$in ?? [];
      expect(input.options.limit).toBeGreaterThanOrEqual(hashes.length);
      return hashes.map((hash) => stored.get(hash)).filter(Boolean).slice(
        0,
        input.options.limit,
      );
    }
    if (input.action === "find" && input.collection === "location_imports") {
      return [{
        _id: sourceImportId,
        filename: "existing.gpx",
        committedAt: new Date(),
      }];
    }
    if (input.action === "find") return [];
    throw new Error(`Unexpected mock operation: ${JSON.stringify(input)}`);
  };

  const analysis = await analyzeLocationDataset(
    mongo,
    "incoming.kmz",
    "kmz",
    "content-hash",
    dataset,
  );
  expect(analysis.public.counts.sourcePoints).toBe(2501);
  expect(analysis.public.counts.uniquePoints).toBe(2500);
  expect(analysis.public.counts.matchedPoints).toBe(2500);
  expect(analysis.public.counts.newPoints).toBe(0);
  expect(analysis.public.counts.withinFileDuplicates).toBe(1);
  expect(analysis.public.duplicateSources).toEqual([{
    importId: String(sourceImportId),
    filename: "existing.gpx",
    matchedPoints: 2500,
  }]);
});
