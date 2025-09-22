import { create } from "zustand";
import { useCallback, useEffect, useRef } from "react";
import _ from "lodash";
import type { TimelineItem } from "@/types/timeline.ts";

type Resolution = "5min" | "1hour" | "1day" | "1week";

type Timestamp = number;

// removed local TimelineItem type

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
    [R in Resolution]?: {
      ranges: LoadedRange[];
      requestedAt: Date;
    };
  };
  hasGlobalPrefetch: boolean;
  pendingByResolution: Partial<Record<Resolution, LoadedRange[]>>;
  schedulerActive: Partial<Record<Resolution, boolean>>;
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
  prefetchAroundCenter: (
    center: Timestamp,
  ) => void;
};

export const useAudioCache = create<AudioCacheStore>((set, get) => ({
  data: {},
  inFlightRequests: {},
  hasGlobalPrefetch: false,
  pendingByResolution: {},
  schedulerActive: {},

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
    const inFlightRanges = get().inFlightRequests[resolution]?.ranges ?? [];
    return computeMissingRanges(start, end, loaded, inFlightRanges);
  },

  fetchMissingRanges: (resolution, start, end) => {
    const pending = get().pendingByResolution[resolution] ?? [];
    const nextPending = mergeRanges([...pending, { start, end }]);
    set((state) => ({
      pendingByResolution: {
        ...state.pendingByResolution,
        [resolution]: nextPending,
      },
    }));

    if (get().schedulerActive[resolution]) return;
    set((state) => ({ schedulerActive: { ...state.schedulerActive, [resolution]: true } }));

    const DEBOUNCE_MS = 250;
    setTimeout(() => {
      const pendingNow = get().pendingByResolution[resolution] ?? [];
      if (pendingNow.length === 0) {
        set((state) => ({ schedulerActive: { ...state.schedulerActive, [resolution]: false } }));
        return;
      }

      const minStart = Math.min(...pendingNow.map((r) => r.start));
      const maxEnd = Math.max(...pendingNow.map((r) => r.end));

      set((state) => ({
        pendingByResolution: { ...state.pendingByResolution, [resolution]: [] },
        schedulerActive: { ...state.schedulerActive, [resolution]: false },
      }));

      const missingRanges = get().getMissingRanges(resolution, minStart, maxEnd);
      if (missingRanges.length === 0) return;

      const existing = get().inFlightRequests[resolution];
      const currentInFlight = existing?.ranges ?? [];
      const newRanges = mergeRanges([...currentInFlight, ...missingRanges]);

      set((state) => ({
        inFlightRequests: {
          ...state.inFlightRequests,
          [resolution]: {
            ranges: newRanges,
            requestedAt: new Date(),
          },
        },
      }));

      const queue = [...missingRanges];
      const MAX = 5;
      const runOne = async () => {
        const range = queue.shift();
        if (!range) return;
        try {
          const res = await fetch(`/data/audio/items?start=${range.start}&end=${range.end}&resolution=${resolution}`);
          const data = await res.json();
          const store = get();
          store.addData(
            resolution,
            { start: range.start, end: range.end },
            data.items.map((item: any) => ({
              start: new Date(item.start),
              end: new Date(item.end),
              id: item.id,
              totals: item.totals,
              stale: item.stale,
              topics: item.topics,
            })),
          );
          const existing = store.inFlightRequests[resolution];
          const updatedRanges = existing?.ranges?.filter(
            (r) => !(r.start === range.start && r.end === range.end),
          ) ?? [];
          set((state) => {
            const next = { ...state.inFlightRequests } as typeof state.inFlightRequests;
            if (updatedRanges.length > 0) {
              next[resolution] = {
                ranges: updatedRanges,
                requestedAt: existing?.requestedAt ?? new Date(),
              };
            } else {
              delete next[resolution];
            }
            return { inFlightRequests: next };
          });
        } catch (error) {
          console.error("Failed to fetch audio data:", error);
          const store = get();
          const existing = store.inFlightRequests[resolution];
          const updatedRanges = existing?.ranges?.filter(
            (r) => !(r.start === range.start && r.end === range.end),
          ) ?? [];
          set((state) => {
            const next = { ...state.inFlightRequests } as typeof state.inFlightRequests;
            if (updatedRanges.length > 0) {
              next[resolution] = {
                ranges: updatedRanges,
                requestedAt: existing?.requestedAt ?? new Date(),
              };
            } else {
              delete next[resolution];
            }
            return { inFlightRequests: next };
          });
        }
        await runOne();
      };
      void (async () => {
        const workers = new Array(Math.min(MAX, queue.length)).fill(0).map(() => runOne());
        await Promise.all(workers);
      })();
    }, DEBOUNCE_MS);
  },

  prefetchAroundCenter: (center) => {
    if (get().hasGlobalPrefetch) return;
    set({ hasGlobalPrefetch: true });
    const RESOLUTION_MS: Record<Resolution, number> = {
      "5min": 5 * 60 * 1000,
      "1hour": 60 * 60 * 1000,
      "1day": 24 * 60 * 60 * 1000,
      "1week": 7 * 24 * 60 * 1000,
    };
    const resolutions: Resolution[] = ["5min", "1hour", "1day", "1week"];
    const coarsest: Resolution = "1week";

    const endAll = Date.now() + RESOLUTION_MS[coarsest];
    get().fetchMissingRanges(coarsest, 0, endAll);

    for (const res of resolutions) {
      // if (res === coarsest) continue;
      const unit = RESOLUTION_MS[res];
      const totalWindow = 1000 * unit;
      const half = Math.floor(totalWindow / 2);
      const s = center - half;
      const e = center + half;
      get().fetchMissingRanges(res, s, e);
    }
  },
}));

export function useAudioItems(start: Date, end: Date, resolution: Resolution) {
  const {
    data,
    fetchMissingRanges,
    prefetchAroundCenter,
  } = useAudioCache();

  const debouncedFetchMissingRanges = useCallback(
    _.debounce((resolution, start, end) => {
      fetchMissingRanges(resolution, start, end);
    }, 300),
    [fetchMissingRanges],
  );

  useEffect(() => {
    debouncedFetchMissingRanges(resolution, start.getTime(), end.getTime());
    const center = Math.floor((start.getTime() + end.getTime()) / 2);
    prefetchAroundCenter(center);
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

