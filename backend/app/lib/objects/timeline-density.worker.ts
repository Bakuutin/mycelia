import { ObjectId } from "bson";
import type { Db } from "mongodb";
import { getRootDB } from "@/lib/mongo/core.server.ts";
import { TIMELINE_OBJECT_RANGE_INDEX } from "./timeline-query.ts";
import {
  computeObjectDensityBuckets,
  extractObjectDensityStarts,
  getTimelineObjectCategory,
  OBJECT_DENSITY_RESOLUTION_MS,
  OBJECT_DENSITY_RESOLUTIONS,
  OBJECT_TIMELINE_DENSITY_COLLECTION,
  OBJECT_TIMELINE_DENSITY_PENDING_COLLECTION,
  OBJECT_TIMELINE_DENSITY_SOURCE_COLLECTION,
  OBJECT_TIMELINE_DENSITY_STATE_COLLECTION,
  type ObjectDensityBucket,
  objectDensityBucketEnd,
  objectDensityBucketStart,
  type ObjectDensityResolution,
  type TimelineObjectCategory,
  type TimelineObjectLike,
} from "./timeline-density.ts";

export const OBJECT_DENSITY_REBUILD_MAX_TIME_MS = 30_000;
export const OBJECT_DENSITY_INCREMENTAL_MAX_TIME_MS = 5_000;
export const OBJECT_DENSITY_WINDOW_MS = 31 * 24 * 60 * 60 * 1_000;
export const OBJECT_DENSITY_PENDING_BATCH_SIZE = 100;
export const OBJECT_DENSITY_LEASE_MS = 5 * 60 * 1_000;
export const OBJECT_DENSITY_PENDING_WRITE_GRACE_MS = 5_000;
const OBJECT_DENSITY_SOURCE_BATCH_SIZE = 1_000;
const OBJECT_DENSITY_RETRY_MS = 60_000;

const DENSITY_OBJECT_PROJECTION = {
  _id: 1,
  timeRanges: 1,
  isPerson: 1,
  isEvent: 1,
  isPromise: 1,
  isRelationship: 1,
  isPlace: 1,
  isOrganization: 1,
  isProduct: 1,
  isProject: 1,
  isAnimal: 1,
  isConcept: 1,
  isMedia: 1,
} as const;

type PendingWrite = {
  token: string;
  sequence: number;
  queuedAt: Date;
};

type ObjectDensitySource = {
  _id: unknown;
  category: TimelineObjectCategory;
  starts: Date[];
  generation?: string;
  projectedAt: Date;
};

type ObjectDensityPending = {
  _id: unknown;
  sequence: number;
  queuedAt: Date;
  latestAt: Date;
  tokens: string[];
  oldSource?: ObjectDensitySource | null;
};

export type ObjectDensityState = {
  _id: string;
  ready?: boolean;
  building?: boolean;
  dirty?: boolean;
  repairStatus?: string;
  hasFullRebuild?: boolean;
  changeSequence?: number;
  processedSequence?: number;
  pendingWrites?: PendingWrite[];
  lease?: {
    owner: string;
    generation: string;
    kind: "incremental" | "rebuild";
    expiresAt: Date;
  };
  calculatedAt?: Date;
  [key: string]: unknown;
};

type DensityLease = {
  owner: string;
  generation: string;
  kind: "incremental" | "rebuild";
  expiresAt: Date;
  state: ObjectDensityState;
};

export type ObjectDensityChange = {
  operationType: "insert" | "update" | "replace" | "delete";
  documentId: unknown;
  document?: TimelineObjectLike | null;
};

export type ObjectDensityRebuildOptions = {
  windowMs?: number;
  leaseOwner?: string;
  leaseMs?: number;
  onProgress?: (progress: {
    start: Date;
    end: Date;
    processedThrough: Date;
  }) => void | Promise<void>;
  onHourBucketsMaterialized?: (window: {
    start: Date;
    end: Date;
  }) => void | Promise<void>;
};

export type ObjectDensityDrainResult = {
  busy: boolean;
  processedObjects: number;
  recalculatedBuckets: number;
  ready: boolean;
  retryAt?: Date;
};

export class ObjectDensityLeaseConflictError extends Error {
  code = 409;
}

function normalizeDocumentId(value: unknown): unknown {
  if (typeof value === "string" && /^[a-f\d]{24}$/i.test(value)) {
    return new ObjectId(value);
  }
  return value;
}

function sourceFromObject(
  object: TimelineObjectLike,
  generation?: string,
): ObjectDensitySource | null {
  if (object._id == null) return null;
  const starts = extractObjectDensityStarts(object);
  if (starts.length === 0) return null;
  return {
    _id: object._id,
    category: getTimelineObjectCategory(object),
    starts,
    generation,
    projectedAt: new Date(),
  };
}

function dirtyBucketKeys(
  oldSource: ObjectDensitySource | null,
  newSource: ObjectDensitySource | null,
): Array<{ resolution: ObjectDensityResolution; start: Date }> {
  const keys = new Map<
    string,
    { resolution: ObjectDensityResolution; start: Date }
  >();
  for (const source of [oldSource, newSource]) {
    if (!source) continue;
    for (const rangeStart of source.starts) {
      for (const resolution of OBJECT_DENSITY_RESOLUTIONS) {
        const start = objectDensityBucketStart(rangeStart, resolution);
        keys.set(`${resolution}:${start.getTime()}`, { resolution, start });
      }
    }
  }
  return [...keys.values()];
}

function isMaxTimeExpired(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as {
    code?: unknown;
    codeName?: unknown;
    message?: unknown;
  };
  return candidate.code === 50 || candidate.codeName === "MaxTimeMSExpired" ||
    (typeof candidate.message === "string" &&
      /MaxTimeMSExpired|operation exceeded time limit/i.test(
        candidate.message,
      ));
}

function leaseFilter(lease: DensityLease) {
  return {
    _id: "current",
    "lease.owner": lease.owner,
    "lease.generation": lease.generation,
  };
}

async function ensureDensityState(db: Db): Promise<void> {
  await db.collection<ObjectDensityState>(
    OBJECT_TIMELINE_DENSITY_STATE_COLLECTION,
  ).updateOne(
    { _id: "current" },
    {
      $setOnInsert: {
        ready: false,
        building: false,
        dirty: true,
        repairStatus: "not-built",
        hasFullRebuild: false,
        changeSequence: 0,
        processedSequence: 0,
        pendingWrites: [],
      },
    },
    { upsert: true },
  );
}

export async function acquireObjectDensityLease(
  db: Db,
  kind: "incremental" | "rebuild",
  options: { owner?: string; leaseMs?: number } = {},
): Promise<DensityLease | null> {
  await ensureDensityState(db);
  const now = new Date();
  const owner = options.owner ?? `${kind}:${crypto.randomUUID()}`;
  const generation = crypto.randomUUID();
  const expiresAt = new Date(
    now.getTime() + Math.max(1_000, options.leaseMs ?? OBJECT_DENSITY_LEASE_MS),
  );
  const state = await db.collection<ObjectDensityState>(
    OBJECT_TIMELINE_DENSITY_STATE_COLLECTION,
  ).findOneAndUpdate(
    {
      _id: "current",
      $or: [
        { lease: { $exists: false } },
        { "lease.expiresAt": { $lte: now } },
      ],
    },
    {
      $set: {
        lease: { owner, generation, kind, expiresAt },
        ...(kind === "rebuild"
          ? {
            ready: false,
            building: true,
            repairStatus: "rebuilding",
            rebuildStartedAt: now,
            rebuildGeneration: generation,
          }
          : { repairStatus: "processing" }),
      },
      $unset: { error: "", failedAt: "" },
    },
    { returnDocument: "after" },
  );
  if (!state) return null;
  return { owner, generation, kind, expiresAt, state };
}

async function renewDensityLease(
  db: Db,
  lease: DensityLease,
  leaseMs = OBJECT_DENSITY_LEASE_MS,
): Promise<void> {
  const expiresAt = new Date(Date.now() + Math.max(1_000, leaseMs));
  const result = await db.collection<ObjectDensityState>(
    OBJECT_TIMELINE_DENSITY_STATE_COLLECTION,
  ).updateOne(
    leaseFilter(lease),
    { $set: { "lease.expiresAt": expiresAt } },
  );
  if (result.matchedCount !== 1) {
    throw new ObjectDensityLeaseConflictError(
      "Object density processing lease was lost",
    );
  }
  lease.expiresAt = expiresAt;
}

async function failDensityLease(
  db: Db,
  lease: DensityLease,
  error: unknown,
): Promise<void> {
  await db.collection(OBJECT_TIMELINE_DENSITY_COLLECTION).updateMany(
    {},
    { $set: { stale: true } },
    { maxTimeMS: OBJECT_DENSITY_REBUILD_MAX_TIME_MS },
  ).catch(() => undefined);
  await db.collection<ObjectDensityState>(
    OBJECT_TIMELINE_DENSITY_STATE_COLLECTION,
  ).updateOne(
    leaseFilter(lease),
    {
      $set: {
        ready: false,
        building: false,
        dirty: true,
        repairStatus: "failed",
        error: error instanceof Error ? error.message : String(error),
        failedAt: new Date(),
      },
      $unset: { lease: "" },
    },
  );
}

async function loadDensityObjects(
  db: Db,
  start: Date,
  end: Date,
  maxTimeMS: number,
): Promise<TimelineObjectLike[]> {
  return await db.collection<TimelineObjectLike>("objects").find(
    { "timeRanges.start": { $gte: start, $lt: end } },
    {
      projection: DENSITY_OBJECT_PROJECTION,
      hint: TIMELINE_OBJECT_RANGE_INDEX,
      maxTimeMS,
    },
  ).toArray();
}

async function replaceDensityBuckets(
  db: Db,
  resolution: ObjectDensityResolution,
  start: Date,
  end: Date,
  buckets: ObjectDensityBucket[],
): Promise<void> {
  const collection = db.collection(OBJECT_TIMELINE_DENSITY_COLLECTION);
  await collection.deleteMany(
    { resolution, start: { $gte: start, $lt: end } },
    { maxTimeMS: OBJECT_DENSITY_REBUILD_MAX_TIME_MS },
  );
  if (buckets.length === 0) return;
  await collection.bulkWrite(
    buckets.map((bucket) => ({
      updateOne: {
        filter: { resolution: bucket.resolution, start: bucket.start },
        update: { $set: bucket },
        upsert: true,
      },
    })),
    { ordered: false },
  );
}

export async function recalculateObjectDensityBucket(
  db: Db,
  resolution: ObjectDensityResolution,
  start: Date,
): Promise<ObjectDensityBucket | null> {
  const alignedStart = objectDensityBucketStart(start, resolution);
  const end = objectDensityBucketEnd(alignedStart, resolution);
  const objects = await loadDensityObjects(
    db,
    alignedStart,
    end,
    OBJECT_DENSITY_INCREMENTAL_MAX_TIME_MS,
  );
  const bucket = computeObjectDensityBuckets(
    objects,
    alignedStart,
    end,
    resolution,
  )[0] ?? null;
  const collection = db.collection(OBJECT_TIMELINE_DENSITY_COLLECTION);
  if (!bucket) {
    await collection.deleteOne({ resolution, start: alignedStart });
    return null;
  }
  await collection.updateOne(
    { resolution, start: alignedStart },
    { $set: bucket },
    { upsert: true },
  );
  return bucket;
}

/** Persist first; only then may the change-stream event be acknowledged. */
export async function persistObjectDensityChange(
  db: Db,
  change: ObjectDensityChange,
): Promise<{ sequence: number; token: string }> {
  await ensureDensityState(db);
  const id = normalizeDocumentId(change.document?._id ?? change.documentId);
  if (id == null || id === "unknown") {
    throw new Error("Object density change is missing its document id");
  }
  const token = crypto.randomUUID();
  const queuedAt = new Date();
  const stateCollection = db.collection<ObjectDensityState>(
    OBJECT_TIMELINE_DENSITY_STATE_COLLECTION,
  );
  const state = await stateCollection.findOneAndUpdate(
    { _id: "current" },
    [{
      $set: {
        ready: false,
        dirty: true,
        lastObjectChangeAt: queuedAt,
        changeSequence: { $add: [{ $ifNull: ["$changeSequence", 0] }, 1] },
        repairStatus: {
          $cond: [{ $eq: ["$building", true] }, "rebuilding", "pending"],
        },
        pendingWrites: {
          $concatArrays: [
            { $ifNull: ["$pendingWrites", []] },
            [{
              token,
              queuedAt,
              sequence: { $add: [{ $ifNull: ["$changeSequence", 0] }, 1] },
            }],
          ],
        },
      },
    }],
    { returnDocument: "after" },
  );
  if (!state) throw new Error("Object density state disappeared while queuing");
  const sequence = Number(state.changeSequence ?? 0);

  try {
    // Preserve the earliest projected membership. A full rebuild can scan the
    // old hour, then observe the object's new hour later; the id alone cannot
    // tell the drain which old bucket must be removed.
    const oldSource = await db.collection<ObjectDensitySource>(
      OBJECT_TIMELINE_DENSITY_SOURCE_COLLECTION,
    ).findOne(
      { _id: id } as never,
      { maxTimeMS: OBJECT_DENSITY_INCREMENTAL_MAX_TIME_MS },
    );
    await db.collection<ObjectDensityPending>(
      OBJECT_TIMELINE_DENSITY_PENDING_COLLECTION,
    ).updateOne(
      { _id: id } as never,
      {
        $set: { sequence, latestAt: queuedAt },
        $setOnInsert: { queuedAt, oldSource },
        $addToSet: { tokens: token },
      },
      { upsert: true },
    );
  } catch (error) {
    await stateCollection.updateOne(
      { _id: "current", "pendingWrites.token": token },
      {
        $set: {
          ready: false,
          dirty: true,
          repairStatus: "rebuild-required",
          error: error instanceof Error ? error.message : String(error),
          failedAt: new Date(),
        },
      },
    );
    throw error;
  }
  return { sequence, token };
}

async function processPendingBatch(
  db: Db,
  lease: DensityLease,
  pending: ObjectDensityPending[],
): Promise<{ objects: number; buckets: number }> {
  const ids = pending.map((item) => item._id);
  const [oldSources, currentObjects] = await Promise.all([
    db.collection<ObjectDensitySource>(
      OBJECT_TIMELINE_DENSITY_SOURCE_COLLECTION,
    ).find(
      { _id: { $in: ids } } as never,
      { maxTimeMS: OBJECT_DENSITY_INCREMENTAL_MAX_TIME_MS },
    ).toArray(),
    db.collection<TimelineObjectLike>("objects").find(
      { _id: { $in: ids } } as never,
      {
        projection: DENSITY_OBJECT_PROJECTION,
        maxTimeMS: OBJECT_DENSITY_INCREMENTAL_MAX_TIME_MS,
      },
    ).toArray(),
  ]);
  const oldById = new Map(oldSources.map((item) => [String(item._id), item]));
  const pendingById = new Map(
    pending.map((item) => [String(item._id), item]),
  );
  const currentById = new Map(
    currentObjects.map((item) => [String(item._id), item]),
  );
  const nextSources = new Map<string, ObjectDensitySource | null>();
  const dirty = new Map<
    string,
    { resolution: ObjectDensityResolution; start: Date }
  >();
  for (const id of ids) {
    const key = String(id);
    const queued = pendingById.get(key);
    const oldSource = queued?.oldSource ?? oldById.get(key) ?? null;
    const current = currentById.get(key);
    const nextSource = current ? sourceFromObject(current) : null;
    nextSources.set(key, nextSource);
    for (const bucket of dirtyBucketKeys(oldSource, nextSource)) {
      dirty.set(`${bucket.resolution}:${bucket.start.getTime()}`, bucket);
    }
  }

  const dirtyKeys = [...dirty.values()];
  if (dirtyKeys.length > 0) {
    await db.collection(OBJECT_TIMELINE_DENSITY_COLLECTION).updateMany(
      {
        $or: dirtyKeys.map((key) => ({
          resolution: key.resolution,
          start: key.start,
        })),
      },
      { $set: { stale: true } },
      { maxTimeMS: OBJECT_DENSITY_INCREMENTAL_MAX_TIME_MS },
    );
  }
  for (const key of dirtyKeys) {
    await renewDensityLease(db, lease);
    await recalculateObjectDensityBucket(db, key.resolution, key.start);
  }

  const sourceOperations = ids.map((id) => {
    const source = nextSources.get(String(id));
    return source
      ? {
        replaceOne: {
          filter: { _id: id },
          replacement: source,
          upsert: true,
        },
      }
      : { deleteOne: { filter: { _id: id } } };
  });
  if (sourceOperations.length > 0) {
    await db.collection(OBJECT_TIMELINE_DENSITY_SOURCE_COLLECTION).bulkWrite(
      sourceOperations as never[],
      { ordered: false },
    );
  }

  const tokens = [...new Set(pending.flatMap((item) => item.tokens ?? []))];
  if (tokens.length > 0) {
    await db.collection<ObjectDensityState>(
      OBJECT_TIMELINE_DENSITY_STATE_COLLECTION,
    ).updateOne(
      leaseFilter(lease),
      { $pull: { pendingWrites: { token: { $in: tokens } } } } as never,
    );
  }
  await db.collection(OBJECT_TIMELINE_DENSITY_PENDING_COLLECTION).bulkWrite(
    pending.map((item) => ({
      deleteOne: { filter: { _id: item._id, sequence: item.sequence } },
    })) as never[],
    { ordered: false },
  );
  await db.collection<ObjectDensityState>(
    OBJECT_TIMELINE_DENSITY_STATE_COLLECTION,
  ).updateOne(
    leaseFilter(lease),
    { $set: { lastIncrementalAt: new Date() } },
  );
  return { objects: pending.length, buckets: dirtyKeys.length };
}

async function drainPendingUnderLease(
  db: Db,
  lease: DensityLease,
): Promise<{ processedObjects: number; recalculatedBuckets: number }> {
  let processedObjects = 0;
  let recalculatedBuckets = 0;
  while (true) {
    await renewDensityLease(db, lease);
    const pending = await db.collection<ObjectDensityPending>(
      OBJECT_TIMELINE_DENSITY_PENDING_COLLECTION,
    ).find(
      {},
      {
        sort: { queuedAt: 1, _id: 1 },
        limit: OBJECT_DENSITY_PENDING_BATCH_SIZE,
        maxTimeMS: OBJECT_DENSITY_INCREMENTAL_MAX_TIME_MS,
      },
    ).toArray();
    if (pending.length === 0) break;
    const result = await processPendingBatch(db, lease, pending);
    processedObjects += result.objects;
    recalculatedBuckets += result.buckets;
  }
  return { processedObjects, recalculatedBuckets };
}

async function finishIncrementalLease(
  db: Db,
  lease: DensityLease,
): Promise<{ complete: boolean; ready: boolean; gap: boolean }> {
  const stateCollection = db.collection<ObjectDensityState>(
    OBJECT_TIMELINE_DENSITY_STATE_COLLECTION,
  );
  const state = await stateCollection.findOne(leaseFilter(lease));
  if (!state) {
    throw new ObjectDensityLeaseConflictError(
      "Object density processing lease was lost before completion",
    );
  }
  const remaining = await db.collection(
    OBJECT_TIMELINE_DENSITY_PENDING_COLLECTION,
  )
    .findOne({}, { projection: { _id: 1 }, maxTimeMS: 1_000 });
  if (remaining) return { complete: false, ready: false, gap: false };
  if ((state.pendingWrites?.length ?? 0) > 0) {
    const oldestQueuedAt = Math.min(
      ...state.pendingWrites!.map((write) =>
        new Date(write.queuedAt).getTime()
      ),
    );
    if (oldestQueuedAt > Date.now() - OBJECT_DENSITY_PENDING_WRITE_GRACE_MS) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      return { complete: false, ready: false, gap: false };
    }
    await stateCollection.updateOne(
      leaseFilter(lease),
      {
        $set: {
          ready: false,
          building: false,
          dirty: true,
          repairStatus: "rebuild-required",
          error:
            "A density change was not durably queued; full rebuild required",
        },
        $unset: { lease: "" },
      },
    );
    return { complete: true, ready: false, gap: true };
  }
  const sequence = Number(state.changeSequence ?? 0);
  const ready = state.hasFullRebuild === true;
  const result = await stateCollection.updateOne(
    {
      ...leaseFilter(lease),
      changeSequence: sequence,
      pendingWrites: { $size: 0 },
    },
    {
      $set: {
        ready,
        building: false,
        dirty: !ready,
        processedSequence: sequence,
        repairStatus: ready ? "ready" : "not-built",
        ...(ready ? { calculatedAt: new Date() } : {}),
      },
      $unset: { lease: "", error: "", failedAt: "" },
    },
  );
  return { complete: result.modifiedCount === 1, ready, gap: false };
}

export async function drainObjectDensityPending(
  db: Db,
  options: { owner?: string; leaseMs?: number } = {},
): Promise<ObjectDensityDrainResult> {
  const lease = await acquireObjectDensityLease(db, "incremental", options);
  if (!lease) {
    const state = await db.collection<ObjectDensityState>(
      OBJECT_TIMELINE_DENSITY_STATE_COLLECTION,
    ).findOne({ _id: "current" });
    return {
      busy: true,
      processedObjects: 0,
      recalculatedBuckets: 0,
      ready: state?.ready === true,
      retryAt: state?.lease?.expiresAt,
    };
  }
  let processedObjects = 0;
  let recalculatedBuckets = 0;
  try {
    while (true) {
      const drained = await drainPendingUnderLease(db, lease);
      processedObjects += drained.processedObjects;
      recalculatedBuckets += drained.recalculatedBuckets;
      const completion = await finishIncrementalLease(db, lease);
      if (!completion.complete) continue;
      return {
        busy: false,
        processedObjects,
        recalculatedBuckets,
        ready: completion.ready,
      };
    }
  } catch (error) {
    await failDensityLease(db, lease, error);
    throw error;
  }
}

async function discoverObjectDensityBounds(
  db: Db,
): Promise<{ start: Date; end: Date } | null> {
  const collection = db.collection<TimelineObjectLike>("objects");
  const [first, last] = await Promise.all([
    collection.findOne(
      { "timeRanges.start": { $type: "date" } },
      {
        projection: { timeRanges: 1 },
        sort: { "timeRanges.start": 1 },
        hint: TIMELINE_OBJECT_RANGE_INDEX,
        maxTimeMS: OBJECT_DENSITY_REBUILD_MAX_TIME_MS,
      },
    ),
    collection.findOne(
      { "timeRanges.start": { $type: "date" } },
      {
        projection: { timeRanges: 1 },
        sort: { "timeRanges.start": -1 },
        hint: TIMELINE_OBJECT_RANGE_INDEX,
        maxTimeMS: OBJECT_DENSITY_REBUILD_MAX_TIME_MS,
      },
    ),
  ]);
  const firstStarts = first ? extractObjectDensityStarts(first) : [];
  const lastStarts = last ? extractObjectDensityStarts(last) : [];
  if (firstStarts.length === 0 || lastStarts.length === 0) return null;
  const min = new Date(Math.min(...firstStarts.map((date) => date.getTime())));
  const max = new Date(Math.max(...lastStarts.map((date) => date.getTime())));
  return {
    start: objectDensityBucketStart(min, "1hour"),
    end: objectDensityBucketEnd(max, "1hour"),
  };
}

async function writeSources(
  db: Db,
  objects: TimelineObjectLike[],
  generation: string,
  seen: Set<string>,
): Promise<void> {
  const operations: never[] = [];
  const candidateSources: ObjectDensitySource[] = [];
  for (const object of objects) {
    const source = sourceFromObject(object, generation);
    if (!source) continue;
    const key = String(source._id);
    if (seen.has(key)) continue;
    seen.add(key);
    candidateSources.push(source);
  }
  const pendingRows = candidateSources.length === 0
    ? []
    : await db.collection<ObjectDensityPending>(
      OBJECT_TIMELINE_DENSITY_PENDING_COLLECTION,
    ).find(
      { _id: { $in: candidateSources.map((source) => source._id) } } as never,
      {
        projection: { _id: 1, oldSource: 1 },
        maxTimeMS: OBJECT_DENSITY_INCREMENTAL_MAX_TIME_MS,
      },
    ).toArray();
  const pendingIds = new Set(pendingRows.map((item) => String(item._id)));
  const pendingSourceSeeds = candidateSources.filter((source) =>
    pendingIds.has(String(source._id))
  ).map((source) => ({
    updateOne: {
      filter: {
        _id: source._id,
        $or: [
          { oldSource: null },
          { oldSource: { $exists: false } },
        ],
      },
      update: { $set: { oldSource: source } },
    },
  }));
  if (pendingSourceSeeds.length > 0) {
    await db.collection(OBJECT_TIMELINE_DENSITY_PENDING_COLLECTION).bulkWrite(
      pendingSourceSeeds as never[],
      { ordered: false },
    );
  }
  for (const source of candidateSources) {
    if (pendingIds.has(String(source._id))) continue;
    operations.push({
      replaceOne: {
        filter: { _id: source._id },
        replacement: source,
        upsert: true,
      },
    } as never);
    if (operations.length >= OBJECT_DENSITY_SOURCE_BATCH_SIZE) {
      await db.collection(OBJECT_TIMELINE_DENSITY_SOURCE_COLLECTION).bulkWrite(
        operations.splice(0),
        { ordered: false },
      );
    }
  }
  if (operations.length > 0) {
    await db.collection(OBJECT_TIMELINE_DENSITY_SOURCE_COLLECTION).bulkWrite(
      operations,
      { ordered: false },
    );
  }
}

async function rebuildHourWindow(
  db: Db,
  start: Date,
  end: Date,
  generation: string,
  seenSources: Set<string>,
  onMaterialized?: ObjectDensityRebuildOptions["onHourBucketsMaterialized"],
): Promise<void> {
  const objects = await loadDensityObjects(
    db,
    start,
    end,
    OBJECT_DENSITY_REBUILD_MAX_TIME_MS,
  );
  await replaceDensityBuckets(
    db,
    "1hour",
    start,
    end,
    computeObjectDensityBuckets(objects, start, end, "1hour"),
  );
  await onMaterialized?.({ start, end });
  await writeSources(db, objects, generation, seenSources);
}

async function rebuildHourWindowWithSplit(
  db: Db,
  start: Date,
  end: Date,
  generation: string,
  seenSources: Set<string>,
  onMaterialized?: ObjectDensityRebuildOptions["onHourBucketsMaterialized"],
): Promise<void> {
  try {
    await rebuildHourWindow(
      db,
      start,
      end,
      generation,
      seenSources,
      onMaterialized,
    );
  } catch (error) {
    const duration = end.getTime() - start.getTime();
    if (
      !isMaxTimeExpired(error) ||
      duration <= OBJECT_DENSITY_RESOLUTION_MS["1hour"]
    ) {
      throw error;
    }
    const midpoint = objectDensityBucketStart(
      start.getTime() + Math.ceil(duration / 2),
      "1hour",
    );
    await rebuildHourWindowWithSplit(
      db,
      start,
      midpoint,
      generation,
      seenSources,
      onMaterialized,
    );
    await rebuildHourWindowWithSplit(
      db,
      midpoint,
      end,
      generation,
      seenSources,
      onMaterialized,
    );
  }
}

async function rollUpObjectDensity(
  db: Db,
  resolution: "1day" | "1week",
): Promise<void> {
  const accumulated = new Map<number, ObjectDensityBucket>();
  const cursor = db.collection<ObjectDensityBucket>(
    OBJECT_TIMELINE_DENSITY_COLLECTION,
  ).find(
    { resolution: "1hour" },
    {
      sort: { start: 1 },
      projection: { _id: 0 },
      maxTimeMS: OBJECT_DENSITY_REBUILD_MAX_TIME_MS,
    },
  );
  for await (const hour of cursor) {
    const start = objectDensityBucketStart(hour.start, resolution);
    const timestamp = start.getTime();
    const bucket = accumulated.get(timestamp) ?? {
      resolution,
      start,
      total: 0,
      byCategory: {},
      stale: false,
      calculatedAt: hour.calculatedAt,
    };
    bucket.total += hour.total;
    bucket.stale ||= hour.stale;
    if (hour.calculatedAt > bucket.calculatedAt) {
      bucket.calculatedAt = hour.calculatedAt;
    }
    for (const [category, count] of Object.entries(hour.byCategory)) {
      const typedCategory = category as TimelineObjectCategory;
      bucket.byCategory[typedCategory] =
        (bucket.byCategory[typedCategory] ?? 0) + Number(count ?? 0);
    }
    accumulated.set(timestamp, bucket);
  }
  const collection = db.collection(OBJECT_TIMELINE_DENSITY_COLLECTION);
  await collection.deleteMany(
    { resolution },
    { maxTimeMS: OBJECT_DENSITY_REBUILD_MAX_TIME_MS },
  );
  const buckets = [...accumulated.values()];
  for (let offset = 0; offset < buckets.length; offset += 1_000) {
    await collection.bulkWrite(
      buckets.slice(offset, offset + 1_000).map((bucket) => ({
        updateOne: {
          filter: { resolution, start: bucket.start },
          update: { $set: bucket },
          upsert: true,
        },
      })),
      { ordered: false },
    );
  }
}

async function completeFullRebuild(
  db: Db,
  lease: DensityLease,
  baselineSequence: number,
  sourceObjects: number,
): Promise<boolean> {
  const stateCollection = db.collection<ObjectDensityState>(
    OBJECT_TIMELINE_DENSITY_STATE_COLLECTION,
  );
  await stateCollection.updateOne(
    leaseFilter(lease),
    {
      $pull: { pendingWrites: { sequence: { $lte: baselineSequence } } },
      $set: { hasFullRebuild: true, sourceObjects },
    } as never,
  );

  while (true) {
    await drainPendingUnderLease(db, lease);
    const state = await stateCollection.findOne(leaseFilter(lease));
    if (!state) {
      throw new ObjectDensityLeaseConflictError(
        "Object density rebuild lease was lost before completion",
      );
    }
    const remaining = await db.collection(
      OBJECT_TIMELINE_DENSITY_PENDING_COLLECTION,
    ).findOne({}, { projection: { _id: 1 }, maxTimeMS: 1_000 });
    if (remaining) continue;
    if ((state.pendingWrites?.length ?? 0) > 0) {
      const oldestQueuedAt = Math.min(
        ...state.pendingWrites!.map((write) =>
          new Date(write.queuedAt).getTime()
        ),
      );
      if (oldestQueuedAt > Date.now() - OBJECT_DENSITY_PENDING_WRITE_GRACE_MS) {
        await new Promise((resolve) => setTimeout(resolve, 25));
        continue;
      }
      await stateCollection.updateOne(
        leaseFilter(lease),
        {
          $set: {
            ready: false,
            building: false,
            dirty: true,
            repairStatus: "rebuild-required",
            error:
              "An object changed during rebuild without a durable queue record",
          },
          $unset: { lease: "" },
        },
      );
      return false;
    }
    const sequence = Number(state.changeSequence ?? 0);
    const completedAt = new Date();
    const result = await stateCollection.updateOne(
      {
        ...leaseFilter(lease),
        changeSequence: sequence,
        pendingWrites: { $size: 0 },
      },
      {
        $set: {
          ready: true,
          building: false,
          dirty: false,
          repairStatus: "ready",
          processedSequence: sequence,
          calculatedAt: completedAt,
          completedAt,
          sourceObjects,
        },
        $unset: { lease: "", error: "", failedAt: "" },
      },
    );
    if (result.modifiedCount === 1) return true;
  }
}

/** Controlled full-source rebuild. It never accepts a partial fake scope. */
export async function rebuildObjectTimelineDensity(
  db: Db,
  options: ObjectDensityRebuildOptions = {},
): Promise<{
  ready: boolean;
  start?: Date;
  end?: Date;
  sourceObjects: number;
}> {
  const lease = await acquireObjectDensityLease(db, "rebuild", {
    owner: options.leaseOwner,
    leaseMs: options.leaseMs,
  });
  if (!lease) {
    throw new ObjectDensityLeaseConflictError(
      "An object density repair is already running",
    );
  }
  const baselineSequence = Number(lease.state.changeSequence ?? 0);
  const generation = lease.generation;
  const seenSources = new Set<string>();
  try {
    const bounds = await discoverObjectDensityBounds(db);
    await db.collection(OBJECT_TIMELINE_DENSITY_COLLECTION).deleteMany(
      {},
      { maxTimeMS: OBJECT_DENSITY_REBUILD_MAX_TIME_MS },
    );
    if (!bounds) {
      await db.collection(OBJECT_TIMELINE_DENSITY_SOURCE_COLLECTION).deleteMany(
        {},
        { maxTimeMS: OBJECT_DENSITY_REBUILD_MAX_TIME_MS },
      );
      const ready = await completeFullRebuild(
        db,
        lease,
        baselineSequence,
        0,
      );
      return { ready, sourceObjects: 0 };
    }

    const requestedWindowMs = Math.max(
      OBJECT_DENSITY_RESOLUTION_MS["1hour"],
      options.windowMs ?? OBJECT_DENSITY_WINDOW_MS,
    );
    const windowMs = Math.max(
      OBJECT_DENSITY_RESOLUTION_MS["1hour"],
      Math.floor(
        requestedWindowMs / OBJECT_DENSITY_RESOLUTION_MS["1hour"],
      ) * OBJECT_DENSITY_RESOLUTION_MS["1hour"],
    );
    for (
      let windowStart = bounds.start;
      windowStart.getTime() < bounds.end.getTime();
      windowStart = new Date(
        Math.min(bounds.end.getTime(), windowStart.getTime() + windowMs),
      )
    ) {
      await renewDensityLease(db, lease, options.leaseMs);
      const windowEnd = new Date(
        Math.min(bounds.end.getTime(), windowStart.getTime() + windowMs),
      );
      await rebuildHourWindowWithSplit(
        db,
        windowStart,
        windowEnd,
        generation,
        seenSources,
        options.onHourBucketsMaterialized,
      );
      await options.onProgress?.({
        start: bounds.start,
        end: bounds.end,
        processedThrough: windowEnd,
      });
    }
    await renewDensityLease(db, lease, options.leaseMs);
    await rollUpObjectDensity(db, "1day");
    await renewDensityLease(db, lease, options.leaseMs);
    await rollUpObjectDensity(db, "1week");
    await db.collection(OBJECT_TIMELINE_DENSITY_SOURCE_COLLECTION).deleteMany(
      { generation: { $ne: generation } },
      { maxTimeMS: OBJECT_DENSITY_REBUILD_MAX_TIME_MS },
    );
    const ready = await completeFullRebuild(
      db,
      lease,
      baselineSequence,
      seenSources.size,
    );
    return {
      ready,
      start: bounds.start,
      end: bounds.end,
      sourceObjects: seenSources.size,
    };
  } catch (error) {
    await failDensityLease(db, lease, error);
    throw error;
  }
}

let scheduledDrain: Promise<void> | null = null;
let scheduledDrainTimer: ReturnType<typeof setTimeout> | null = null;
let drainRequestedWhileActive = false;

function scheduleObjectDensityDrain(db?: Db, delayMs = 0): void {
  if (scheduledDrain || scheduledDrainTimer) {
    drainRequestedWhileActive = true;
    return;
  }
  scheduledDrainTimer = setTimeout(() => {
    scheduledDrainTimer = null;
    let retryDelayMs: number | null = null;
    scheduledDrain = (async () => {
      const database = db ?? await getRootDB();
      const result = await drainObjectDensityPending(database);
      if (result.busy && result.retryAt) {
        retryDelayMs = Math.max(
          50,
          result.retryAt.getTime() - Date.now() + 50,
        );
      }
    })().catch((error) => {
      console.error("[ObjectDensity] Durable pending drain failed:", error);
      retryDelayMs = OBJECT_DENSITY_RETRY_MS;
    }).finally(() => {
      scheduledDrain = null;
      const requested = drainRequestedWhileActive;
      drainRequestedWhileActive = false;
      if (retryDelayMs != null || requested) {
        scheduleObjectDensityDrain(db, retryDelayMs ?? 0);
      }
    });
  }, Math.max(0, delayMs));
}

export async function enqueueObjectDensityChange(
  change: ObjectDensityChange,
  db?: Db,
): Promise<void> {
  const database = db ?? await getRootDB();
  await persistObjectDensityChange(database, change);
  scheduleObjectDensityDrain(database);
}

export async function recoverObjectDensityPending(
  db?: Db,
  options: { drainNow?: boolean } = {},
): Promise<ObjectDensityDrainResult | void> {
  const database = db ?? await getRootDB();
  await ensureDensityState(database);
  const [state, pending] = await Promise.all([
    database.collection<ObjectDensityState>(
      OBJECT_TIMELINE_DENSITY_STATE_COLLECTION,
    ).findOne({ _id: "current" }),
    database.collection(OBJECT_TIMELINE_DENSITY_PENDING_COLLECTION).findOne(
      {},
      { projection: { _id: 1 }, maxTimeMS: 1_000 },
    ),
  ]);
  if (pending) {
    if (options.drainNow) {
      return await drainObjectDensityPending(database);
    }
    scheduleObjectDensityDrain(database);
    return;
  }
  if (state?.dirty && (state.pendingWrites?.length ?? 0) > 0) {
    await database.collection<ObjectDensityState>(
      OBJECT_TIMELINE_DENSITY_STATE_COLLECTION,
    ).updateOne(
      { _id: "current" },
      {
        $set: {
          ready: false,
          repairStatus: "rebuild-required",
          error: "Durable density queue has an acknowledgement gap",
        },
      },
    );
  }
}
