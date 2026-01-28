import { useEffect, useCallback, useRef, useMemo } from "react";
import { create } from "zustand";
import { Object } from "@/types/objects.ts";
import { callResource } from "@/lib/api";
import { useTimelineRange } from "@/stores/timelineRange";
import { useTrackVisibilityStore } from "@/stores/trackVisibilityStore";
import type { ObjectCategory } from "@/types/tracks";

type ObjectsState = {
  objects: Object[];
  loading: boolean;
  error: string | null;
  currentRange: { start: Date; end: Date } | null;
  requestedRange: { start: Date; end: Date } | null;
  fetchForRange: (start: Date, end: Date) => Promise<void>;
};

export const useObjectsStore = create<ObjectsState>((set, get) => ({
  objects: [],
  loading: false,
  error: null,
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

    try {
      set({ loading: true, error: null, requestedRange: { start, end } });
      const objects = await fetchObjects(start, end);
      set({ objects, currentRange: { start, end }, loading: false });
    } catch (err) {
      const error = err instanceof Error
        ? err.message
        : "Failed to fetch objects";
      console.error("Failed to fetch objects:", err);
      set({ error, loading: false });
    }
  },
}));

async function fetchObjects(start: Date, end: Date): Promise<Object[]> {
  const buffer = (end.getTime() - start.getTime()) * 0.1;
  const bufferedStart = new Date(start.getTime() - buffer);
  const bufferedEnd = new Date(end.getTime() + buffer);

  return callResource("objects", {
    action: "list",
    options: {
      hasTimeRanges: true,
      includeRelationships: true,
      sort: { earliestStart: -1, duration: -1 },
      timeRangeFilter: {
        start: bufferedStart.toISOString(),
        end: bufferedEnd.toISOString(),
      },
    },
  });
}

export function useObjects() {
  const { objects, loading, error, currentRange, requestedRange } = useObjectsStore();
  const fetchForRange = useObjectsStore((state) => state.fetchForRange);
  const { start, end } = useTimelineRange();

  const timeoutRef = useRef<number | null>(null);

  const debouncedFetch = useCallback(
    (start: Date, end: Date) => {
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current);
      }

      timeoutRef.current = setTimeout(() => {
        fetchForRange(start, end);
      }, 150);
    },
    [fetchForRange],
  );

  useEffect(() => {
    debouncedFetch(start, end);

    return () => {
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [start, end, debouncedFetch]);

  return {
    objects,
    loading,
    error,
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
  const { objects, loading, error, currentRange, requestedRange } = useObjects();
  const visibleCategories = useTrackVisibilityStore((s) => s.visibleObjectCategories);

  const filtered = useMemo(() => {
    // Fast path: all categories visible
    if (visibleCategories.length === 5) return objects;
    return objects.filter((obj) => visibleCategories.includes(getObjectCategory(obj)));
  }, [objects, visibleCategories]);

  return { objects: filtered, loading, error, currentRange, requestedRange };
}
