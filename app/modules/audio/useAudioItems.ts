import { create } from "zustand";
import { useEffect } from "react";

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
        merged[merged.length - 1].end = Math.max(merged[merged.length - 1].end, range.end);
      }
    }
  
    return merged;
  }
  
  function computeMissingRanges(start: Timestamp, end: Timestamp, loaded: LoadedRange[]): LoadedRange[] {
    const missing: LoadedRange[] = [];
    let current = start;
  
    for (const range of loaded) {
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
  addData: (
    resolution: Resolution,
    range: LoadedRange,
    items: TimelineItem[],
  ) => void;
  getMissingRanges: (resolution: Resolution, start: Timestamp, end: Timestamp) => LoadedRange[];
};

export const useAudioCache = create<AudioCacheStore>((set, get) => ({
  data: {},

  addData: (resolution, range, items = []) => {
    const existing = get().data[resolution] ?? {
      loadedRanges: [],
      items: [],
    };

    const newRanges = mergeRanges([...existing.loadedRanges, range]);

    set((state) => ({
      data: {
        ...state.data,
        [resolution]: {
          loadedRanges: newRanges,
          items: [...existing.items, ...items],
        },
      },
    }));
  },

  getMissingRanges: (resolution, start, end) => {
    const loaded = get().data[resolution]?.loadedRanges ?? [];
    return computeMissingRanges(start, end, loaded);
  },
}));


export function useAudioItems(start: Date, end: Date, resolution: Resolution) {
    const {
      data,
      getMissingRanges,
      addData,
    } = useAudioCache();
  
    useEffect(() => {
      const ranges = getMissingRanges(resolution, start.getTime(), end.getTime());
      if (ranges.length === 0) return;
  
      for (const range of ranges) {
        void fetch(`/data/audio/items?start=${range.start}&end=${range.end}&resolution=${resolution}`)
          .then(res => res.json())
          .then((data) => {
            addData(resolution, { start: range.start, end: range.end }, data.map((item: any) => ({
              start: new Date(item.start),
              end: new Date(item.end),
              id: item.id,
              totals: item.totals,
            })));
          });
      }
    }, [resolution, start.getTime(), end.getTime()]);
  
    const filteredItems = data[resolution]?.items.filter(
      (item) => item.end.getTime() >= start.getTime() && item.start.getTime() <= end.getTime()
    ) ?? [];
  
    return {
      items: filteredItems,
    };
  }