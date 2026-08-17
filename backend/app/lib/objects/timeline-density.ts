export const OBJECT_TIMELINE_DENSITY_COLLECTION = "object_timeline_density";
export const OBJECT_TIMELINE_DENSITY_SOURCE_COLLECTION =
  "object_timeline_density_sources";
export const OBJECT_TIMELINE_DENSITY_STATE_COLLECTION =
  "object_timeline_density_state";
export const OBJECT_TIMELINE_DENSITY_PENDING_COLLECTION =
  "object_timeline_density_pending";
export const OBJECT_TIMELINE_DENSITY_INDEX =
  "object_timeline_density_resolution_start";
export const OBJECT_TIMELINE_DENSITY_PENDING_INDEX =
  "object_timeline_density_pending_queued";

export const OBJECT_DENSITY_RESOLUTIONS = [
  "1hour",
  "1day",
  "1week",
] as const;

export type ObjectDensityResolution =
  (typeof OBJECT_DENSITY_RESOLUTIONS)[number];

export const OBJECT_DENSITY_RESOLUTION_MS: Record<
  ObjectDensityResolution,
  number
> = {
  "1hour": 60 * 60 * 1_000,
  "1day": 24 * 60 * 60 * 1_000,
  "1week": 7 * 24 * 60 * 60 * 1_000,
};

export const TIMELINE_OBJECT_CATEGORIES = [
  "person",
  "event",
  "promise",
  "relationship",
  "place",
  "organization",
  "product",
  "project",
  "animal",
  "concept",
  "media",
  "other",
] as const;

export type TimelineObjectCategory =
  (typeof TIMELINE_OBJECT_CATEGORIES)[number];

export type TimelineObjectLike = {
  _id?: unknown;
  timeRanges?: Array<{ start?: Date | string | number | null }>;
  isPerson?: boolean;
  isEvent?: boolean;
  isPromise?: boolean;
  isRelationship?: boolean;
  isPlace?: boolean;
  isOrganization?: boolean;
  isProduct?: boolean;
  isProject?: boolean;
  isAnimal?: boolean;
  isConcept?: boolean;
  isMedia?: boolean;
};

export type ObjectDensityBucket = {
  resolution: ObjectDensityResolution;
  start: Date;
  total: number;
  byCategory: Partial<Record<TimelineObjectCategory, number>>;
  stale: boolean;
  calculatedAt: Date;
};

/**
 * This precedence deliberately mirrors the existing Timeline object track.
 * Density is a projection of that UI category, not the Objects-page section
 * catalogue (which supports multi-membership).
 */
export function getTimelineObjectCategory(
  object: TimelineObjectLike,
): TimelineObjectCategory {
  if (object.isPerson) return "person";
  if (object.isEvent) return "event";
  if (object.isPromise) return "promise";
  if (object.isRelationship) return "relationship";
  if (object.isPlace) return "place";
  if (object.isOrganization) return "organization";
  if (object.isProduct) return "product";
  if (object.isProject) return "project";
  if (object.isAnimal) return "animal";
  if (object.isConcept) return "concept";
  if (object.isMedia) return "media";
  return "other";
}

export function isObjectDensityResolution(
  value: unknown,
): value is ObjectDensityResolution {
  return typeof value === "string" &&
    OBJECT_DENSITY_RESOLUTIONS.includes(value as ObjectDensityResolution);
}

export function isTimelineObjectCategory(
  value: unknown,
): value is TimelineObjectCategory {
  return typeof value === "string" &&
    TIMELINE_OBJECT_CATEGORIES.includes(value as TimelineObjectCategory);
}

export function objectDensityBucketStart(
  value: Date | number,
  resolution: ObjectDensityResolution,
): Date {
  const timestamp = value instanceof Date ? value.getTime() : value;
  const bucketMs = OBJECT_DENSITY_RESOLUTION_MS[resolution];
  return new Date(Math.floor(timestamp / bucketMs) * bucketMs);
}

export function objectDensityBucketEnd(
  value: Date | number,
  resolution: ObjectDensityResolution,
): Date {
  return new Date(
    objectDensityBucketStart(value, resolution).getTime() +
      OBJECT_DENSITY_RESOLUTION_MS[resolution],
  );
}

export function selectObjectDensityResolution(
  start: Date | number,
  end: Date | number,
  requested?: ObjectDensityResolution,
  maxBuckets = 2_000,
): ObjectDensityResolution {
  const startMs = start instanceof Date ? start.getTime() : start;
  const endMs = end instanceof Date ? end.getTime() : end;
  const duration = Math.max(0, endMs - startMs);
  const firstIndex = requested
    ? OBJECT_DENSITY_RESOLUTIONS.indexOf(requested)
    : 0;

  for (
    let index = Math.max(0, firstIndex);
    index < OBJECT_DENSITY_RESOLUTIONS.length;
    index++
  ) {
    const resolution = OBJECT_DENSITY_RESOLUTIONS[index];
    if (
      Math.ceil(duration / OBJECT_DENSITY_RESOLUTION_MS[resolution]) + 2 <=
        maxBuckets
    ) {
      return resolution;
    }
  }

  return "1week";
}

export function extractObjectDensityStarts(object: TimelineObjectLike): Date[] {
  const starts: Date[] = [];
  for (const range of object.timeRanges ?? []) {
    if (range?.start == null) continue;
    const start = range.start instanceof Date
      ? range.start
      : new Date(range.start);
    if (Number.isFinite(start.getTime())) starts.push(start);
  }
  return starts;
}

export function computeObjectDensityBuckets(
  objects: TimelineObjectLike[],
  start: Date,
  end: Date,
  resolution: ObjectDensityResolution,
  calculatedAt = new Date(),
): ObjectDensityBucket[] {
  const buckets = new Map<
    number,
    {
      total: number;
      byCategory: Partial<Record<TimelineObjectCategory, number>>;
    }
  >();

  for (const object of objects) {
    const category = getTimelineObjectCategory(object);
    for (const rangeStart of extractObjectDensityStarts(object)) {
      const time = rangeStart.getTime();
      if (time < start.getTime() || time >= end.getTime()) continue;
      const bucketTime = objectDensityBucketStart(time, resolution).getTime();
      const bucket = buckets.get(bucketTime) ?? { total: 0, byCategory: {} };
      bucket.total++;
      bucket.byCategory[category] = (bucket.byCategory[category] ?? 0) + 1;
      buckets.set(bucketTime, bucket);
    }
  }

  return [...buckets.entries()].sort(([left], [right]) => left - right).map(
    ([bucketTime, counts]) => ({
      resolution,
      start: new Date(bucketTime),
      total: counts.total,
      byCategory: counts.byCategory,
      stale: false,
      calculatedAt,
    }),
  );
}

export function filterObjectDensityBucket(
  bucket: ObjectDensityBucket,
  categories: readonly TimelineObjectCategory[],
): ObjectDensityBucket {
  const byCategory: Partial<Record<TimelineObjectCategory, number>> = {};
  let total = 0;
  for (const category of categories) {
    const count = bucket.byCategory[category] ?? 0;
    if (count > 0) byCategory[category] = count;
    total += count;
  }
  return { ...bucket, total, byCategory };
}
