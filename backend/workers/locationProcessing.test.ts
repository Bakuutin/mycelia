import { expect } from "@std/expect";
import locationProcessing, {
  haversineM,
  locationPendingImportQuery,
  segmentPoints,
  subtractIntervals,
  type TrackPoint,
} from "./locationProcessing.ts";

Deno.test("location processing watchdog recovers a lost change event", async () => {
  expect(locationProcessing.triggers?.interval).toBeGreaterThan(0);

  const calls: any[] = [];
  const pending = await locationProcessing.hasPendingWork?.({
    mongo: async (input) => {
      calls.push(input);
      return [{ _id: "import" }];
    },
    reason: "interval",
  });
  expect(pending).toBe(1);
  expect(calls[0].query).toEqual(locationPendingImportQuery);
});

function pt(minutes: number, lat: number, lng: number): TrackPoint {
  return { ts: new Date(Date.UTC(2026, 7, 1, 0, minutes)), lat, lng };
}

Deno.test("haversineM computes plausible distances", () => {
  // Tbilisi ↔ Batumi ≈ 250-260 km
  const d = haversineM(41.7151, 44.8271, 41.6168, 41.6367);
  expect(d).toBeGreaterThan(240_000);
  expect(d).toBeLessThan(280_000);
  expect(haversineM(41.7, 44.8, 41.7, 44.8)).toBe(0);
});

Deno.test("segmentPoints detects a stay for a dwelling cluster", async () => {
  // 20 minutes of points within ~50m
  const points: TrackPoint[] = [];
  for (let m = 0; m <= 20; m += 2) {
    points.push(pt(m, 41.7151 + (m % 3) * 0.0002, 44.8271));
  }
  const segments = await segmentPoints(points);
  const stays = segments.filter((s) => s.type === "stay");
  expect(stays.length).toBe(1);
  expect(stays[0].start.getTime()).toBe(points[0].ts.getTime());
  expect(stays[0].loc!.coordinates[1]).toBeCloseTo(41.7153, 3);
});

Deno.test("segmentPoints emits stay-move-stay for travel between clusters", async () => {
  const points: TrackPoint[] = [];
  // Stay A: 0-15min at origin
  for (let m = 0; m <= 15; m += 3) points.push(pt(m, 41.7151, 44.8271));
  // Move: 18-30min heading ~5km away
  for (let m = 18; m <= 30; m += 3) {
    points.push(pt(m, 41.7151 + (m - 15) * 0.003, 44.8271));
  }
  // Stay B: 33-50min at destination
  for (let m = 33; m <= 50; m += 3) points.push(pt(m, 41.7601, 44.8271));
  const segments = await segmentPoints(points);
  const types = segments.map((s) => s.type);
  expect(types.filter((t) => t === "stay").length).toBe(2);
  expect(types).toContain("move");
  const move = segments.find((s) => s.type === "move")!;
  expect(move.distanceM!).toBeGreaterThan(3000);
  expect(move.path!.length).toBeGreaterThanOrEqual(2);
});

Deno.test("segmentPoints inserts an assumed gap across silence", async () => {
  const points: TrackPoint[] = [
    ...[0, 5, 10, 15].map((m) => pt(m, 41.7151, 44.8271)),
    // 3-hour silence, then a new cluster elsewhere
    ...[195, 200, 205, 210].map((m) => pt(m, 41.8, 45.0)),
  ];
  const segments = await segmentPoints(points);
  const gaps = segments.filter((s) => s.type === "gap");
  expect(gaps.length).toBe(1);
  expect(gaps[0].assumed).toBe(true);
  expect(gaps[0].start.getTime()).toBe(pt(15, 0, 0).ts.getTime());
  expect(gaps[0].end.getTime()).toBe(pt(195, 0, 0).ts.getTime());
  expect(gaps[0].path!.length).toBe(2);
});

Deno.test("segments carry importIds provenance from their points", async () => {
  const points: TrackPoint[] = [];
  for (let m = 0; m <= 20; m += 2) {
    points.push({
      ...pt(m, 41.7151, 44.8271),
      importId: m < 10 ? "importA" : "importB",
    });
  }
  const segments = await segmentPoints(points);
  const stay = segments.find((s) => s.type === "stay")!;
  expect(stay.importIds).toEqual(["importA", "importB"]);
});

Deno.test("subtractIntervals clips around blocked ranges", () => {
  const day = (h: number) => new Date(Date.UTC(2026, 7, 1, h));
  const parts = subtractIntervals(
    { start: day(0), end: day(10) },
    [{ start: day(2), end: day(4) }, { start: day(6), end: day(7) }],
  );
  expect(parts.map((p) => [p.start.getUTCHours(), p.end.getUTCHours()]))
    .toEqual([[0, 2], [4, 6], [7, 10]]);
  // Fully covered → nothing remains
  expect(
    subtractIntervals({ start: day(2), end: day(3) }, [{
      start: day(1),
      end: day(5),
    }]).length,
  ).toBe(0);
});
