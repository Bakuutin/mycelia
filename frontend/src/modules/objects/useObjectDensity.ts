import { useEffect } from "react";
import { create } from "zustand";
import { callResource } from "@/lib/api";
import { shouldLoadTimelineObjectDetail } from "@/lib/timelineDetail";
import { useTimelineQueryRange } from "@/hooks/useTimelineQueryRange";
import { useTimelineRange } from "@/stores/timelineRange";
import { useTrackVisibilityStore } from "@/stores/trackVisibilityStore";
import type { ObjectCategory } from "@/types/tracks";
import { useWebSocketSubscription } from "@/hooks/useWebSocket";

export const OBJECT_DENSITY_RESOLUTION_MS = {
  "1hour": 60 * 60 * 1_000,
  "1day": 24 * 60 * 60 * 1_000,
  "1week": 7 * 24 * 60 * 60 * 1_000,
} as const;

export type ObjectDensityResolution = keyof typeof OBJECT_DENSITY_RESOLUTION_MS;

export type ObjectDensityBucket = {
  resolution: ObjectDensityResolution;
  start: Date;
  total: number;
  byCategory: Partial<Record<ObjectCategory, number>>;
  stale: boolean;
  calculatedAt: Date;
};

type ObjectDensityResponse = {
  ready: boolean;
  building: boolean;
  resolution: ObjectDensityResolution;
  start: Date;
  end: Date;
  buckets: ObjectDensityBucket[];
  calculatedAt?: Date;
};

type DensityState = ObjectDensityResponse & {
  loading: boolean;
  error: string | null;
  currentKey: string | null;
  fetchForRange: (
    start: Date,
    end: Date,
    resolution: ObjectDensityResolution,
    categories: ObjectCategory[],
    options?: { bypassCache?: boolean },
  ) => Promise<void>;
  defer: () => void;
};

const EMPTY_RESPONSE: ObjectDensityResponse = {
  ready: false,
  building: false,
  resolution: "1hour",
  start: new Date(0),
  end: new Date(0),
  buckets: [],
};

const responseCache = new Map<
  string,
  { response: ObjectDensityResponse; cachedAt: number }
>();
const MAX_CACHE_ENTRIES = 48;
const CACHE_TTL_MS = 60_000;
export const OBJECT_DENSITY_POLL_BACKOFF_MS = [
  2_000,
  5_000,
  10_000,
  30_000,
] as const;
let activeController: AbortController | null = null;
let requestGeneration = 0;
let invalidationTimer: ReturnType<typeof setTimeout> | null = null;

function requestKey(
  start: Date,
  end: Date,
  resolution: ObjectDensityResolution,
  categories: ObjectCategory[],
): string {
  return `${resolution}:${start.getTime()}:${end.getTime()}:${
    [...categories].sort().join(",")
  }`;
}

function normalizeResponse(
  response: ObjectDensityResponse,
): ObjectDensityResponse {
  return {
    ...response,
    start: new Date(response.start),
    end: new Date(response.end),
    calculatedAt: response.calculatedAt
      ? new Date(response.calculatedAt)
      : undefined,
    buckets: (response.buckets ?? []).map((bucket) => ({
      ...bucket,
      start: new Date(bucket.start),
      calculatedAt: new Date(bucket.calculatedAt),
    })),
  };
}

function rememberResponse(key: string, response: ObjectDensityResponse): void {
  responseCache.delete(key);
  responseCache.set(key, { response, cachedAt: Date.now() });
  while (responseCache.size > MAX_CACHE_ENTRIES) {
    const oldest = responseCache.keys().next().value;
    if (typeof oldest !== "string") break;
    responseCache.delete(oldest);
  }
}

function scheduleDensityInvalidation(refresh: () => void): void {
  if (invalidationTimer) clearTimeout(invalidationTimer);
  invalidationTimer = setTimeout(() => {
    invalidationTimer = null;
    responseCache.clear();
    requestGeneration++;
    activeController?.abort();
    activeController = null;
    useObjectDensityStore.setState({ loading: false, currentKey: null });
    refresh();
  }, 750);
}

export function selectObjectDensityResolution(
  rangeMs: number,
  maxBuckets = 2_000,
): ObjectDensityResolution {
  for (const resolution of ["1hour", "1day", "1week"] as const) {
    if (
      Math.ceil(
            Math.max(0, rangeMs) / OBJECT_DENSITY_RESOLUTION_MS[resolution],
          ) +
          4 <=
        maxBuckets
    ) {
      return resolution;
    }
  }
  return "1week";
}

export const useObjectDensityStore = create<DensityState>((set, get) => ({
  ...EMPTY_RESPONSE,
  loading: false,
  error: null,
  currentKey: null,
  defer: () => {
    requestGeneration++;
    activeController?.abort();
    activeController = null;
    set({
      ...EMPTY_RESPONSE,
      loading: false,
      error: null,
      currentKey: null,
    });
  },
  fetchForRange: async (start, end, resolution, categories, options) => {
    const key = requestKey(start, end, resolution, categories);
    const current = get();
    if (current.loading && current.currentKey === key) return;

    const generation = ++requestGeneration;
    const cached = responseCache.get(key);
    if (
      !options?.bypassCache && cached &&
      Date.now() - cached.cachedAt <= CACHE_TTL_MS
    ) {
      activeController?.abort();
      activeController = null;
      set({
        ...cached.response,
        loading: false,
        error: null,
        currentKey: key,
      });
      return;
    }
    if (cached) responseCache.delete(key);

    activeController?.abort();
    const controller = new AbortController();
    activeController = controller;
    set({ loading: true, error: null, currentKey: key });
    try {
      const raw = await callResource("objects", {
        action: "getDensity",
        start,
        end,
        resolution,
        categories,
      }, { signal: controller.signal }) as ObjectDensityResponse;
      if (generation !== requestGeneration) return;
      const response = normalizeResponse(raw);
      rememberResponse(key, response);
      set({ ...response, loading: false, error: null, currentKey: key });
    } catch (error) {
      if (generation !== requestGeneration || controller.signal.aborted) return;
      set({
        loading: false,
        error: error instanceof Error
          ? error.message
          : "Object density unavailable",
      });
    } finally {
      if (activeController === controller) activeController = null;
    }
  },
}));

export function useObjectDensity(
  { width = 1_024, enabled = true }: { width?: number; enabled?: boolean } = {},
) {
  const state = useObjectDensityStore();
  const fetchForRange = useObjectDensityStore((value) => value.fetchForRange);
  const defer = useObjectDensityStore((value) => value.defer);
  const { start, end } = useTimelineRange();
  const visibleCategories = useTrackVisibilityStore((value) =>
    value.visibleObjectCategories
  );
  const rangeMs = Math.max(0, end.getTime() - start.getTime());
  const detailDeferred = !shouldLoadTimelineObjectDetail(rangeMs, width);
  const resolution = selectObjectDensityResolution(rangeMs);
  const alignmentMs = OBJECT_DENSITY_RESOLUTION_MS[resolution];
  const queryRange = useTimelineQueryRange(start, end, alignmentMs, 250);
  const queryReady = queryRange.alignmentMs === alignmentMs &&
    queryRange.start.getTime() <= start.getTime() &&
    queryRange.end.getTime() >= end.getTime();
  const categoriesKey = [...visibleCategories].sort().join(",");
  const visibleRequestKey = queryReady
    ? requestKey(
      queryRange.start,
      queryRange.end,
      resolution,
      visibleCategories,
    )
    : null;

  useEffect(() => () => defer(), [defer]);

  useEffect(() => {
    if (!enabled || !detailDeferred) {
      defer();
      return;
    }
    if (visibleCategories.length === 0) {
      defer();
      return;
    }
    if (!queryReady) return;
    void fetchForRange(
      queryRange.start,
      queryRange.end,
      resolution,
      visibleCategories,
    );
  }, [
    categoriesKey,
    defer,
    detailDeferred,
    enabled,
    fetchForRange,
    queryRange.end,
    queryRange.start,
    queryReady,
    resolution,
    visibleCategories,
  ]);

  const densityNeedsPolling = enabled && detailDeferred && queryReady &&
    visibleCategories.length > 0 && state.currentKey === visibleRequestKey &&
    !state.ready;

  useEffect(() => {
    if (!densityNeedsPolling || visibleRequestKey == null) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;

    const scheduleNext = () => {
      if (cancelled) return;
      const delay = OBJECT_DENSITY_POLL_BACKOFF_MS[
        Math.min(attempt, OBJECT_DENSITY_POLL_BACKOFF_MS.length - 1)
      ];
      attempt++;
      timer = globalThis.setTimeout(async () => {
        timer = null;
        if (cancelled) return;

        await fetchForRange(
          queryRange.start,
          queryRange.end,
          resolution,
          visibleCategories,
          { bypassCache: true },
        );
        if (cancelled) return;

        const latest = useObjectDensityStore.getState();
        if (latest.currentKey === visibleRequestKey && !latest.ready) {
          scheduleNext();
        }
      }, delay);
    };

    scheduleNext();
    return () => {
      cancelled = true;
      if (timer) globalThis.clearTimeout(timer);
    };
  }, [
    categoriesKey,
    densityNeedsPolling,
    fetchForRange,
    queryRange.end,
    queryRange.start,
    resolution,
    visibleCategories,
    visibleRequestKey,
  ]);

  const refreshVisibleDensity = () => {
    if (!enabled || !detailDeferred || !queryReady) return;
    void fetchForRange(
      queryRange.start,
      queryRange.end,
      resolution,
      visibleCategories,
    );
  };

  useWebSocketSubscription(
    "mongo:object_timeline_density",
    (message) => {
      if (message.event !== "mongo.change") return;
      // Initial rebuild can write thousands of buckets. Its state event is the
      // useful refresh boundary; incremental writes refresh after this debounce.
      if (useObjectDensityStore.getState().building) return;
      scheduleDensityInvalidation(refreshVisibleDensity);
    },
    enabled && detailDeferred,
  );
  useWebSocketSubscription(
    "mongo:object_timeline_density_state",
    (message) => {
      if (message.event !== "mongo.change") return;
      scheduleDensityInvalidation(refreshVisibleDensity);
    },
    enabled && detailDeferred,
  );

  return { ...state, detailDeferred };
}

export function resetObjectDensityForTests(): void {
  requestGeneration++;
  activeController?.abort();
  activeController = null;
  if (invalidationTimer) clearTimeout(invalidationTimer);
  invalidationTimer = null;
  responseCache.clear();
  useObjectDensityStore.setState({
    ...EMPTY_RESPONSE,
    loading: false,
    error: null,
    currentKey: null,
  });
}
