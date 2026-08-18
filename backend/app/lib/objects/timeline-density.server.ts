import type { Db } from "mongodb";
import { getRootDB } from "@/lib/mongo/core.server.ts";
import {
  filterObjectDensityBucket,
  isObjectDensityResolution,
  isTimelineObjectCategory,
  OBJECT_DENSITY_RESOLUTION_MS,
  OBJECT_TIMELINE_DENSITY_COLLECTION,
  OBJECT_TIMELINE_DENSITY_INDEX,
  OBJECT_TIMELINE_DENSITY_STATE_COLLECTION,
  type ObjectDensityBucket,
  objectDensityBucketStart,
  type ObjectDensityResolution,
  selectObjectDensityResolution,
  type TimelineObjectCategory,
} from "./timeline-density.ts";

export const OBJECT_DENSITY_QUERY_MAX_TIME_MS = 1_000;
export const OBJECT_DENSITY_MAX_BUCKETS = 2_000;

export type ObjectDensityQueryInput = {
  start: Date | string;
  end: Date | string;
  resolution?: ObjectDensityResolution;
  categories?: TimelineObjectCategory[];
};

export type ObjectDensityQueryResult = {
  ready: boolean;
  building: boolean;
  dirty: boolean;
  repairStatus: string;
  resolution: ObjectDensityResolution;
  start: Date;
  end: Date;
  buckets: ObjectDensityBucket[];
  calculatedAt?: Date;
  error?: string;
};

type ObjectDensityState = {
  _id: string;
  ready?: boolean;
  building?: boolean;
  dirty?: boolean;
  repairStatus?: string;
  calculatedAt?: Date;
  error?: string;
};

export class ObjectDensityInputError extends Error {
  code = 400;
}

function parseDate(value: Date | string, field: string): Date {
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new ObjectDensityInputError(`Invalid object density ${field}`);
  }
  return parsed;
}

export function resolveObjectDensityQuery(
  input: ObjectDensityQueryInput,
): {
  start: Date;
  end: Date;
  resolution: ObjectDensityResolution;
  categories?: TimelineObjectCategory[];
} {
  const requestedStart = parseDate(input.start, "start");
  const requestedEnd = parseDate(input.end, "end");
  if (requestedEnd.getTime() <= requestedStart.getTime()) {
    throw new ObjectDensityInputError(
      "Object density end must be after start",
    );
  }
  if (
    input.resolution != null &&
    !isObjectDensityResolution(input.resolution)
  ) {
    throw new ObjectDensityInputError("Invalid object density resolution");
  }

  const resolution = selectObjectDensityResolution(
    requestedStart,
    requestedEnd,
    input.resolution,
    OBJECT_DENSITY_MAX_BUCKETS,
  );
  const bucketMs = OBJECT_DENSITY_RESOLUTION_MS[resolution];
  const start = objectDensityBucketStart(requestedStart, resolution);
  const end = new Date(
    Math.ceil(requestedEnd.getTime() / bucketMs) * bucketMs,
  );
  if (
    (end.getTime() - start.getTime()) / bucketMs > OBJECT_DENSITY_MAX_BUCKETS
  ) {
    throw new ObjectDensityInputError(
      "Object density range exceeds the maximum bucket count",
    );
  }

  const categories = input.categories == null
    ? undefined
    : [...new Set(input.categories.filter(isTimelineObjectCategory))];
  if (
    input.categories != null && categories?.length !== input.categories.length
  ) {
    throw new ObjectDensityInputError("Invalid object density category");
  }

  return { start, end, resolution, categories };
}

export async function getObjectTimelineDensity(
  input: ObjectDensityQueryInput,
  db?: Db,
): Promise<ObjectDensityQueryResult> {
  const resolved = resolveObjectDensityQuery(input);
  const database = db ?? await getRootDB();
  const [state, rows] = await Promise.all([
    database.collection<ObjectDensityState>(
      OBJECT_TIMELINE_DENSITY_STATE_COLLECTION,
    ).findOne(
      { _id: "current" },
      { maxTimeMS: OBJECT_DENSITY_QUERY_MAX_TIME_MS },
    ),
    database.collection<ObjectDensityBucket>(
      OBJECT_TIMELINE_DENSITY_COLLECTION,
    ).find(
      {
        resolution: resolved.resolution,
        start: { $gte: resolved.start, $lt: resolved.end },
      },
      {
        hint: OBJECT_TIMELINE_DENSITY_INDEX,
        maxTimeMS: OBJECT_DENSITY_QUERY_MAX_TIME_MS,
        sort: { start: 1 },
        limit: OBJECT_DENSITY_MAX_BUCKETS,
      },
    ).toArray(),
  ]);

  let buckets = resolved.categories
    ? rows.map((row) => filterObjectDensityBucket(row, resolved.categories!))
    : rows;
  if (state?.dirty === true) {
    buckets = buckets.map((bucket) => ({ ...bucket, stale: true }));
  }

  return {
    ready: state?.ready === true,
    building: state?.building === true,
    dirty: state?.dirty === true,
    repairStatus: state?.repairStatus ?? "not-built",
    resolution: resolved.resolution,
    start: resolved.start,
    end: resolved.end,
    buckets,
    calculatedAt: state?.calculatedAt,
    error: state?.error,
  };
}
