import { expect } from "@std/expect";
import {
  cellsForBounds,
  isCoordinateInBounds,
  mapCellForCoordinate,
  mapCellKey,
  parseMapCellKey,
} from "./map-spatial.ts";

Deno.test("map cells round-trip", () => {
  const cell = mapCellForCoordinate(46.948, 7.4474, 16);
  expect(parseMapCellKey(mapCellKey(cell))).toEqual(cell);
});

Deno.test("antimeridian bounds include both sides without including Greenwich", () => {
  const bounds = { west: 170, south: -20, east: -170, north: 20 };
  expect(isCoordinateInBounds(0, 179, bounds)).toBe(true);
  expect(isCoordinateInBounds(0, -179, bounds)).toBe(true);
  expect(isCoordinateInBounds(0, 0, bounds)).toBe(false);
  const cells = cellsForBounds(bounds, 4);
  expect(cells).not.toBeNull();
  expect(cells!.length).toBeGreaterThan(0);
  expect(cells!.length).toBeLessThan(16 * 16);
});

Deno.test("whole-world bounds include ordinary longitudes and all low-zoom cells", () => {
  const world = { west: -180, east: 180, south: -90, north: 90 };
  expect(isCoordinateInBounds(46.948, 7.4474, world)).toBe(true);
  expect(cellsForBounds(world, 4)).toHaveLength(256);
});
