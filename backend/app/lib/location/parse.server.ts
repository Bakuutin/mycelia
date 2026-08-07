import { XMLParser } from "fast-xml-parser";
import { unzipSync } from "fflate";

export interface ParsedPoint {
  ts: Date;
  lat: number;
  lng: number;
  ele?: number;
}

export interface ParseResult {
  points: ParsedPoint[];
  /** Coordinates present in the file that had no usable timestamp. */
  skipped: number;
}

export type TrackFormat = "gpx" | "kml" | "kmz";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
});

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function isValidCoordinate(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) &&
    lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

function parseTimestamp(value: unknown): Date | null {
  if (typeof value !== "string" || value.length === 0) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function finalize(points: ParsedPoint[], skipped: number): ParseResult {
  points.sort((a, b) => a.ts.getTime() - b.ts.getTime());
  return { points, skipped };
}

export function parseGpx(text: string): ParseResult {
  const doc = parser.parse(text);
  const gpx = doc?.gpx;
  if (!gpx) throw new Error("Not a GPX document: missing <gpx> root");

  const points: ParsedPoint[] = [];
  let skipped = 0;

  const collectPoint = (pt: any) => {
    const lat = Number(pt?.["@_lat"]);
    const lng = Number(pt?.["@_lon"]);
    if (!isValidCoordinate(lat, lng)) {
      skipped++;
      return;
    }
    const ts = parseTimestamp(pt?.time);
    if (!ts) {
      skipped++;
      return;
    }
    const ele = Number(pt?.ele);
    points.push({
      ts,
      lat,
      lng,
      ...(Number.isFinite(ele) ? { ele } : {}),
    });
  };

  for (const trk of asArray(gpx.trk)) {
    for (const seg of asArray(trk?.trkseg)) {
      for (const pt of asArray(seg?.trkpt)) collectPoint(pt);
    }
  }
  for (const rte of asArray(gpx.rte)) {
    for (const pt of asArray(rte?.rtept)) collectPoint(pt);
  }
  for (const wpt of asArray(gpx.wpt)) collectPoint(wpt);

  return finalize(points, skipped);
}

/** Recursively collect every Placemark from Document/Folder nesting. */
function collectPlacemarks(node: any, out: any[]): void {
  if (!node || typeof node !== "object") return;
  for (const pm of asArray(node.Placemark)) out.push(pm);
  for (const child of asArray(node.Document)) collectPlacemarks(child, out);
  for (const child of asArray(node.Folder)) collectPlacemarks(child, out);
}

function countLineStringCoordinates(geometry: any): number {
  const raw = geometry?.coordinates;
  if (typeof raw !== "string") return 0;
  return raw.split(/\s+/).filter((chunk: string) => chunk.length > 0).length;
}

export function parseKml(text: string): ParseResult {
  const doc = parser.parse(text);
  const kml = doc?.kml;
  if (!kml) throw new Error("Not a KML document: missing <kml> root");

  const placemarks: any[] = [];
  collectPlacemarks(kml, placemarks);

  const points: ParsedPoint[] = [];
  let skipped = 0;

  for (const pm of placemarks) {
    // Timestamped tracks: KML 2.3 <Track> or Google's <gx:Track> extension,
    // parallel <when> / <gx:coord> ("lng lat [ele]") arrays.
    const tracks = [...asArray(pm?.["gx:Track"]), ...asArray(pm?.Track)];
    for (const track of tracks) {
      const whens = asArray(track?.when);
      const coords = [
        ...asArray(track?.["gx:coord"]),
        ...asArray(track?.coord),
      ];
      const n = Math.min(whens.length, coords.length);
      skipped += Math.max(whens.length, coords.length) - n;
      for (let i = 0; i < n; i++) {
        const ts = parseTimestamp(whens[i]);
        const parts = String(coords[i]).trim().split(/\s+/).map(Number);
        const [lng, lat, ele] = parts;
        if (!ts || !isValidCoordinate(lat, lng)) {
          skipped++;
          continue;
        }
        points.push({
          ts,
          lat,
          lng,
          ...(Number.isFinite(ele) ? { ele } : {}),
        });
      }
    }

    // Plain geometry has no per-point timestamps — cannot be placed on a
    // timeline, so count and skip.
    for (const ls of asArray(pm?.LineString)) {
      skipped += countLineStringCoordinates(ls);
    }
    for (const mg of asArray(pm?.MultiGeometry)) {
      for (const ls of asArray(mg?.LineString)) {
        skipped += countLineStringCoordinates(ls);
      }
    }
    // Bookmarks (Point placemarks) with a TimeStamp are usable.
    for (const pt of asArray(pm?.Point)) {
      const raw = typeof pt?.coordinates === "string" ? pt.coordinates : "";
      if (!raw) continue;
      const [lng, lat, ele] = raw.trim().split(/[,\s]+/).map(Number);
      const ts = parseTimestamp(pm?.TimeStamp?.when);
      if (!ts || !isValidCoordinate(lat, lng)) {
        skipped++;
        continue;
      }
      points.push({
        ts,
        lat,
        lng,
        ...(Number.isFinite(ele) ? { ele } : {}),
      });
    }
  }

  return finalize(points, skipped);
}

export function parseKmz(bytes: Uint8Array): ParseResult {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch (err) {
    throw new Error(
      `Not a KMZ archive: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const names = Object.keys(entries);
  const kmlName = names.find((n) => n.toLowerCase() === "doc.kml") ??
    names.find((n) => n.toLowerCase().endsWith(".kml"));
  if (!kmlName) throw new Error("KMZ archive contains no .kml document");
  return parseKml(new TextDecoder().decode(entries[kmlName]));
}

export function detectFormat(filename: string): TrackFormat | null {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".gpx")) return "gpx";
  if (lower.endsWith(".kml")) return "kml";
  if (lower.endsWith(".kmz")) return "kmz";
  return null;
}

export function parseTrackFile(
  format: TrackFormat,
  bytes: Uint8Array,
): ParseResult {
  switch (format) {
    case "gpx":
      return parseGpx(new TextDecoder().decode(bytes));
    case "kml":
      return parseKml(new TextDecoder().decode(bytes));
    case "kmz":
      return parseKmz(bytes);
  }
}
