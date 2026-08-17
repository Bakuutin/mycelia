import { createHash } from "node:crypto";
import { ObjectId } from "bson";
import type { Auth } from "@/lib/auth/core.server.ts";
import { getMongoResource } from "@/lib/mongo/core.server.ts";
import { getFsResource, uploadToGridFS } from "@/lib/mongo/fs.server.ts";
import {
  type ParsedBookmark,
  type ParsedMetadata,
  type ParsedPoint,
  type ParsedTrack,
  type ParseResult,
  parseTrackFile,
  type TrackFormat,
} from "@/lib/location/parse.server.ts";

const PREVIEWS = "location_import_previews";
const IMPORTS = "location_imports";
const POINTS = "location_points";
const TRACKS = "location_tracks";
const BOOKMARKS = "location_bookmarks";
const CONFLICTS = "location_point_conflicts";
const META = "location_meta";
const FILE_BUCKET = "location_files";
const LOOKUP_BATCH = 4000;
const WRITE_BATCH = 1000;
const PREVIEW_TTL_MS = 24 * 60 * 60 * 1000;
export const LOCATION_PARSER_VERSION = 2;
export const LOCATION_POINT_HASH_VERSION = 1;

type MongoCall = (input: any) => Promise<any>;

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
  format: TrackFormat;
  contentHash: string;
  exactFileMatch?: {
    importId: string;
    filename: string;
    createdAt?: Date;
  };
  timeRange?: { start: Date; end: Date };
  counts: LocationImportCounts;
  duplicateSources: Array<{
    importId: string;
    filename: string;
    matchedPoints: number;
  }>;
  conflicts: Array<{
    ts: Date;
    incoming: Array<{ hash: string; lat: number; lng: number; ele?: number }>;
    existing: Array<{
      hash: string;
      lat: number;
      lng: number;
      ele?: number;
    }>;
  }>;
  metadataDifferences: Array<{
    kind: "elevation" | "ambiguous_bookmark";
    hash?: string;
    coordinateHash?: string;
    existing?: number;
    incoming?: number;
  }>;
  datasetMetadata: ParsedMetadata;
  expiresAt: Date;
  canConfirm: boolean;
}

interface AnalysisInternal {
  public: Omit<LocationImportPreview, "previewId" | "expiresAt">;
  uniquePoints: Map<string, ParsedPoint>;
  existingByHash: Map<string, any>;
  newHashes: Set<string>;
  conflictHashes: Set<string>;
  existingAtConflict: Map<number, any[]>;
  trackFingerprints: string[];
  bookmarkCoordinateHashes: string[];
  revision: number;
  fingerprint: string;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function pointHash(point: ParsedPoint): string {
  return `${point.ts.getTime()}:${point.lat.toFixed(5)}:${
    point.lng.toFixed(5)
  }`;
}

export function coordinateHash(point: { lat: number; lng: number }): string {
  return `${point.lat.toFixed(6)}:${point.lng.toFixed(6)}`;
}

export function trackFingerprint(track: ParsedTrack): string {
  const coordinates = track.coordinates.map((point) =>
    point.ts
      ? `${point.ts.getTime()}:${point.lat.toFixed(5)}:${point.lng.toFixed(5)}`
      : `${point.lat.toFixed(6)}:${point.lng.toFixed(6)}`
  );
  return sha256(`${track.kind}\n${coordinates.join("\n")}`);
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function metadataForStorage(metadata: ParsedMetadata) {
  return {
    ...(metadata.name ? { name: metadata.name } : {}),
    ...(metadata.customNames ? { customNames: metadata.customNames } : {}),
    ...(metadata.localizedNames
      ? { localizedNames: metadata.localizedNames }
      : {}),
    ...(metadata.localizedDescriptions
      ? { localizedDescriptions: metadata.localizedDescriptions }
      : {}),
    ...(metadata.description ? { description: metadata.description } : {}),
    ...(metadata.featureTypes ? { featureTypes: metadata.featureTypes } : {}),
    ...(metadata.icon ? { icon: metadata.icon } : {}),
    ...(metadata.scale !== undefined ? { scale: metadata.scale } : {}),
    ...(metadata.visibility !== undefined
      ? { visibility: metadata.visibility }
      : {}),
    ...(metadata.sourceTimestamp
      ? { sourceTimestamp: metadata.sourceTimestamp }
      : {}),
    ...(metadata.localId ? { localId: metadata.localId } : {}),
    ...(metadata.additionalStyle
      ? { additionalStyle: metadata.additionalStyle }
      : {}),
    ...(metadata.accessRules ? { accessRules: metadata.accessRules } : {}),
    ...(metadata.style ? { style: metadata.style } : {}),
    ...(metadata.styleDefinitions
      ? { styleDefinitions: metadata.styleDefinitions }
      : {}),
  };
}

function displayName(metadata: ParsedMetadata): string | undefined {
  return metadata.customNames?.default ?? metadata.localizedNames?.default ??
    metadata.name;
}

function metadataPriority(format: TrackFormat): number {
  return format === "gpx" ? 10 : 20;
}

function decimateCoordinates(
  coordinates: Array<{ lat: number; lng: number }>,
  budget = 2000,
): [number, number][] {
  if (coordinates.length <= budget) {
    return coordinates.map((point) => [point.lng, point.lat]);
  }
  const result: [number, number][] = [];
  const stride = (coordinates.length - 1) / (budget - 1);
  for (let index = 0; index < budget; index++) {
    const point = coordinates[Math.round(index * stride)];
    result.push([point.lng, point.lat]);
  }
  return result;
}

async function getRevision(mongo: MongoCall): Promise<number> {
  const doc = await mongo({
    action: "findOne",
    collection: META,
    query: { key: "import-revision" },
  });
  return Number(doc?.value ?? 0);
}

async function cleanupExpiredPreviews(
  auth: Auth,
  mongo: MongoCall,
): Promise<void> {
  const expired = await mongo({
    action: "find",
    collection: PREVIEWS,
    query: { expiresAt: { $lte: new Date() } },
    options: { limit: 100, projection: { stagedFileId: 1, status: 1 } },
  });
  if (expired.length === 0) return;
  const fs = await getFsResource(auth);
  for (const preview of expired) {
    if (preview.status !== "confirmed" && preview.stagedFileId) {
      try {
        await fs({
          action: "delete",
          bucket: FILE_BUCKET,
          id: String(preview.stagedFileId),
        });
      } catch (error) {
        console.warn(
          "[location-import] Expired staged file cleanup failed:",
          error instanceof Error ? error.message : error,
        );
        continue;
      }
    }
    await mongo({
      action: "deleteOne",
      collection: PREVIEWS,
      query: { _id: preview._id },
    });
  }
}

export async function bumpLocationImportRevision(
  mongo: MongoCall,
): Promise<void> {
  await mongo({
    action: "updateOne",
    collection: META,
    query: { key: "import-revision" },
    update: { $inc: { value: 1 }, $set: { changedAt: new Date() } },
    options: { upsert: true },
  });
}

async function findByValues(
  mongo: MongoCall,
  collection: string,
  field: string,
  values: unknown[],
  projection?: Record<string, number>,
): Promise<any[]> {
  const found: any[] = [];
  for (const valuesChunk of chunk(values, LOOKUP_BATCH)) {
    if (valuesChunk.length === 0) continue;
    found.push(
      ...await mongo({
        action: "find",
        collection,
        query: { [field]: { $in: valuesChunk } },
        options: {
          ...(projection ? { projection } : {}),
          limit: Math.max(valuesChunk.length * 4, LOOKUP_BATCH),
        },
      }),
    );
  }
  return found;
}

function sourceImportIds(point: any): string[] {
  const ids = Array.isArray(point.importIds) && point.importIds.length > 0
    ? point.importIds
    : point.importId != null
    ? [point.importId]
    : [];
  return Array.from(
    new Set<string>(ids.map((id: unknown) => String(id))),
  );
}

function pointGroups(
  points: Iterable<ParsedPoint>,
): Map<number, ParsedPoint[]> {
  const groups = new Map<number, ParsedPoint[]>();
  for (const point of points) {
    const timestamp = point.ts.getTime();
    const group = groups.get(timestamp) ?? [];
    group.push(point);
    groups.set(timestamp, group);
  }
  return groups;
}

export async function analyzeLocationDataset(
  mongo: MongoCall,
  filename: string,
  format: TrackFormat,
  contentHash: string,
  dataset: ParseResult,
): Promise<AnalysisInternal> {
  const exact = await mongo({
    action: "findOne",
    collection: IMPORTS,
    query: { contentHash, committedAt: { $exists: true } },
    options: { projection: { filename: 1, createdAt: 1 } },
  });

  const uniquePoints = new Map<string, ParsedPoint>();
  let withinFileDuplicates = 0;
  for (const point of dataset.points) {
    const hash = pointHash(point);
    if (uniquePoints.has(hash)) withinFileDuplicates++;
    else uniquePoints.set(hash, point);
  }

  const hashes = [...uniquePoints.keys()];
  const existingDocs = await findByValues(
    mongo,
    POINTS,
    "hash",
    hashes,
    { hash: 1, ts: 1, loc: 1, ele: 1, importId: 1, importIds: 1, visible: 1 },
  );
  const existingByHash = new Map(
    existingDocs.filter((doc) => doc.visible !== false).map((doc) => [
      doc.hash,
      doc,
    ]),
  );

  const incomingByTs = pointGroups(uniquePoints.values());
  const unmatchedByTs = new Map<number, ParsedPoint[]>();
  for (const [timestamp, points] of incomingByTs) {
    const unmatched = points.filter((point) =>
      !existingByHash.has(pointHash(point))
    );
    if (unmatched.length > 0) unmatchedByTs.set(timestamp, unmatched);
  }

  const existingAtTimes = await findByValues(
    mongo,
    POINTS,
    "ts",
    [...unmatchedByTs.keys()].map((timestamp) => new Date(timestamp)),
    { hash: 1, ts: 1, loc: 1, ele: 1, visible: 1, selection: 1 },
  );
  const existingByTs = new Map<number, any[]>();
  for (const point of existingAtTimes) {
    if (point.visible === false || point.selection === "rejected") continue;
    const timestamp = new Date(point.ts).getTime();
    const group = existingByTs.get(timestamp) ?? [];
    group.push(point);
    existingByTs.set(timestamp, group);
  }

  const conflictHashes = new Set<string>();
  const conflicts: LocationImportPreview["conflicts"] = [];
  for (const [timestamp, incoming] of unmatchedByTs) {
    const existing = existingByTs.get(timestamp) ?? [];
    if (existing.length === 0) continue;
    for (const point of incoming) conflictHashes.add(pointHash(point));
    if (conflicts.length < 50) {
      conflicts.push({
        ts: new Date(timestamp),
        incoming: incoming.map((point) => ({
          hash: pointHash(point),
          lat: point.lat,
          lng: point.lng,
          ...(point.ele !== undefined ? { ele: point.ele } : {}),
        })),
        existing: existing.map((point) => ({
          hash: point.hash,
          lat: point.loc.coordinates[1],
          lng: point.loc.coordinates[0],
          ...(point.ele !== undefined ? { ele: point.ele } : {}),
        })),
      });
    }
  }
  const newHashes = new Set(
    hashes.filter((hash) =>
      !existingByHash.has(hash) && !conflictHashes.has(hash)
    ),
  );

  const sourceCounts = new Map<string, number>();
  for (const point of existingByHash.values()) {
    for (const importId of sourceImportIds(point)) {
      sourceCounts.set(importId, (sourceCounts.get(importId) ?? 0) + 1);
    }
  }
  const sourceObjectIds = [...sourceCounts.keys()].filter(ObjectId.isValid).map(
    (id) => new ObjectId(id),
  );
  const sourceImports = await findByValues(
    mongo,
    IMPORTS,
    "_id",
    sourceObjectIds,
    { filename: 1, committedAt: 1 },
  );
  const duplicateSources = sourceImports.filter((source) => source.committedAt)
    .map((source) => ({
      importId: String(source._id),
      filename: source.filename,
      matchedPoints: sourceCounts.get(String(source._id)) ?? 0,
    })).sort((a, b) => b.matchedPoints - a.matchedPoints);

  const trackFingerprints = dataset.tracks.map(trackFingerprint);
  const existingTracks = await findByValues(
    mongo,
    TRACKS,
    "fingerprint",
    trackFingerprints,
    { fingerprint: 1 },
  );
  const matchedTrackFingerprints = new Set(
    existingTracks.map((track) => track.fingerprint),
  );

  const bookmarkCoordinateHashes = dataset.bookmarks.map(coordinateHash);
  const existingBookmarks = await findByValues(
    mongo,
    BOOKMARKS,
    "coordinateHash",
    bookmarkCoordinateHashes,
    { coordinateHash: 1 },
  );
  const bookmarksByCoordinate = new Map<string, number>();
  for (const bookmark of existingBookmarks) {
    bookmarksByCoordinate.set(
      bookmark.coordinateHash,
      (bookmarksByCoordinate.get(bookmark.coordinateHash) ?? 0) + 1,
    );
  }
  const bookmarksMatched =
    dataset.bookmarks.filter((bookmark) =>
      bookmarksByCoordinate.get(coordinateHash(bookmark)) === 1
    ).length;
  const metadataReview =
    dataset.bookmarks.filter((bookmark) =>
      (bookmarksByCoordinate.get(coordinateHash(bookmark)) ?? 0) > 1
    ).length;
  const metadataDifferences: LocationImportPreview["metadataDifferences"] = [];
  for (const [hash, existingPoint] of existingByHash) {
    const incomingElevation = uniquePoints.get(hash)?.ele;
    if (
      existingPoint.ele !== undefined && incomingElevation !== undefined &&
      Number(existingPoint.ele) !== incomingElevation
    ) {
      metadataDifferences.push({
        kind: "elevation",
        hash,
        existing: Number(existingPoint.ele),
        incoming: incomingElevation,
      });
    }
  }
  for (const bookmark of dataset.bookmarks) {
    const hash = coordinateHash(bookmark);
    if ((bookmarksByCoordinate.get(hash) ?? 0) > 1) {
      metadataDifferences.push({
        kind: "ambiguous_bookmark",
        coordinateHash: hash,
      });
    }
  }

  const groupedConflictTimestamps = new Set(
    [...conflictHashes].map((hash) => Number(hash.split(":", 1)[0])),
  );
  const counts: LocationImportCounts = {
    sourcePoints: dataset.points.length,
    uniquePoints: uniquePoints.size,
    newPoints: newHashes.size,
    matchedPoints: existingByHash.size,
    withinFileDuplicates,
    conflictPoints: conflictHashes.size,
    conflictGroups: groupedConflictTimestamps.size,
    skipped: dataset.skipped,
    untimedCoordinates: dataset.untimedCoordinates,
    tracks: dataset.tracks.length,
    tracksNew:
      trackFingerprints.filter((fingerprint) =>
        !matchedTrackFingerprints.has(fingerprint)
      ).length,
    tracksMatched:
      trackFingerprints.filter((fingerprint) =>
        matchedTrackFingerprints.has(fingerprint)
      ).length,
    bookmarks: dataset.bookmarks.length,
    bookmarksNew: dataset.bookmarks.length - bookmarksMatched - metadataReview,
    bookmarksMatched,
    metadataReview: metadataReview +
      metadataDifferences.filter((difference) =>
        difference.kind === "elevation"
      ).length,
  };
  const revision = await getRevision(mongo);
  const fingerprint = sha256(JSON.stringify({ contentHash, revision, counts }));
  const pointValues = [...uniquePoints.values()];

  return {
    public: {
      filename,
      format,
      contentHash,
      ...(exact
        ? {
          exactFileMatch: {
            importId: String(exact._id),
            filename: exact.filename,
            createdAt: exact.createdAt,
          },
        }
        : {}),
      ...(pointValues.length > 0
        ? {
          timeRange: {
            start: pointValues[0].ts,
            end: pointValues[pointValues.length - 1].ts,
          },
        }
        : {}),
      counts,
      duplicateSources,
      conflicts,
      metadataDifferences: metadataDifferences.slice(0, 100),
      datasetMetadata: metadataForStorage(dataset.datasetMetadata),
      canConfirm: !exact &&
        (counts.newPoints > 0 || counts.matchedPoints > 0 ||
          counts.conflictPoints > 0 || counts.tracks > 0 ||
          counts.bookmarks > 0),
    },
    uniquePoints,
    existingByHash,
    newHashes,
    conflictHashes,
    existingAtConflict: existingByTs,
    trackFingerprints,
    bookmarkCoordinateHashes,
    revision,
    fingerprint,
  };
}

export async function analyzeLocationFile(
  auth: Auth,
  file: { originalname: string; mimetype: string; buffer: Uint8Array },
): Promise<LocationImportPreview> {
  const format = file.originalname.toLowerCase().endsWith(".gpx")
    ? "gpx"
    : file.originalname.toLowerCase().endsWith(".kml")
    ? "kml"
    : file.originalname.toLowerCase().endsWith(".kmz")
    ? "kmz"
    : null;
  if (!format) throw new Error("UNSUPPORTED_FORMAT");
  const bytes = new Uint8Array(file.buffer);
  const contentHash = sha256(bytes);
  const dataset = parseTrackFile(format, bytes);
  if (
    dataset.points.length === 0 && dataset.tracks.length === 0 &&
    dataset.bookmarks.length === 0
  ) {
    throw new Error("NO_LOCATION_DATA");
  }

  const mongo = await getMongoResource(auth);
  await cleanupExpiredPreviews(auth, mongo);
  const analysis = await analyzeLocationDataset(
    mongo,
    file.originalname,
    format,
    contentHash,
    dataset,
  );
  const previewId = new ObjectId();
  const expiresAt = new Date(Date.now() + PREVIEW_TTL_MS);
  let stagedFileId: ObjectId | undefined;
  if (!analysis.public.exactFileMatch) {
    stagedFileId = await uploadToGridFS(
      auth,
      new File([bytes], file.originalname, { type: file.mimetype }),
      FILE_BUCKET,
      { source: "location-import-preview", previewId: String(previewId) },
    );
  }
  await mongo({
    action: "insertOne",
    collection: PREVIEWS,
    doc: {
      _id: previewId,
      filename: file.originalname,
      format,
      contentHash,
      ...(stagedFileId ? { stagedFileId } : {}),
      status: "ready",
      parserVersion: LOCATION_PARSER_VERSION,
      pointHashVersion: LOCATION_POINT_HASH_VERSION,
      revision: analysis.revision,
      analysisFingerprint: analysis.fingerprint,
      analysis: analysis.public,
      expiresAt,
      createdAt: new Date(),
      createdBy: auth.principal || "web",
    },
  });
  return { previewId: String(previewId), expiresAt, ...analysis.public };
}

async function upsertTracks(
  mongo: MongoCall,
  importId: ObjectId,
  format: TrackFormat,
  tracks: ParsedTrack[],
): Promise<void> {
  const fingerprints = tracks.map(trackFingerprint);
  const existingTracks = await findByValues(
    mongo,
    TRACKS,
    "fingerprint",
    fingerprints,
  );
  const existingByFingerprint = new Map(
    existingTracks.map((track) => [track.fingerprint, track]),
  );
  for (const batch of chunk(tracks, WRITE_BATCH)) {
    const operations = batch.map((track) => {
      const fingerprint = trackFingerprint(track);
      const metadata = metadataForStorage(track);
      const path = decimateCoordinates(track.coordinates);
      const existing = existingByFingerprint.get(fingerprint);
      const applyCanonical = !existing?.manualOverrides &&
        Number(existing?.metadataPriority ?? 0) <= metadataPriority(format);
      return {
        updateOne: {
          filter: { fingerprint },
          update: {
            $setOnInsert: {
              _id: new ObjectId(),
              fingerprint,
              kind: track.kind,
              path,
              pointCount: track.coordinates.length,
              createdAt: new Date(),
            },
            ...(applyCanonical
              ? {
                $set: {
                  metadata,
                  displayName: displayName(track) ?? null,
                  style: track.style ?? null,
                  visibility: track.visibility ?? true,
                  metadataPriority: metadataPriority(format),
                },
              }
              : {}),
            $addToSet: {
              sourceRefs: {
                importId,
                format,
                sourceIndex: track.sourceIndex,
                metadata,
              },
            },
          },
          upsert: true,
        },
      };
    });
    if (operations.length > 0) {
      await mongo({
        action: "bulkWrite",
        collection: TRACKS,
        operations,
        options: { ordered: false },
      });
    }
  }
}

async function upsertBookmarks(
  mongo: MongoCall,
  importId: ObjectId,
  format: TrackFormat,
  bookmarks: ParsedBookmark[],
): Promise<void> {
  const coordinateHashes = bookmarks.map(coordinateHash);
  const existing = await findByValues(
    mongo,
    BOOKMARKS,
    "coordinateHash",
    coordinateHashes,
  );
  const byCoordinate = new Map<string, any[]>();
  for (const bookmark of existing) {
    const values = byCoordinate.get(bookmark.coordinateHash) ?? [];
    values.push(bookmark);
    byCoordinate.set(bookmark.coordinateHash, values);
  }
  const operations: any[] = [];
  for (const bookmark of bookmarks) {
    const coordHash = coordinateHash(bookmark);
    const candidates = byCoordinate.get(coordHash) ?? [];
    const metadata = metadataForStorage(bookmark);
    const canonical = {
      metadata,
      displayName: displayName(bookmark) ?? null,
      description: bookmark.description ?? null,
      featureTypes: bookmark.featureTypes ?? [],
      icon: bookmark.icon ?? bookmark.style?.icon ?? null,
      style: bookmark.style ?? null,
      scale: bookmark.scale ?? null,
      visibility: bookmark.visibility ?? true,
      sourceTimestamp: bookmark.sourceTimestamp ?? null,
      metadataPriority: metadataPriority(format),
    };
    const sourceRef = {
      importId,
      format,
      sourceIndex: bookmark.sourceIndex,
      metadata,
    };
    if (candidates.length === 1) {
      const applyCanonical = !candidates[0].manualOverrides &&
        Number(candidates[0].metadataPriority ?? 0) <= metadataPriority(format);
      operations.push({
        updateOne: {
          filter: { _id: candidates[0]._id },
          update: {
            ...(applyCanonical ? { $set: canonical } : {}),
            $addToSet: { sourceRefs: sourceRef },
          },
        },
      });
    } else {
      operations.push({
        insertOne: {
          document: {
            _id: new ObjectId(),
            coordinateHash: coordHash,
            loc: {
              type: "Point",
              coordinates: [bookmark.lng, bookmark.lat],
            },
            ...(bookmark.ele !== undefined ? { ele: bookmark.ele } : {}),
            ...canonical,
            sourceRefs: [sourceRef],
            ...(candidates.length > 1 ? { reviewStatus: "pending" } : {}),
            createdAt: new Date(),
          },
        },
      });
    }
  }
  for (const batch of chunk(operations, WRITE_BATCH)) {
    await mongo({
      action: "bulkWrite",
      collection: BOOKMARKS,
      operations: batch,
      options: { ordered: false },
    });
  }
}

async function recordConflicts(
  mongo: MongoCall,
  importId: ObjectId,
  format: TrackFormat,
  analysis: AnalysisInternal,
): Promise<void> {
  const grouped = pointGroups(
    [...analysis.uniquePoints.entries()].filter(([hash]) =>
      analysis.conflictHashes.has(hash)
    ).map(([, point]) => point),
  );
  const operations = [...grouped.entries()].map(([timestamp, incoming]) => ({
    updateOne: {
      filter: { conflictKey: `ts:${timestamp}` },
      update: {
        $setOnInsert: {
          _id: new ObjectId(),
          conflictKey: `ts:${timestamp}`,
          ts: new Date(timestamp),
          status: "pending",
          createdAt: new Date(),
        },
        $addToSet: {
          candidates: {
            importId,
            format,
            points: incoming.map((point) => ({
              hash: pointHash(point),
              loc: {
                type: "Point",
                coordinates: [point.lng, point.lat],
              },
              ...(point.ele !== undefined ? { ele: point.ele } : {}),
            })),
          },
          sourceImportIds: importId,
        },
        $set: {
          existingPoints: (analysis.existingAtConflict.get(timestamp) ?? [])
            .map((point) => ({
              hash: point.hash,
              loc: point.loc,
              ...(point.ele !== undefined ? { ele: point.ele } : {}),
            })),
        },
      },
      upsert: true,
    },
  }));
  for (const batch of chunk(operations, WRITE_BATCH)) {
    await mongo({
      action: "bulkWrite",
      collection: CONFLICTS,
      operations: batch,
      options: { ordered: false },
    });
  }
}

async function compensateFailedCommit(
  mongo: MongoCall,
  importId: ObjectId,
): Promise<void> {
  await mongo({
    action: "deleteMany",
    collection: POINTS,
    query: { createdByImportId: importId, visible: false },
  });
  await mongo({
    action: "updateMany",
    collection: POINTS,
    query: { importIds: importId },
    update: {
      $pull: {
        importIds: importId,
        sourceRefs: { importId },
      },
    },
  });
  for (const collection of [TRACKS, BOOKMARKS]) {
    await mongo({
      action: "deleteMany",
      collection,
      query: {
        "sourceRefs.importId": importId,
        sourceRefs: { $size: 1 },
      },
    });
    await mongo({
      action: "updateMany",
      collection,
      query: { "sourceRefs.importId": importId },
      update: { $pull: { sourceRefs: { importId } } },
    });
  }
}

export class StaleLocationPreviewError extends Error {
  constructor(public refreshed: LocationImportPreview) {
    super("LOCATION_PREVIEW_STALE");
  }
}

export async function confirmLocationPreview(
  auth: Auth,
  previewIdString: string,
): Promise<any> {
  if (!ObjectId.isValid(previewIdString)) throw new Error("PREVIEW_NOT_FOUND");
  const previewId = new ObjectId(previewIdString);
  const mongo = await getMongoResource(auth);
  const preview = await mongo({
    action: "findOne",
    collection: PREVIEWS,
    query: { _id: previewId },
  });
  if (!preview || preview.expiresAt < new Date()) {
    throw new Error("PREVIEW_NOT_FOUND");
  }
  if (preview.status === "confirmed" && preview.receipt) return preview.receipt;
  if (preview.analysis?.exactFileMatch) {
    const receipt = {
      duplicate: true,
      importId: preview.analysis.exactFileMatch.importId,
      filename: preview.filename,
      counts: preview.analysis.counts,
    };
    await mongo({
      action: "updateOne",
      collection: PREVIEWS,
      query: { _id: previewId },
      update: {
        $set: { status: "confirmed", receipt, confirmedAt: new Date() },
      },
    });
    return receipt;
  }
  if (!preview.stagedFileId) throw new Error("PREVIEW_FILE_MISSING");

  const fs = await getFsResource(auth);
  const bytes: Uint8Array = await fs({
    action: "download",
    bucket: FILE_BUCKET,
    id: String(preview.stagedFileId),
  });
  if (sha256(bytes) !== preview.contentHash) {
    throw new Error("PREVIEW_FILE_CHANGED");
  }
  const dataset = parseTrackFile(preview.format, bytes);
  const analysis = await analyzeLocationDataset(
    mongo,
    preview.filename,
    preview.format,
    preview.contentHash,
    dataset,
  );
  if (
    analysis.revision !== preview.revision ||
    analysis.fingerprint !== preview.analysisFingerprint
  ) {
    const expiresAt = new Date(Date.now() + PREVIEW_TTL_MS);
    const refreshed = {
      previewId: String(previewId),
      expiresAt,
      ...analysis.public,
    };
    await mongo({
      action: "updateOne",
      collection: PREVIEWS,
      query: { _id: previewId },
      update: {
        $set: {
          revision: analysis.revision,
          analysisFingerprint: analysis.fingerprint,
          analysis: analysis.public,
          expiresAt,
        },
      },
    });
    throw new StaleLocationPreviewError(refreshed);
  }

  const claimed = await mongo({
    action: "findOneAndUpdate",
    collection: PREVIEWS,
    query: { _id: previewId, status: "ready" },
    update: { $set: { status: "committing", commitStartedAt: new Date() } },
    options: { returnDocument: "after" },
  });
  if (!claimed) {
    const latest = await mongo({
      action: "findOne",
      collection: PREVIEWS,
      query: { _id: previewId },
    });
    if (latest?.status === "confirmed" && latest.receipt) return latest.receipt;
    throw new Error("PREVIEW_COMMITTING");
  }

  let importId = new ObjectId();
  try {
    const importDoc = await mongo({
      action: "findOne",
      collection: IMPORTS,
      query: { contentHash: preview.contentHash },
    });
    if (importDoc?.committedAt) {
      const receipt = {
        duplicate: true,
        importId: String(importDoc._id),
        filename: preview.filename,
        counts: importDoc.receipt ?? analysis.public.counts,
      };
      await mongo({
        action: "updateOne",
        collection: PREVIEWS,
        query: { _id: previewId },
        update: {
          $set: { status: "confirmed", receipt, confirmedAt: new Date() },
        },
      });
      return receipt;
    }
    importId = importDoc?._id ?? importId;
    if (!importDoc) {
      await mongo({
        action: "insertOne",
        collection: IMPORTS,
        doc: {
          _id: importId,
          filename: preview.filename,
          format: preview.format,
          contentHash: preview.contentHash,
          fileId: preview.stagedFileId,
          previewId,
          parserVersion: LOCATION_PARSER_VERSION,
          pointHashVersion: LOCATION_POINT_HASH_VERSION,
          datasetMetadata: metadataForStorage(dataset.datasetMetadata),
          status: "committing",
          createdAt: new Date(),
          createdBy: auth.principal || "web",
        },
      });
    } else {
      await mongo({
        action: "updateOne",
        collection: IMPORTS,
        query: { _id: importId },
        update: { $set: { status: "committing", lastError: null } },
      });
    }

    await upsertTracks(mongo, importId, preview.format, dataset.tracks);
    await upsertBookmarks(mongo, importId, preview.format, dataset.bookmarks);

    const matchedHashes = [...analysis.existingByHash.keys()];
    for (const hashes of chunk(matchedHashes, WRITE_BATCH)) {
      await mongo({
        action: "updateMany",
        collection: POINTS,
        query: { hash: { $in: hashes }, visible: { $ne: false } },
        update: {
          $addToSet: {
            importIds: importId,
            sourceRefs: { importId, format: preview.format },
          },
        },
      });
    }
    const elevationEnrichment = [...analysis.existingByHash.entries()].filter(
      ([hash, existing]) =>
        existing.ele === undefined &&
        analysis.uniquePoints.get(hash)?.ele !== undefined,
    );
    for (const batch of chunk(elevationEnrichment, WRITE_BATCH)) {
      await mongo({
        action: "bulkWrite",
        collection: POINTS,
        operations: batch.map(([hash]) => ({
          updateOne: {
            filter: { hash, ele: { $exists: false } },
            update: {
              $set: { ele: analysis.uniquePoints.get(hash)!.ele },
            },
          },
        })),
        options: { ordered: false },
      });
    }

    const newPoints = [...analysis.newHashes].map((hash) => ({
      hash,
      point: analysis.uniquePoints.get(hash)!,
    }));
    for (const batch of chunk(newPoints, WRITE_BATCH)) {
      await mongo({
        action: "bulkWrite",
        collection: POINTS,
        operations: batch.map(({ hash, point }) => ({
          updateOne: {
            filter: { hash },
            update: {
              $set: {
                ts: point.ts,
                loc: {
                  type: "Point",
                  coordinates: [point.lng, point.lat],
                },
                ...(point.ele !== undefined ? { ele: point.ele } : {}),
                importId,
                visibilityOwner: importId,
                visible: false,
                selection: "accepted",
                recoveryState: null,
              },
              $setOnInsert: {
                _id: new ObjectId(),
                hash,
                createdAt: new Date(),
                createdByImportId: importId,
              },
              $addToSet: {
                importIds: importId,
                sourceRefs: { importId, format: preview.format },
              },
            },
            upsert: true,
          },
        })),
        options: { ordered: false },
      });
    }
    await recordConflicts(mongo, importId, preview.format, analysis);

    // One multi-document update publishes every newly-owned point before the
    // import becomes eligible for processing. No worker is triggered earlier.
    await mongo({
      action: "updateMany",
      collection: POINTS,
      query: { visibilityOwner: importId },
      update: {
        $set: { visible: true },
        $unset: { recoveryState: "" },
      },
    });

    const counts = analysis.public.counts;
    const receipt = {
      ...counts,
      pointsImported: counts.newPoints,
      pointsDeduplicated: counts.matchedPoints + counts.withinFileDuplicates,
      pointsSkipped: counts.skipped,
    };
    await mongo({
      action: "updateOne",
      collection: IMPORTS,
      query: { _id: importId },
      update: {
        $set: {
          status: "parsed",
          committedAt: new Date(),
          receipt,
          metadataDifferences: analysis.public.metadataDifferences,
          pointCount: counts.newPoints,
          dedupedCount: counts.matchedPoints + counts.withinFileDuplicates,
          skippedCount: counts.skipped,
          ...(analysis.public.timeRange
            ? { timeRange: analysis.public.timeRange }
            : {}),
        },
      },
    });
    await bumpLocationImportRevision(mongo);
    const response = {
      importId: String(importId),
      filename: preview.filename,
      status: "parsed",
      counts,
      ...receipt,
    };
    await mongo({
      action: "updateOne",
      collection: PREVIEWS,
      query: { _id: previewId },
      update: {
        $set: {
          status: "confirmed",
          receipt: response,
          confirmedAt: new Date(),
        },
      },
    });
    return response;
  } catch (error) {
    if (importId) {
      await compensateFailedCommit(mongo, importId);
      await mongo({
        action: "updateOne",
        collection: IMPORTS,
        query: { _id: importId },
        update: {
          $set: {
            status: "failed",
            lastError: error instanceof Error ? error.message : String(error),
            failedAt: new Date(),
          },
        },
      });
    }
    await mongo({
      action: "updateOne",
      collection: PREVIEWS,
      query: { _id: previewId },
      update: {
        $set: {
          status: "ready",
          lastError: error instanceof Error ? error.message : String(error),
        },
      },
    });
    throw error;
  }
}
