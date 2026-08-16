const HOUR_MS = 60 * 60 * 1_000;
const DAY_MS = 24 * HOUR_MS;
const MAX_OBJECT_DETAIL_MS_PER_PIXEL = 10 * 60 * 1_000;

function safeTimelineWidth(width: number): number {
  return Number.isFinite(width) && width > 0 ? width : 1_024;
}

function pixelBudget(
  width: number,
  density: number,
  minimum: number,
  maximum: number,
): number {
  const safeWidth = safeTimelineWidth(width);
  return Math.min(maximum, Math.max(minimum, Math.ceil(safeWidth * density)));
}

export function shouldLoadTimelineObjectDetail(
  rangeMs: number,
  width: number,
): boolean {
  return rangeMs / safeTimelineWidth(width) <= MAX_OBJECT_DETAIL_MS_PER_PIXEL;
}

/**
 * Individual objects stop being useful once several of them occupy each pixel.
 * Keep enough rows for interaction at close zoom while using a representative,
 * bounded sample for wide ranges.
 */
export function timelineObjectLimit(rangeMs: number, width: number): number {
  const density = rangeMs <= 6 * HOUR_MS
    ? 3
    : rangeMs <= DAY_MS
    ? 2
    : rangeMs <= 7 * DAY_MS
    ? 1
    : rangeMs <= 30 * DAY_MS
    ? 0.6
    : 0.3;
  return pixelBudget(width, density, 250, 5_000);
}

/**
 * Speaker intervals are rendered as pixel buckets at far zoom, so downloading
 * thousands of intervals that collapse onto the same pixels only adds load.
 */
export function timelineSpeakerLimit(rangeMs: number, width: number): number {
  const density = rangeMs <= HOUR_MS
    ? 5
    : rangeMs <= 6 * HOUR_MS
    ? 3
    : rangeMs <= DAY_MS
    ? 2
    : rangeMs <= 7 * DAY_MS
    ? 1.25
    : rangeMs <= 30 * DAY_MS
    ? 0.75
    : 0.4;
  return pixelBudget(width, density, 250, 5_000);
}
