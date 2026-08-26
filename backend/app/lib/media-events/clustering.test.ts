import { expect } from "@std/expect";
import {
  clusterMediaEventAssets,
  selectRepresentativeAssetIndexes,
} from "./clustering.ts";

const time = (minutes: number) =>
  new Date(Date.parse("2026-08-22T08:00:00.000Z") + minutes * 60_000);

const options = {
  maxGapMinutes: 240,
  maxDistanceKm: 25,
  maxAssetsPerEvent: 50,
};

Deno.test("media event clustering is deterministic by time then asset id", () => {
  const assets = [
    {
      assetId: "c",
      capturedAt: time(20),
      location: { latitude: 40.18, longitude: 44.51 },
    },
    {
      assetId: "b",
      capturedAt: time(10),
      location: { latitude: 40.19, longitude: 44.52 },
    },
    {
      assetId: "a",
      capturedAt: time(10),
      location: { latitude: 40.18, longitude: 44.51 },
    },
  ];
  const forward = clusterMediaEventAssets(assets, options);
  const reverse = clusterMediaEventAssets([...assets].reverse(), options);
  expect(forward).toEqual(reverse);
  expect(forward.clusters[0].assetIds).toEqual(["a", "b", "c"]);
  expect(forward.clusters[0].startAt).toEqual(time(10));
  expect(forward.clusters[0].endAt).toEqual(time(20));

  const reorderedTimes = clusterMediaEventAssets([
    { ...assets[0], capturedAt: time(0) },
    { ...assets[1], capturedAt: time(1) },
    { ...assets[2], capturedAt: time(2) },
  ], options);
  expect(reorderedTimes.clusters[0].stableKey).toBe(
    forward.clusters[0].stableKey,
  );
});

Deno.test("time or GPS separation splits groups and drops singletons", () => {
  const result = clusterMediaEventAssets([
    {
      assetId: "near-1",
      capturedAt: time(0),
      location: { latitude: 40.18, longitude: 44.51 },
    },
    {
      assetId: "near-2",
      capturedAt: time(5),
      location: { latitude: 40.19, longitude: 44.52 },
    },
    {
      assetId: "far-alone",
      capturedAt: time(10),
      location: { latitude: 41.7, longitude: 44.8 },
    },
    { assetId: "late-1", capturedAt: time(500) },
    { assetId: "late-2", capturedAt: time(510) },
  ], options);
  expect(result.clusters.map((cluster) => cluster.assetIds)).toEqual([
    ["near-1", "near-2"],
    ["late-1", "late-2"],
  ]);
  expect(result.clusters[0].stableKey).not.toBe(
    result.clusters[1].stableKey,
  );
});

Deno.test("missing GPS stays in a temporal group without bridging distant GPS", () => {
  const result = clusterMediaEventAssets([
    {
      assetId: "known-1",
      capturedAt: time(0),
      location: { latitude: 40.18, longitude: 44.51 },
    },
    { assetId: "no-gps", capturedAt: time(5) },
    {
      assetId: "known-far",
      capturedAt: time(10),
      location: { latitude: 41.7, longitude: 44.8 },
    },
    {
      assetId: "far-friend",
      capturedAt: time(15),
      location: { latitude: 41.71, longitude: 44.81 },
    },
  ], options);
  expect(result.clusters.map((cluster) => cluster.assetIds)).toEqual([
    ["known-1", "no-gps"],
    ["known-far", "far-friend"],
  ]);
});

Deno.test("assets without a valid capturedAt are deterministically skipped", () => {
  const result = clusterMediaEventAssets([
    { assetId: "missing", capturedAt: null },
    { assetId: "invalid", capturedAt: "not-a-date" },
    { assetId: "valid-1", capturedAt: time(0) },
    { assetId: "valid-2", capturedAt: time(1) },
  ], options);
  expect(result.skippedAssetIds).toEqual(["invalid", "missing"]);
  expect(result.clusters[0].assetIds).toEqual(["valid-1", "valid-2"]);
});

Deno.test("event size cap is deterministic and keeps the minimum of two", () => {
  const result = clusterMediaEventAssets(
    Array.from({ length: 5 }, (_, index) => ({
      assetId: `asset-${index}`,
      capturedAt: time(index),
    })),
    { ...options, maxAssetsPerEvent: 3 },
  );
  expect(result.clusters.map((cluster) => cluster.assetIds)).toEqual([
    ["asset-0", "asset-1", "asset-2"],
    ["asset-3", "asset-4"],
  ]);
});

Deno.test("representative selection is evenly spaced and includes endpoints", () => {
  expect(selectRepresentativeAssetIndexes(10, 4)).toEqual([0, 3, 6, 9]);
  expect(selectRepresentativeAssetIndexes(3, 8)).toEqual([0, 1, 2]);
  expect(selectRepresentativeAssetIndexes(9, 1)).toEqual([4]);
  expect(selectRepresentativeAssetIndexes(0, 8)).toEqual([]);
});
