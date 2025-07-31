import { create } from "zustand";
import { useCallback, useEffect } from "react";
import _ from "lodash";

type Resolution = "5min" | "1hour" | "1day" | "1week";

type Timestamp = number;

export type TimelineItem = { start: Date; end: Date; [key: string]: any };

type LoadedRange = { start: Timestamp; end: Timestamp };

function mergeRanges(ranges: LoadedRange[]): LoadedRange[] {
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const merged: LoadedRange[] = [];

  for (const range of sorted) {
    if (merged.length === 0 || merged[merged.length - 1].end < range.start) {
      merged.push({ ...range });
    } else {
      merged[merged.length - 1].end = Math.max(
        merged[merged.length - 1].end,
        range.end,
      );
    }
  }

  return merged;
}

function computeMissingRanges(
  start: Timestamp,
  end: Timestamp,
  loaded: LoadedRange[],
  inFlight: LoadedRange[],
): LoadedRange[] {
  const allRanges = [...loaded, ...inFlight];
  const missing: LoadedRange[] = [];
  let current = start;

  for (const range of allRanges) {
    if (range.end <= current) continue;
    if (range.start > current) {
      missing.push({ start: current, end: Math.min(end, range.start) });
    }
    current = Math.max(current, range.end);
    if (current >= end) break;
  }

  if (current < end) missing.push({ start: current, end });

  return missing;
}

type AudioCacheStore = {
  data: {
    [R in Resolution]?: {
      loadedRanges: LoadedRange[];
      items: TimelineItem[];
    };
  };
  inFlightRequests: {
    [R in Resolution]?: LoadedRange[];
  };
  addData: (
    resolution: Resolution,
    range: LoadedRange,
    items: TimelineItem[],
  ) => void;
  getMissingRanges: (
    resolution: Resolution,
    start: Timestamp,
    end: Timestamp,
  ) => LoadedRange[];
  fetchMissingRanges: (
    resolution: Resolution,
    start: Timestamp,
    end: Timestamp,
  ) => void;
};

export const useAudioCache = create<AudioCacheStore>((set, get) => ({
  data: {},
  inFlightRequests: {},

  addData: (resolution, range, items = []) => {
    const existing = get().data[resolution] ?? {
      loadedRanges: [],
      items: [],
    };

    const newRanges = mergeRanges([...existing.loadedRanges, range]);

    // Combine existing and new items, remove duplicates by id, and sort by id
    const itemMap = new Map<string, TimelineItem>();

    // Add existing items first (they have priority)
    for (const item of existing.items) {
      itemMap.set(item.id, item);
    }

    // Add new items (will overwrite duplicates)
    for (const item of items) {
      itemMap.set(item.id, item);
    }

    const sortedItems = Array.from(itemMap.values()).sort((a, b) =>
      a.id.localeCompare(b.id)
    );

    set((state) => ({
      data: {
        ...state.data,
        [resolution]: {
          loadedRanges: newRanges,
          items: sortedItems,
        },
      },
    }));
  },

  getMissingRanges: (resolution, start, end) => {
    const loaded = get().data[resolution]?.loadedRanges ?? [];
    const inFlight = get().inFlightRequests[resolution] ?? [];
    return computeMissingRanges(start, end, loaded, inFlight);
  },

  fetchMissingRanges: (resolution, start, end) => {
    const missingRanges = get().getMissingRanges(resolution, start, end);
    if (missingRanges.length === 0) return;

    // Add missing ranges to in-flight requests
    const currentInFlight = get().inFlightRequests[resolution] ?? [];
    const newInFlight = mergeRanges([...currentInFlight, ...missingRanges]);

    set((state) => ({
      inFlightRequests: {
        ...state.inFlightRequests,
        [resolution]: newInFlight,
      },
    }));

    // Fetch each missing range
    for (const range of missingRanges) {
      void fetch(
        `/data/audio/items?start=${range.start}&end=${range.end}&resolution=${resolution}`,
      )
        .then((res) => res.json())
        .then((data) => {
          const store = get();
          store.addData(
            resolution,
            { start: range.start, end: range.end },
            data.items.map((item: any) => ({
              start: new Date(item.start),
              end: new Date(item.end),
              id: item.id,
              totals: item.totals,
            })),
          );

          // Remove from in-flight requests
          const updatedInFlight = store.inFlightRequests[resolution]?.filter(
            (r) => !(r.start === range.start && r.end === range.end),
          ) ?? [];

          set((state) => ({
            inFlightRequests: {
              ...state.inFlightRequests,
              [resolution]: updatedInFlight,
            },
          }));
        })
        .catch((error) => {
          console.error("Failed to fetch audio data:", error);

          // Remove from in-flight requests on error
          const store = get();
          const updatedInFlight = store.inFlightRequests[resolution]?.filter(
            (r) => !(r.start === range.start && r.end === range.end),
          ) ?? [];

          set((state) => ({
            inFlightRequests: {
              ...state.inFlightRequests,
              [resolution]: updatedInFlight,
            },
          }));
        });
    }
  },
}));

export function useAudioItems(start: Date, end: Date, resolution: Resolution) {
  const {
    data,
    fetchMissingRanges,
  } = useAudioCache();

  const debouncedFetchMissingRanges = useCallback(
    _.debounce((resolution, start, end) => {
      fetchMissingRanges(resolution, start, end);
    }, 300),
    [fetchMissingRanges],
  );

  useEffect(() => {
    debouncedFetchMissingRanges(resolution, start.getTime(), end.getTime());
  }, [resolution, start.getTime(), end.getTime()]);

  const filteredItems = data[resolution]?.items.filter(
    (item) =>
      item.end.getTime() >= start.getTime() &&
      item.start.getTime() <= end.getTime(),
  ) ?? [];

  return {
    items: filteredItems,
  };
}
