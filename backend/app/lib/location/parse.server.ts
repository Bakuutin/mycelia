import { XMLParser } from "fast-xml-parser";
import { unzipSync } from "fflate";

export type TrackFormat = "gpx" | "kml" | "kmz";

export interface ParsedPoint {
  ts: Date;
  lat: number;
  lng: number;
  ele?: number;
  trackIndex?: number;
  pointIndex?: number;
}

export interface ParsedCoordinate {
  lat: number;
  lng: number;
  ele?: number;
}

export interface ParsedStyle {
  color?: string;
  width?: number;
  icon?: string;
  styleUrl?: string;
  raw?: Record<string, unknown>;
}

export interface ParsedMetadata {
  name?: string;
  customNames?: Record<string, string>;
  localizedNames?: Record<string, string>;
  localizedDescriptions?: Record<string, string>;
  description?: string;
  featureTypes?: string[];
  icon?: string;
  scale?: number;
  visibility?: boolean;
  sourceTimestamp?: Date;
  localId?: string;
  additionalStyle?: string;
  accessRules?: string;
  style?: ParsedStyle;
  styleDefinitions?: Record<string, ParsedStyle>;
}

export interface ParsedTrack extends ParsedMetadata {
  kind: "timed-track" | "untimed-path";
  sourceIndex: number;
  coordinates: Array<ParsedCoordinate & { ts?: Date }>;
}

export interface ParsedBookmark extends ParsedMetadata, ParsedCoordinate {
  sourceIndex: number;
}

export interface ParseResult {
  /** Canonical timestamped observations only. Bookmarks never appear here. */
  points: ParsedPoint[];
  tracks: ParsedTrack[];
  bookmarks: ParsedBookmark[];
  datasetMetadata: ParsedMetadata;
  /** Invalid or structurally unmatched records that could not be retained. */
  skipped: number;
  /** Retained map geometry that has no timeline timestamp. */
  untimedCoordinates: number;
}

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

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
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

function parseVisibility(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return value === true || value === 1 || value === "1" || value === "true";
}

function parseLocalized(node: any): Record<string, string> | undefined {
  const values: Record<string, string> = {};
  for (const item of asArray(node?.["mwm:lang"] ?? node?.lang)) {
    const code = nonEmptyString(item?.["@_code"]) ?? "default";
    const text = nonEmptyString(
      typeof item === "string" ? item : item?.["#text"],
    );
    if (text) values[code] = text;
  }
  return Object.keys(values).length > 0 ? values : undefined;
}

function parseExtendedData(node: any): ParsedMetadata {
  if (!node || typeof node !== "object") return {};
  const localizedNames = parseLocalized(node["mwm:name"] ?? node.name);
  const customNames = parseLocalized(node["mwm:customName"] ?? node.customName);
  const localizedDescriptions = parseLocalized(
    node["mwm:description"] ?? node.description,
  );
  const featureTypes = asArray(
    node["mwm:featureTypes"]?.["mwm:value"] ??
      node.featureTypes?.value,
  ).map(nonEmptyString).filter((value): value is string => !!value);
  const sourceTimestamp = parseTimestamp(
    node["mwm:lastModified"] ?? node.lastModified,
  ) ?? undefined;
  const scale = finiteNumber(node["mwm:scale"] ?? node.scale);
  const icon = nonEmptyString(node["mwm:icon"] ?? node.icon);
  const visibility = parseVisibility(
    node["mwm:visibility"] ?? node.visibility,
  );
  const localId = nonEmptyString(node["mwm:localId"] ?? node.localId);
  const additionalStyle = nonEmptyString(
    node["mwm:additionalStyle"] ?? node.additionalStyle,
  );
  const accessRules = nonEmptyString(
    node["mwm:accessRules"] ?? node.accessRules,
  );
  return {
    ...(localizedNames ? { localizedNames } : {}),
    ...(customNames ? { customNames } : {}),
    ...(localizedDescriptions ? { localizedDescriptions } : {}),
    ...(featureTypes.length > 0 ? { featureTypes } : {}),
    ...(icon ? { icon } : {}),
    ...(scale !== undefined ? { scale } : {}),
    ...(visibility !== undefined ? { visibility } : {}),
    ...(sourceTimestamp ? { sourceTimestamp } : {}),
    ...(localId ? { localId } : {}),
    ...(additionalStyle ? { additionalStyle } : {}),
    ...(accessRules ? { accessRules } : {}),
  };
}

function parseKmlStyle(pm: any): ParsedStyle | undefined {
  const line = pm?.Style?.LineStyle;
  const styleUrl = nonEmptyString(pm?.styleUrl);
  const color = nonEmptyString(line?.color);
  const width = finiteNumber(line?.width);
  const icon = styleUrl?.replace(/^#placemark-/, "");
  if (!styleUrl && !color && width === undefined && !icon) return undefined;
  return {
    ...(color ? { color } : {}),
    ...(width !== undefined ? { width } : {}),
    ...(icon ? { icon } : {}),
    ...(styleUrl ? { styleUrl } : {}),
    raw: {
      ...(line ? { lineStyle: line } : {}),
      ...(styleUrl ? { styleUrl } : {}),
    },
  };
}

function parseKmlStyleDefinitions(document: any) {
  const definitions: Record<string, ParsedStyle> = {};
  for (const node of asArray(document?.Style)) {
    const id = nonEmptyString(node?.["@_id"]);
    if (!id) continue;
    const href = nonEmptyString(node?.IconStyle?.Icon?.href);
    const line = node?.LineStyle;
    const color = nonEmptyString(line?.color);
    const width = finiteNumber(line?.width);
    const icon = href?.split("/").pop()?.replace(/\.png$/i, "");
    definitions[id] = {
      ...(color ? { color } : {}),
      ...(width !== undefined ? { width } : {}),
      ...(icon ? { icon } : {}),
      ...(href ? { styleUrl: href } : {}),
      raw: node,
    };
  }
  return Object.keys(definitions).length > 0 ? definitions : undefined;
}

function metadataFromKml(node: any): ParsedMetadata {
  const extended = parseExtendedData(node?.ExtendedData);
  const name = nonEmptyString(node?.name);
  const description = nonEmptyString(node?.description) ??
    extended.localizedDescriptions?.default;
  const sourceTimestamp = parseTimestamp(node?.TimeStamp?.when) ??
    extended.sourceTimestamp;
  const visibility = parseVisibility(node?.visibility) ?? extended.visibility;
  const style = parseKmlStyle(node);
  return {
    ...extended,
    ...(name ? { name } : {}),
    ...(description ? { description } : {}),
    ...(sourceTimestamp ? { sourceTimestamp } : {}),
    ...(visibility !== undefined ? { visibility } : {}),
    ...(style ? { style } : {}),
  };
}

function finalize(result: ParseResult): ParseResult {
  result.points.sort((a, b) =>
    a.ts.getTime() - b.ts.getTime() ||
    (a.trackIndex ?? 0) - (b.trackIndex ?? 0) ||
    (a.pointIndex ?? 0) - (b.pointIndex ?? 0)
  );
  return result;
}

function gpxColor(node: any): string | undefined {
  const extensions = node?.extensions;
  return nonEmptyString(
    extensions?.["xsi:gpx"]?.color ??
      extensions?.gpx?.color ??
      extensions?.color,
  );
}

function metadataFromGpx(node: any): ParsedMetadata {
  const name = nonEmptyString(node?.name);
  const description = nonEmptyString(node?.desc);
  const color = gpxColor(node);
  return {
    ...(name ? { name } : {}),
    ...(description ? { description } : {}),
    ...(color ? { style: { color, raw: { color } } } : {}),
  };
}

function coordinateFromGpx(node: any): ParsedCoordinate | null {
  const lat = Number(node?.["@_lat"]);
  const lng = Number(node?.["@_lon"]);
  if (!isValidCoordinate(lat, lng)) return null;
  const ele = finiteNumber(node?.ele);
  return { lat, lng, ...(ele !== undefined ? { ele } : {}) };
}

export function parseGpx(text: string): ParseResult {
  const doc = parser.parse(text);
  const gpx = doc?.gpx;
  if (!gpx) throw new Error("Not a GPX document: missing <gpx> root");

  const result: ParseResult = {
    points: [],
    tracks: [],
    bookmarks: [],
    datasetMetadata: metadataFromGpx(gpx.metadata ?? gpx),
    skipped: 0,
    untimedCoordinates: 0,
  };

  const addTrack = (node: any, rawPoints: any[]) => {
    const trackIndex = result.tracks.length;
    const coordinates: Array<ParsedCoordinate & { ts?: Date }> = [];
    let timed = 0;
    for (const raw of rawPoints) {
      const coordinate = coordinateFromGpx(raw);
      if (!coordinate) {
        result.skipped++;
        continue;
      }
      const ts = parseTimestamp(raw?.time) ?? undefined;
      const pointIndex = coordinates.length;
      coordinates.push({ ...coordinate, ...(ts ? { ts } : {}) });
      if (ts) {
        timed++;
        result.points.push({
          ...coordinate,
          ts,
          trackIndex,
          pointIndex,
        });
      } else {
        result.untimedCoordinates++;
      }
    }
    if (coordinates.length > 0) {
      result.tracks.push({
        ...metadataFromGpx(node),
        kind: timed > 0 ? "timed-track" : "untimed-path",
        sourceIndex: trackIndex,
        coordinates,
      });
    }
  };

  for (const trk of asArray(gpx.trk)) {
    const rawPoints = asArray(trk?.trkseg).flatMap((seg: any) =>
      asArray(seg?.trkpt)
    );
    addTrack(trk, rawPoints);
  }
  for (const route of asArray(gpx.rte)) {
    addTrack(route, asArray(route?.rtept));
  }
  for (const waypoint of asArray(gpx.wpt)) {
    const coordinate = coordinateFromGpx(waypoint);
    if (!coordinate) {
      result.skipped++;
      continue;
    }
    result.bookmarks.push({
      ...coordinate,
      ...metadataFromGpx(waypoint),
      sourceIndex: result.bookmarks.length,
    });
    // Waypoints are saved places, not observations; lack of a timestamp does
    // not mean the bookmark was skipped.
  }

  return finalize(result);
}

/** Recursively collect every Placemark from Document/Folder nesting. */
function collectPlacemarks(node: any, out: any[]): void {
  if (!node || typeof node !== "object") return;
  for (const pm of asArray(node.Placemark)) out.push(pm);
  for (const child of asArray(node.Document)) collectPlacemarks(child, out);
  for (const child of asArray(node.Folder)) collectPlacemarks(child, out);
}

function parseCoordinateTuple(value: unknown, commaSeparated = false) {
  const parts = String(value ?? "").trim().split(
    commaSeparated ? /[,\s]+/ : /\s+/,
  ).map(Number);
  const [lng, lat, ele] = parts;
  if (!isValidCoordinate(lat, lng)) return null;
  return {
    lat,
    lng,
    ...(Number.isFinite(ele) ? { ele } : {}),
  } satisfies ParsedCoordinate;
}

function lineStringCoordinates(geometry: any): ParsedCoordinate[] {
  const raw = geometry?.coordinates;
  if (typeof raw !== "string") return [];
  return raw.split(/\s+/).filter(Boolean).map((chunk: string) =>
    parseCoordinateTuple(chunk, true)
  ).filter((value): value is ParsedCoordinate => value !== null);
}

export function parseKml(text: string): ParseResult {
  const doc = parser.parse(text);
  const kml = doc?.kml;
  if (!kml) throw new Error("Not a KML document: missing <kml> root");

  const document = kml.Document ?? kml;
  const styleDefinitions = parseKmlStyleDefinitions(document);
  const result: ParseResult = {
    points: [],
    tracks: [],
    bookmarks: [],
    datasetMetadata: {
      ...metadataFromKml(document),
      ...(styleDefinitions ? { styleDefinitions } : {}),
    },
    skipped: 0,
    untimedCoordinates: 0,
  };
  const placemarks: any[] = [];
  collectPlacemarks(kml, placemarks);

  for (const pm of placemarks) {
    const metadata = metadataFromKml(pm);
    const tracks = [...asArray(pm?.["gx:Track"]), ...asArray(pm?.Track)];
    for (const track of tracks) {
      const trackIndex = result.tracks.length;
      const whens = asArray(track?.when);
      const coords = [
        ...asArray(track?.["gx:coord"]),
        ...asArray(track?.coord),
      ];
      const n = Math.min(whens.length, coords.length);
      result.skipped += Math.max(whens.length, coords.length) - n;
      const coordinates: Array<ParsedCoordinate & { ts?: Date }> = [];
      for (let i = 0; i < n; i++) {
        const ts = parseTimestamp(whens[i]);
        const coordinate = parseCoordinateTuple(coords[i]);
        if (!ts || !coordinate) {
          result.skipped++;
          continue;
        }
        const pointIndex = coordinates.length;
        coordinates.push({ ...coordinate, ts });
        result.points.push({
          ...coordinate,
          ts,
          trackIndex,
          pointIndex,
        });
      }
      if (coordinates.length > 0) {
        result.tracks.push({
          ...metadata,
          kind: "timed-track",
          sourceIndex: trackIndex,
          coordinates,
        });
      }
    }

    const lineStrings = [
      ...asArray(pm?.LineString),
      ...asArray(pm?.MultiGeometry).flatMap((mg: any) =>
        asArray(mg?.LineString)
      ),
    ];
    for (const line of lineStrings) {
      const coordinates = lineStringCoordinates(line);
      result.untimedCoordinates += coordinates.length;
      if (coordinates.length > 0) {
        result.tracks.push({
          ...metadata,
          kind: "untimed-path",
          sourceIndex: result.tracks.length,
          coordinates,
        });
      }
    }

    for (const point of asArray(pm?.Point)) {
      const coordinate = parseCoordinateTuple(point?.coordinates, true);
      if (!coordinate) {
        result.skipped++;
        continue;
      }
      result.bookmarks.push({
        ...coordinate,
        ...metadata,
        sourceIndex: result.bookmarks.length,
      });
      // A KML bookmark TimeStamp records when it was saved. It is retained as
      // metadata and never becomes a whereabouts point.
    }
  }

  return finalize(result);
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
  const kmlName = names.find((name) => name.toLowerCase() === "doc.kml") ??
    names.find((name) => name.toLowerCase().endsWith(".kml"));
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
