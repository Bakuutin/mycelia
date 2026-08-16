import { useEffect, useMemo } from "react";
import { create } from "zustand";
import { Object } from "@/types/objects.ts";
import { callResource } from "@/lib/api";
import { useTimelineRange } from "@/stores/timelineRange";
import { useTrackVisibilityStore } from "@/stores/trackVisibilityStore";
import { OBJECT_CATEGORIES, type ObjectCategory } from "@/types/tracks";
import { useTimelineQueryRange } from "@/hooks/useTimelineQueryRange";
import { coverageBucketMs } from "@/lib/diarizationCoverage";
import {
  shouldLoadTimelineObjectDetail,
  timelineObjectLimit,
} from "@/lib/timelineDetail";

const DEFAULT_TIMELINE_WIDTH = 1_024;
const OBJECT_QUERY_DELAY_MS = 650;

type TimelineObjectsResponse = {
  objects: Object[];
  truncated: boolean;
};

type ObjectsState = {
  objects: Object[];
  loading: boolean;
  error: string | null;
  truncated: boolean;
  currentRange: { start: Date; end: Date } | null;
  requestedRange: { start: Date; end: Date } | null;
  requestedLimit: number | null;
  fetchForRange: (start: Date, end: Date, limit?: number) => Promise<void>;
  deferForRange: (start: Date, end: Date) => void;
};

let latestRequestGeneration = 0;

export const useObjectsStore = create<ObjectsState>((set, get) => ({
  objects: [],
  loading: false,
  error: null,
  truncated: false,
  currentRange: null,
  requestedRange: null,
  requestedLimit: null,
  deferForRange: (start, end) => {
    latestRequestGeneration++;
    set({
      objects: [],
      loading: false,
      error: null,
      truncated: false,
      currentRange: { start, end },
      requestedRange: null,
      requestedLimit: null,
    });
  },
  fetchForRange: async (start: Date, end: Date, requestedLimit) => {
    const state = get();
    const limit = requestedLimit ?? timelineObjectLimit(
      Math.max(0, end.getTime() - start.getTime()),
      DEFAULT_TIMELINE_WIDTH,
    );
    if (
      state.loading &&
      state.requestedRange &&
      state.requestedRange.start.getTime() === start.getTime() &&
      state.requestedRange.end.getTime() === end.getTime() &&
      state.requestedLimit === limit
    ) {
      return;
    }

    const requestGeneration = ++latestRequestGeneration;
    try {
      set({
        loading: true,
        error: null,
        requestedRange: { start, end },
        requestedLimit: limit,
      });
      const result = await fetchObjects(start, end, limit);
      if (requestGeneration !== latestRequestGeneration) return;
      set({
        objects: result.objects,
        truncated: result.truncated,
        currentRange: { start, end },
        loading: false,
      });
    } catch (err) {
      if (requestGeneration !== latestRequestGeneration) return;
      const error = err instanceof Error
        ? err.message
        : "Failed to fetch objects";
      console.error("Failed to fetch objects:", err);
      set({ error, loading: false });
    }
  },
}));

async function fetchObjects(
  start: Date,
  end: Date,
  limit: number,
): Promise<TimelineObjectsResponse> {
  return callResource("objects", {
    action: "list",
    view: "timeline",
    options: {
      hasTimeRanges: true,
      includeRelationships: true,
      limit,
      sort: { earliestStart: -1, duration: -1 },
      timeRangeFilter: {
        start: start.toISOString(),
        end: end.toISOString(),
      },
    },
  });
}

export function useObjects(
  { width = DEFAULT_TIMELINE_WIDTH, enabled = true }: {
    width?: number;
    enabled?: boolean;
  } = {},
) {
  const {
    objects,
    loading,
    error,
    truncated,
    currentRange,
    requestedRange,
  } = useObjectsStore();
  const fetchForRange = useObjectsStore((state) => state.fetchForRange);
  const deferForRange = useObjectsStore((state) => state.deferForRange);
  const { start, end } = useTimelineRange();
  const rangeMs = Math.max(0, end.getTime() - start.getTime());
  const detailDeferred = !shouldLoadTimelineObjectDetail(rangeMs, width);
  const alignmentMs = coverageBucketMs(rangeMs, width);
  const limit = timelineObjectLimit(rangeMs, width);
  const queryRange = useTimelineQueryRange(
    start,
    end,
    alignmentMs,
    OBJECT_QUERY_DELAY_MS,
  );
  const queryRangeReady = queryRange.alignmentMs === alignmentMs &&
    queryRange.start.getTime() <= start.getTime() &&
    queryRange.end.getTime() >= end.getTime();

  useEffect(() => {
    if (!enabled) return;
    if (detailDeferred) {
      deferForRange(start, end);
      return;
    }
    if (!queryRangeReady) return;
    void fetchForRange(queryRange.start, queryRange.end, limit);
  }, [
    deferForRange,
    detailDeferred,
    enabled,
    end,
    fetchForRange,
    limit,
    queryRange.end,
    queryRangeReady,
    queryRange.start,
    start,
  ]);

  return {
    objects,
    loading,
    error,
    truncated,
    currentRange,
    requestedRange,
    detailDeferred,
  };
}

// Determine the category of an object based on its flags
export function getObjectCategory(object: Object): ObjectCategory {
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

// Hook for getting object counts by category
export function useObjectCategoryCounts(): Record<ObjectCategory, number> {
  const objects = useObjectsStore((state) => state.objects);

  return useMemo(() => {
    const counts: Record<ObjectCategory, number> = {
      person: 0,
      event: 0,
      relationship: 0,
      promise: 0,
      place: 0,
      organization: 0,
      product: 0,
      project: 0,
      animal: 0,
      concept: 0,
      media: 0,
      other: 0,
    };

    for (const obj of objects) {
      const category = getObjectCategory(obj);
      counts[category]++;
    }

    return counts;
  }, [objects]);
}

// Hook returning total object count
export function useTotalObjectCount(): number {
  return useObjectsStore((state) => state.objects.length);
}

// Hook returning only visible objects (skips hidden categories)
export function useFilteredObjects({ width }: { width?: number } = {}) {
  const {
    objects,
    loading,
    error,
    truncated,
    currentRange,
    requestedRange,
    detailDeferred,
  } = useObjects({ width });
  const visibleCategories = useTrackVisibilityStore((s) =>
    s.visibleObjectCategories
  );

  const filtered = useMemo(() => {
    // Fast path: all categories visible
    if (visibleCategories.length === OBJECT_CATEGORIES.length) return objects;
    return objects.filter((obj) =>
      visibleCategories.includes(getObjectCategory(obj))
    );
  }, [objects, visibleCategories]);

  return {
    objects: filtered,
    loading,
    error,
    truncated,
    currentRange,
    requestedRange,
    detailDeferred,
  };
}
