import { create } from "zustand";
import crossfilter from "crossfilter2";
import type { Resolution } from "@/lib/resolution";
import { RESOLUTION_TO_MS } from "@/lib/resolution";
import { callResource } from "@/lib/api";

export type Timestamp = number;

export interface HistogramItem {
  id: string;
  start: Date;
  end: Date;
  stale: boolean;
  totals: {
    seconds: number;
    audio_chunks?: {
      count: number;
      speech_probability_max?: number;
      speech_probability_avg?: number;
      has_speech?: number;
    };
    transcriptions?: {
      count: number;
    };
    diarizations?: {
      count: number;
    };
  };
}

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

type HistogramCacheStore = {
  data: {
    [R in Resolution]?: {
      loadedRanges: LoadedRange[];
      items: HistogramItem[];
    };
  };
  indexByResolution: {
    [R in Resolution]?: {
      cf: any;
      tsDim: any;
      idDim: any;
    };
  };
  inFlightRequests: {
    [R in Resolution]?: {
      ranges: LoadedRange[];
      requestedAt: Date;
    };
  };
  pendingByResolution: Partial<Record<Resolution, LoadedRange[]>>;
  schedulerActive: Partial<Record<Resolution, boolean>>;
  ensureIndex: (resolution: Resolution) => void;
  addData: (
    resolution: Resolution,
    range: LoadedRange,
    items: HistogramItem[],
  ) => void;
  invalidateAll: () => void;
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

export const useHistogramCache = create<HistogramCacheStore>((set, get) => ({
  data: {},
  indexByResolution: {},
  inFlightRequests: {},
  pendingByResolution: {},
  schedulerActive: {},

  ensureIndex: (resolution) => {
    const existing = get().indexByResolution[resolution];
    if (existing) return;
    const cf = crossfilter([]);
    const tsDim = cf.dimension((d: any) => new Date(d.start).getTime());
    const idDim = cf.dimension((d: any) => d.id);
    set((state) => ({
      indexByResolution: {
        ...state.indexByResolution,
        [resolution]: { cf, tsDim, idDim },
      },
    }));
  },

  addData: (resolution, range, items = []) => {
    console.log("addData called", {
      resolution,
      range,
      newItemsCount: items.length,
    });

    const existing = get().data[resolution] ?? {
      loadedRanges: [],
      items: [],
    };

    const newRanges = mergeRanges([...existing.loadedRanges, range]);

    const itemMap = new Map<string, HistogramItem>();

    for (const item of existing.items) {
      itemMap.set(item.id, item);
    }

    for (const item of items) {
      itemMap.set(item.id, item);
    }

    const sortedItems = Array.from(itemMap.values()).sort((a, b) =>
      a.id.localeCompare(b.id)
    );

    console.log("addData updating store", {
      resolution,
      totalItemsAfterMerge: sortedItems.length,
      loadedRangesCount: newRanges.length,
    });

    set((state) => ({
      data: {
        ...state.data,
        [resolution]: {
          loadedRanges: newRanges,
          items: sortedItems,
        },
      },
    }));

    get().ensureIndex(resolution);
    const index = get().indexByResolution[resolution]!;
    index.tsDim.filterAll();
    index.idDim.filterAll();
    index.cf.remove();
    index.cf.add(sortedItems);
  },

  invalidateAll: () => {
    set({
      data: {},
      indexByResolution: {},
      inFlightRequests: {},
      pendingByResolution: {},
      schedulerActive: {},
    });
  },

  getMissingRanges: (resolution, start, end) => {
    const loaded = get().data[resolution]?.loadedRanges ?? [];
    const inFlightRanges = get().inFlightRequests[resolution]?.ranges ?? [];
    return computeMissingRanges(start, end, loaded, inFlightRanges);
  },

  fetchMissingRanges: (resolution, start, end) => {
    console.log("fetchMissingRanges called", {
      resolution,
      start: new Date(start).toISOString(),
      end: new Date(end).toISOString(),
    });

    const pending = get().pendingByResolution[resolution] ?? [];
    const nextPending = mergeRanges([...pending, { start, end }]);
    set((state) => ({
      pendingByResolution: {
        ...state.pendingByResolution,
        [resolution]: nextPending,
      },
    }));

    if (get().schedulerActive[resolution]) return;
    set((state) => ({
      schedulerActive: { ...state.schedulerActive, [resolution]: true },
    }));

    const DEBOUNCE_MS = 250;
    setTimeout(() => {
      const pendingNow = get().pendingByResolution[resolution] ?? [];
      if (pendingNow.length === 0) {
        set((state) => ({
          schedulerActive: { ...state.schedulerActive, [resolution]: false },
        }));
        return;
      }

      const minStart = Math.min(...pendingNow.map((r) => r.start));
      const maxEnd = Math.max(...pendingNow.map((r) => r.end));

      set((state) => ({
        pendingByResolution: { ...state.pendingByResolution, [resolution]: [] },
        schedulerActive: { ...state.schedulerActive, [resolution]: false },
      }));

      const missingRanges = get().getMissingRanges(
        resolution,
        minStart,
        maxEnd,
      );
      console.log("Missing ranges to fetch:", missingRanges);
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
          const queryStart = new Date(range.start);
          const queryEnd = new Date(range.end);
          const binSize = RESOLUTION_TO_MS[resolution];

          console.log("Fetching histogram data from mongo:", {
            resolution,
            collection: `histogram_${resolution}`,
            queryStart: queryStart.toISOString(),
            queryEnd: queryEnd.toISOString(),
          });

          const histogramData = await callResource("mongo", {
            action: "find",
            collection: `histogram_${resolution}`,
            query: {
              start: { $gte: queryStart, $lt: queryEnd },
            },
            options: { sort: { start: 1 } },
          }) as any[];

          console.log("Received histogram data from mongo:", {
            itemsCount: histogramData.length,
            range,
          });

          const items = histogramData.map((doc: any) => ({
            id: doc._id.toString(),
            start: new Date(doc.start),
            end: new Date(new Date(doc.start).getTime() + binSize),
            stale: doc.stale || false,
            totals: {
              seconds: binSize / 1000,
              ...doc.totals,
            },
          }));

          const store = get();
          store.addData(
            resolution,
            { start: range.start, end: range.end },
            items,
          );
          const existing = store.inFlightRequests[resolution];
          const updatedRanges = existing?.ranges?.filter(
            (r) => !(r.start === range.start && r.end === range.end),
          ) ?? [];
          set((state) => {
            const next = {
              ...state.inFlightRequests,
            } as typeof state.inFlightRequests;
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
          console.error("Failed to fetch histogram data:", error);
          const store = get();
          const existing = store.inFlightRequests[resolution];
          const updatedRanges = existing?.ranges?.filter(
            (r) => !(r.start === range.start && r.end === range.end),
          ) ?? [];
          set((state) => {
            const next = {
              ...state.inFlightRequests,
            } as typeof state.inFlightRequests;
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
        const workers = new Array(Math.min(MAX, queue.length)).fill(0).map(() =>
          runOne()
        );
        await Promise.all(workers);
      })();
    }, DEBOUNCE_MS);
  },
}));
