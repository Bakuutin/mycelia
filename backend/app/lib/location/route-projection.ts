export type RoutePoint = {
  index: number;
  coordinates: [number, number];
  ts?: Date;
  sourceFragmentIndex?: number;
  sourcePointIndex?: number;
};

export type RouteBreakReason =
  | "source_boundary"
  | "non_increasing_time"
  | "silence"
  | "teleport"
  | "sparse_jump";

export type RouteBreak = {
  breakIndex: number;
  reason: RouteBreakReason;
  distanceM: number;
  durationMs?: number;
  from: RoutePoint;
  to: RoutePoint;
};

export type RouteFragment = {
  fragmentIndex: number;
  points: RoutePoint[];
};

export type RouteProjection = {
  fragments: RouteFragment[];
  breaks: RouteBreak[];
};

const EARTH_RADIUS_M = 6_371_000;
const HARD_GAP_MS = 30 * 60 * 1_000;
const HARD_TELEPORT_M = 500_000;
const FIXED_SPARSE_TIME_MS = 120_000;
const FIXED_SPARSE_DISTANCE_M = 500;
const LOCAL_WINDOW = 8;

export function routeDistanceM(a: RoutePoint, b: RoutePoint): number {
  const [aLng, aLat] = a.coordinates;
  const [bLng, bLat] = b.coordinates;
  const dLat = (bLat - aLat) * Math.PI / 180;
  const dLng = (bLng - aLng) * Math.PI / 180;
  const value = Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * Math.PI / 180) * Math.cos(bLat * Math.PI / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(value));
}

function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function localEdgeMedians(
  points: RoutePoint[],
  edgeIndex: number,
): { durationMs?: number; distanceM?: number } {
  const durations: number[] = [];
  const distances: number[] = [];
  const from = Math.max(1, edgeIndex - LOCAL_WINDOW);
  const to = Math.min(points.length - 1, edgeIndex + LOCAL_WINDOW);
  for (let index = from; index <= to; index++) {
    if (index === edgeIndex) continue;
    const previous = points[index - 1];
    const current = points[index];
    const duration = previous.ts && current.ts
      ? current.ts.getTime() - previous.ts.getTime()
      : undefined;
    if (duration !== undefined && duration > 0) durations.push(duration);
    const distance = routeDistanceM(previous, current);
    if (distance > 0) distances.push(distance);
  }
  return { durationMs: median(durations), distanceM: median(distances) };
}

export function classifyRouteBreak(
  points: RoutePoint[],
  edgeIndex: number,
): Omit<RouteBreak, "breakIndex" | "from" | "to"> | null {
  const from = points[edgeIndex - 1];
  const to = points[edgeIndex];
  if (!from || !to) return null;
  const distanceM = routeDistanceM(from, to);
  const durationMs = from.ts && to.ts
    ? to.ts.getTime() - from.ts.getTime()
    : undefined;
  if (
    from.sourceFragmentIndex !== undefined &&
    to.sourceFragmentIndex !== undefined &&
    from.sourceFragmentIndex !== to.sourceFragmentIndex
  ) {
    return {
      reason: "source_boundary",
      distanceM,
      ...(durationMs !== undefined ? { durationMs } : {}),
    };
  }
  if (durationMs !== undefined && durationMs <= 0 && distanceM > 1) {
    return { reason: "non_increasing_time", distanceM, durationMs };
  }
  if (distanceM > HARD_TELEPORT_M) {
    return {
      reason: "teleport",
      distanceM,
      ...(durationMs !== undefined ? { durationMs } : {}),
    };
  }
  if (durationMs !== undefined && durationMs > HARD_GAP_MS) {
    return { reason: "silence", distanceM, durationMs };
  }
  if (durationMs !== undefined && durationMs > 0) {
    const local = localEdgeMedians(points, edgeIndex);
    const timeThreshold = Math.max(
      FIXED_SPARSE_TIME_MS,
      8 * (local.durationMs ?? 0),
    );
    const distanceThreshold = Math.max(
      FIXED_SPARSE_DISTANCE_M,
      8 * (local.distanceM ?? 0),
    );
    if (durationMs > timeThreshold && distanceM > distanceThreshold) {
      return { reason: "sparse_jump", distanceM, durationMs };
    }
  }
  return null;
}

export function projectRoute(points: RoutePoint[]): RouteProjection {
  if (points.length === 0) return { fragments: [], breaks: [] };
  const fragments: RouteFragment[] = [];
  const breaks: RouteBreak[] = [];
  let current: RoutePoint[] = [points[0]];
  for (let index = 1; index < points.length; index++) {
    const classified = classifyRouteBreak(points, index);
    if (classified) {
      fragments.push({ fragmentIndex: fragments.length, points: current });
      breaks.push({
        breakIndex: breaks.length,
        ...classified,
        from: points[index - 1],
        to: points[index],
      });
      current = [points[index]];
    } else {
      current.push(points[index]);
    }
  }
  fragments.push({ fragmentIndex: fragments.length, points: current });
  return { fragments, breaks };
}

function lowerBoundPoint(points: RoutePoint[], time: number): number {
  let low = 0;
  let high = points.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    const value = points[mid].ts?.getTime() ?? Number.POSITIVE_INFINITY;
    if (value < time) low = mid + 1;
    else high = mid;
  }
  return low;
}

function nearestTimedPoint(
  points: RoutePoint[],
  time: number,
): RoutePoint | null {
  const index = lowerBoundPoint(points, time);
  let selected: RoutePoint | null = null;
  for (const candidateIndex of [index - 1, index]) {
    const point = points[candidateIndex];
    if (!point?.ts) continue;
    if (
      !selected ||
      Math.abs(point.ts.getTime() - time) <
        Math.abs(selected.ts!.getTime() - time)
    ) {
      selected = point;
    }
  }
  return selected;
}

export function detectRouteSeriesConflict(
  left: RoutePoint[],
  right: RoutePoint[],
): { overlapStart: Date; overlapEnd: Date; medianSeparationM: number } | null {
  const leftTimed = left.filter((point) => point.ts).sort((a, b) =>
    a.ts!.getTime() - b.ts!.getTime()
  );
  const rightTimed = right.filter((point) => point.ts).sort((a, b) =>
    a.ts!.getTime() - b.ts!.getTime()
  );
  if (leftTimed.length < 3 || rightTimed.length < 3) return null;
  const overlapStartMs = Math.max(
    leftTimed[0].ts!.getTime(),
    rightTimed[0].ts!.getTime(),
  );
  const overlapEndMs = Math.min(
    leftTimed.at(-1)!.ts!.getTime(),
    rightTimed.at(-1)!.ts!.getTime(),
  );
  if (overlapEndMs - overlapStartMs < 5 * 60 * 1_000) return null;
  const samples = leftTimed.filter((point) => {
    const time = point.ts!.getTime();
    return time >= overlapStartMs && time <= overlapEndMs;
  });
  if (samples.length < 3) return null;
  const stride = Math.max(1, Math.floor(samples.length / 101));
  const separations: number[] = [];
  for (let index = 0; index < samples.length; index += stride) {
    const point = samples[index];
    const other = nearestTimedPoint(rightTimed, point.ts!.getTime());
    if (other) separations.push(routeDistanceM(point, other));
  }
  const medianSeparationM = median(separations);
  if (medianSeparationM === undefined || medianSeparationM <= 20_000) {
    return null;
  }
  return {
    overlapStart: new Date(overlapStartMs),
    overlapEnd: new Date(overlapEndMs),
    medianSeparationM,
  };
}
