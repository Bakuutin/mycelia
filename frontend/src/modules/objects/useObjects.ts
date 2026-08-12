import { useEffect, useMemo } from "react";
import { create } from "zustand";
import { Object } from "@/types/objects.ts";
import { callResource } from "@/lib/api";
import { useTimelineRange } from "@/stores/timelineRange";
import { useTrackVisibilityStore } from "@/stores/trackVisibilityStore";
import { OBJECT_CATEGORIES, type ObjectCategory } from "@/types/tracks";
import { useTimelineQueryRange } from "@/hooks/useTimelineQueryRange";

const OBJECT_QUERY_ALIGNMENT_MS = 5 * 60 * 1_000;
const TIMELINE_OBJECT_LIMIT = 5_000;

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
  fetchForRange: (start: Date, end: Date) => Promise<void>;
};

let latestRequestGeneration = 0;

export const useObjectsStore = create<ObjectsState>((set, get) => ({
  objects: [],
  loading: false,
  error: null,
  truncated: false,
  currentRange: null,
  requestedRange: null,
  fetchForRange: async (start: Date, end: Date) => {
    const state = get();
    if (
      state.requestedRange &&
      state.requestedRange.start.getTime() === start.getTime() &&
      state.requestedRange.end.getTime() === end.getTime()
    ) {
      return;
    }

    const requestGeneration = ++latestRequestGeneration;
    try {
      set({ loading: true, error: null, requestedRange: { start, end } });
      const result = await fetchObjects(start, end);
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
): Promise<TimelineObjectsResponse> {
  return callResource("objects", {
    action: "list",
    view: "timeline",
    options: {
      hasTimeRanges: true,
      includeRelationships: true,
      limit: TIMELINE_OBJECT_LIMIT,
      sort: { earliestStart: -1, duration: -1 },
      timeRangeFilter: {
        start: start.toISOString(),
        end: end.toISOString(),
      },
    },
  });
}

export function useObjects() {
  const {
    objects,
    loading,
    error,
    truncated,
    currentRange,
    requestedRange,
  } = useObjectsStore();
  const fetchForRange = useObjectsStore((state) => state.fetchForRange);
  const { start, end } = useTimelineRange();
  const queryRange = useTimelineQueryRange(
    start,
    end,
    OBJECT_QUERY_ALIGNMENT_MS,
    300,
  );

  useEffect(() => {
    void fetchForRange(queryRange.start, queryRange.end);
  }, [fetchForRange, queryRange.end, queryRange.start]);

  return {
    objects,
    loading,
    error,
    truncated,
    currentRange,
    requestedRange,
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
export function useFilteredObjects() {
  const {
    objects,
    loading,
    error,
    truncated,
    currentRange,
    requestedRange,
  } = useObjects();
  const visibleCategories = useTrackVisibilityStore((s) => s.visibleObjectCategories);

  const filtered = useMemo(() => {
    // Fast path: all categories visible
    if (visibleCategories.length === OBJECT_CATEGORIES.length) return objects;
    return objects.filter((obj) => visibleCategories.includes(getObjectCategory(obj)));
  }, [objects, visibleCategories]);

  return {
    objects: filtered,
    loading,
    error,
    truncated,
    currentRange,
    requestedRange,
  };
}
