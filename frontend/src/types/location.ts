import type { ObjectId } from "bson";

export interface LocationPlace {
  name: string;
  city?: string;
  country?: string;
  countryCode?: string;
  geonameId?: number;
  admin1?: string;
}

export type LocationSegmentType = "stay" | "move" | "gap" | "manual";

export interface SegmentSource {
  manual?: boolean;
  createdBy?: string;
  importId?: string;
  filename?: string | null;
}

export interface LocationSegment {
  _id: ObjectId | string;
  type: LocationSegmentType;
  start: Date | string;
  end: Date | string;
  loc?: { type: "Point"; coordinates: [number, number] };
  radiusM?: number;
  place?: LocationPlace | null;
  timeZone?: string;
  path?: [number, number][];
  distanceM?: number;
  assumed?: boolean;
  source: "derived" | "manual";
  importIds?: unknown[];
  sources?: SegmentSource[];
  overlapIds?: string[];
}

export function formatSources(sources?: SegmentSource[]): string[] {
  if (!sources || sources.length === 0) return [];
  return sources.map((s) =>
    s.manual ? `✍️ manual${s.createdBy ? ` (${s.createdBy})` : ""}` : `📄 ${
      s.filename ?? "deleted import"
    }`
  );
}

export interface LocationStatus {
  hasData: boolean;
  pointCount: number;
  segmentCount: number;
  geonamesReady: boolean;
  geonamesCount: number;
  geonamesRefreshedAt: Date | string | null;
  geonamesSourceUrl: string | null;
  lastImportAt: Date | string | null;
}

export interface GeonamesCity {
  geonameId: number;
  name: string;
  asciiName: string;
  country: string;
  countryCode: string;
  admin1?: string;
  population: number;
  loc: { type: "Point"; coordinates: [number, number] };
  tz?: string;
}

export interface LocationImport {
  _id: ObjectId | string;
  filename: string;
  format: "gpx" | "kml" | "kmz";
  pointCount: number;
  dedupedCount?: number;
  skippedCount: number;
  timeRange: { start: Date | string; end: Date | string };
  status: "parsed" | "processed" | "error";
  createdAt: Date | string;
}

export interface ConversationMapGroup {
  key: string;
  loc: { type: "Point"; coordinates: [number, number] };
  place: LocationPlace | null;
  stayCount: number;
  conversationCount: number;
  conversations: Array<{
    _id: ObjectId | string;
    name?: string;
    icon?: string;
    start: Date | string;
    end: Date | string | null;
    stayId: ObjectId | string;
    stayLoc: { type: "Point"; coordinates: [number, number] };
  }>;
}

/** Deterministic color per place so the same city always matches. */
export function placeColor(
  place: LocationPlace | null | undefined,
  manual = false,
): string {
  if (manual) return "#8b5cf6";
  const key = place?.geonameId?.toString() ?? place?.name ?? "unknown";
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) | 0;
  }
  const hue = ((hash % 360) + 360) % 360;
  return `hsl(${hue}, 55%, 45%)`;
}

export function formatPlace(place: LocationPlace | null | undefined): string {
  if (!place) return "Unknown location";
  const parts = [place.city ?? place.name, place.country].filter(Boolean);
  return parts.join(", ") || "Unknown location";
}

export function segmentDurationMs(segment: LocationSegment): number {
  return new Date(segment.end).getTime() - new Date(segment.start).getTime();
}
