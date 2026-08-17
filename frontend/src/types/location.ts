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
    s.manual
      ? `✍️ manual${s.createdBy ? ` (${s.createdBy})` : ""}`
      : `📄 ${s.filename ?? "deleted import"}`
  );
}

export interface LocationStatus {
  hasData: boolean;
  pointCount: number;
  segmentCount: number;
  bookmarkCount?: number;
  recordedTrackCount?: number;
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
  timeRange?: { start: Date | string; end: Date | string };
  status:
    | "staging"
    | "ready"
    | "committing"
    | "parsed"
    | "processed"
    | "failed"
    | "error";
  createdAt: Date | string;
  committedAt?: Date | string;
  receipt?: LocationImportCounts & {
    pointsImported?: number;
    pointsDeduplicated?: number;
    pointsSkipped?: number;
  };
  datasetMetadata?: LocationMetadata;
}

export interface LocationMetadata {
  name?: string;
  customNames?: Record<string, string>;
  localizedNames?: Record<string, string>;
  localizedDescriptions?: Record<string, string>;
  description?: string;
  featureTypes?: string[];
  icon?: string;
  scale?: number;
  visibility?: boolean;
  sourceTimestamp?: Date | string;
  localId?: string;
  additionalStyle?: string;
  accessRules?: string;
  style?: {
    color?: string;
    width?: number;
    icon?: string;
    styleUrl?: string;
  };
  styleDefinitions?: Record<string, {
    color?: string;
    width?: number;
    icon?: string;
    styleUrl?: string;
  }>;
}

export interface LocationImportCounts {
  sourcePoints: number;
  uniquePoints: number;
  newPoints: number;
  matchedPoints: number;
  withinFileDuplicates: number;
  conflictPoints: number;
  conflictGroups: number;
  skipped: number;
  untimedCoordinates: number;
  tracks: number;
  tracksNew: number;
  tracksMatched: number;
  bookmarks: number;
  bookmarksNew: number;
  bookmarksMatched: number;
  metadataReview: number;
}

export interface LocationImportPreview {
  previewId: string;
  filename: string;
  format: "gpx" | "kml" | "kmz";
  contentHash: string;
  exactFileMatch?: {
    importId: string;
    filename: string;
    createdAt?: Date | string;
  };
  timeRange?: { start: Date | string; end: Date | string };
  counts: LocationImportCounts;
  duplicateSources: Array<{
    importId: string;
    filename: string;
    matchedPoints: number;
  }>;
  conflicts: Array<{
    ts: Date | string;
    incoming: LocationConflictPoint[];
    existing: LocationConflictPoint[];
  }>;
  metadataDifferences: Array<{
    kind: "elevation" | "ambiguous_bookmark";
    hash?: string;
    coordinateHash?: string;
    existing?: number;
    incoming?: number;
  }>;
  datasetMetadata: LocationMetadata;
  expiresAt: Date | string;
  canConfirm: boolean;
}

export interface LocationConflictPoint {
  hash: string;
  lat: number;
  lng: number;
  ele?: number;
}

export interface SavedPlace {
  _id: ObjectId | string;
  coordinateHash: string;
  loc: { type: "Point"; coordinates: [number, number] };
  ele?: number;
  displayName?: string | null;
  description?: string | null;
  featureTypes?: string[];
  icon?: string | null;
  style?: LocationMetadata["style"] | null;
  scale?: number | null;
  visibility?: boolean;
  sourceTimestamp?: Date | string | null;
  metadata?: LocationMetadata;
  sourceRefs?: Array<{
    importId: ObjectId | string;
    format: "gpx" | "kml" | "kmz";
    sourceIndex: number;
    metadata?: LocationMetadata;
  }>;
  reviewStatus?: "pending" | "accepted" | "rejected";
}

export interface RecordedLocationTrack {
  _id: ObjectId | string;
  fingerprint: string;
  kind: "timed-track" | "untimed-path";
  displayName?: string | null;
  pointCount: number;
  path: [number, number][];
  style?: LocationMetadata["style"] | null;
  visibility?: boolean;
  metadata?: LocationMetadata;
}

export interface LocationPointConflict {
  _id: ObjectId | string;
  ts: Date | string;
  status: "pending" | "resolved";
  resolution?: "keep_existing" | "use_incoming" | "defer";
  existingPoints?: Array<{
    hash: string;
    loc: { type: "Point"; coordinates: [number, number] };
    ele?: number;
  }>;
  candidates?: Array<{
    importId: ObjectId | string;
    format: "gpx" | "kml" | "kmz";
    points: Array<{
      hash: string;
      loc: { type: "Point"; coordinates: [number, number] };
      ele?: number;
    }>;
  }>;
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
