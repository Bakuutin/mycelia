import { create } from "zustand";
import { devtools } from "zustand/middleware";
import { callResource } from "@/lib/api";

export interface HistogramItem {
  _id: { $oid: string } | string;
  start: Date;
  end?: Date;
  topics?: unknown[];
}

interface TopicsState {
  items: HistogramItem[];
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  fetchInitial: () => Promise<void>;
  loadMore: () => Promise<void>;
}

const PAGE_SIZE = 50;
const MAX_KEEP = 400;
const DEBOUNCE_MS = 300;

const seenIds = new Set<string>();
let lastLoadMs = 0;

function getIdKey(item: HistogramItem): string {
  return typeof item._id === "string" ? item._id : JSON.stringify(item._id);
}

async function fetchPage(beforeStart: Date | null): Promise<HistogramItem[]> {
  const query: any = { topics: { $exists: true, $ne: [] } };
  if (beforeStart) query.start = { $lt: beforeStart };
  const result = await callResource("tech.mycelia.mongo", {
    action: "find",
    collection: "histogram_5min",
    query,
    options: { sort: { start: -1 }, limit: PAGE_SIZE },
  });
  return result as HistogramItem[];
}

export const useTopicsStore = create<TopicsState>()(
  devtools((set, get) => ({
    items: [],
    loading: false,
    loadingMore: false,
    error: null,

    fetchInitial: async () => {
      if (get().loading || get().items.length > 0) return;
      set({ loading: true, error: null });
      try {
        const firstPage = await fetchPage(null);
        const deduped: HistogramItem[] = [];
        for (const it of firstPage) {
          const key = getIdKey(it);
          if (!seenIds.has(key)) {
            seenIds.add(key);
            deduped.push(it);
          }
        }
        set({ items: deduped });
      } catch (err) {
        set({
          error: err instanceof Error ? err.message : "Failed to fetch topics",
        });
      } finally {
        set({ loading: false });
      }
    },

    loadMore: async () => {
      if (get().loadingMore) return;
      const now = Date.now();
      if (now - lastLoadMs < DEBOUNCE_MS) return;
      lastLoadMs = now;

      const items = get().items;
      if (items.length === 0) {
        // If nothing loaded yet, fall back to initial fetch
        await get().fetchInitial();
        return;
      }

      const oldest = items[items.length - 1];
      const beforeStart = new Date(oldest.start);

      set({ loadingMore: true });
      try {
        const page = await fetchPage(beforeStart);
        if (page.length === 0) return;
        const merged: HistogramItem[] = [...get().items];
        for (const it of page) {
          const key = getIdKey(it);
          if (!seenIds.has(key)) {
            seenIds.add(key);
            merged.push(it);
          }
        }
        const trimmed = merged.length > MAX_KEEP
          ? merged.slice(0, MAX_KEEP)
          : merged;
        set({ items: trimmed });
      } finally {
        set({ loadingMore: false });
      }
    },
  }), { name: "topics-store" }),
);
