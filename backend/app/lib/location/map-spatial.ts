export const MAP_CELL_ZOOMS = [4, 7, 10, 13, 16, 19] as const;

export type MapCellZoom = (typeof MAP_CELL_ZOOMS)[number];

export interface MapBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface MapCell {
  z: MapCellZoom;
  x: number;
  y: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function normalizeLongitude(value: number): number {
  return ((value + 180) % 360 + 360) % 360 - 180;
}

export function mapCellForCoordinate(
  lat: number,
  lng: number,
  z: MapCellZoom,
): MapCell {
  const scale = 2 ** z;
  const normalizedLng = normalizeLongitude(lng);
  const x = clamp(
    Math.floor((normalizedLng + 180) / 360 * scale),
    0,
    scale - 1,
  );
  const latitude = clamp(lat, -85.05112878, 85.05112878);
  const radians = latitude * Math.PI / 180;
  const y = clamp(
    Math.floor(
      (1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) /
        2 * scale,
    ),
    0,
    scale - 1,
  );
  return { z, x, y };
}

export function mapCellKey(cell: MapCell): string {
  return `${cell.z}:${cell.x}:${cell.y}`;
}

export function parseMapCellKey(value: string): MapCell | null {
  const [rawZ, rawX, rawY, extra] = value.split(":");
  if (extra !== undefined) return null;
  const z = Number(rawZ);
  const x = Number(rawX);
  const y = Number(rawY);
  if (
    !MAP_CELL_ZOOMS.includes(z as MapCellZoom) || !Number.isInteger(x) ||
    !Number.isInteger(y) || x < 0 || y < 0 || x >= 2 ** z || y >= 2 ** z
  ) return null;
  return { z: z as MapCellZoom, x, y };
}

export function selectMapCellZoom(zoom: number): MapCellZoom {
  const target = Math.floor(zoom) + 2;
  let selected: MapCellZoom = MAP_CELL_ZOOMS[0];
  for (const value of MAP_CELL_ZOOMS) {
    if (value <= target) selected = value;
  }
  return selected;
}

export function isCoordinateInBounds(
  lat: number,
  lng: number,
  bounds: MapBounds,
): boolean {
  if (lat < bounds.south || lat > bounds.north) return false;
  if (bounds.east - bounds.west >= 360) return true;
  const normalized = normalizeLongitude(lng);
  const west = normalizeLongitude(bounds.west);
  const east = normalizeLongitude(bounds.east);
  return west <= east
    ? normalized >= west && normalized <= east
    : normalized >= west || normalized <= east;
}

export function cellsForBounds(
  bounds: MapBounds,
  z: MapCellZoom,
  maxCells = 20_000,
): string[] | null {
  const northWest = mapCellForCoordinate(bounds.north, bounds.west, z);
  const southEast = mapCellForCoordinate(bounds.south, bounds.east, z);
  const scale = 2 ** z;
  const xs: number[] = [];
  if (bounds.east - bounds.west >= 360) {
    for (let x = 0; x < scale; x++) xs.push(x);
  } else if (bounds.west <= bounds.east) {
    const eastX = bounds.east === 180 ? scale - 1 : southEast.x;
    for (let x = northWest.x; x <= eastX; x++) xs.push(x);
  } else {
    for (let x = northWest.x; x < scale; x++) xs.push(x);
    for (let x = 0; x <= southEast.x; x++) xs.push(x);
  }
  const yStart = Math.min(northWest.y, southEast.y);
  const yEnd = Math.max(northWest.y, southEast.y);
  const count = xs.length * (yEnd - yStart + 1);
  if (count > maxCells) return null;
  const keys: string[] = [];
  for (const x of xs) {
    for (let y = yStart; y <= yEnd; y++) {
      keys.push(mapCellKey({ z, x, y }));
    }
  }
  return keys;
}

export function mapCellBounds(cell: MapCell): MapBounds {
  const scale = 2 ** cell.z;
  const west = cell.x / scale * 360 - 180;
  const east = (cell.x + 1) / scale * 360 - 180;
  const latitude = (y: number) =>
    Math.atan(Math.sinh(Math.PI * (1 - 2 * y / scale))) * 180 / Math.PI;
  return {
    west,
    east,
    north: latitude(cell.y),
    south: latitude(cell.y + 1),
  };
}
