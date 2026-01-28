import { useEffect, useCallback, useRef } from "react";
import { create } from "zustand";
import { Object } from "@/types/objects.ts";
import { callResource } from "@/lib/api";
import { useTimelineRange } from "@/stores/timelineRange";

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
