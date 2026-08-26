import { expect } from "@std/expect";
import {
  detectRouteSeriesConflict,
  projectRoute,
  type RoutePoint,
} from "./route-projection.ts";

function point(
  index: number,
  lng: number,
  lat: number,
  seconds: number,
  fragment = 0,
): RoutePoint {
  return {
    index,
    coordinates: [lng, lat],
    ts: new Date(Date.UTC(2026, 4, 6, 12, 0, seconds)),
    sourceFragmentIndex: fragment,
    sourcePointIndex: index,
  };
}

Deno.test("explicit GPX trkseg boundary always splits the route", () => {
  const result = projectRoute([
    point(0, 7, 46, 0, 0),
    point(1, 7.001, 46.001, 10, 0),
    point(2, 7.002, 46.002, 20, 1),
    point(3, 7.003, 46.003, 30, 1),
  ]);
  expect(result.fragments.length).toBe(2);
  expect(result.breaks[0].reason).toBe("source_boundary");
});

Deno.test("sparse jump splits but a locally consistent flight does not", () => {
  const sparse = projectRoute([
    point(0, 7, 46, 0),
    point(1, 7.001, 46.001, 10),
    { ...point(2, 8, 47, 20), ts: new Date("2026-05-06T12:10:00Z") },
  ]);
  expect(sparse.breaks.some((value) => value.reason === "sparse_jump")).toBe(
    true,
  );

  const flight = projectRoute(Array.from({ length: 20 }, (_, index) => ({
    index,
    coordinates: [-20 + index, 40 + index * 0.05] as [number, number],
    ts: new Date(Date.UTC(2026, 4, 6, 12, index, 0)),
    sourceFragmentIndex: 0,
    sourcePointIndex: index,
  })));
  expect(flight.breaks.length).toBe(0);
});

Deno.test("Cape Town and Tbilisi overlap becomes a review conflict", () => {
  const capeTown = Array.from({ length: 6 }, (_, index) => ({
    index,
    coordinates: [18.4 + index * 0.001, -33.9] as [number, number],
    ts: new Date(Date.UTC(2026, 4, 6, 12, index * 2, 0)),
  }));
  const tbilisi = Array.from({ length: 6 }, (_, index) => ({
    index,
    coordinates: [44.8 + index * 0.001, 41.7] as [number, number],
    ts: new Date(Date.UTC(2026, 4, 6, 12, index * 2, 0)),
  }));
  const conflict = detectRouteSeriesConflict(capeTown, tbilisi);
  expect(conflict).not.toBeNull();
  expect(conflict!.medianSeparationM).toBeGreaterThan(20_000);
});
