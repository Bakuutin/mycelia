import { create } from "zustand";
import { apiClient } from "@/lib/api";

export interface MarkedRange {
  id: string;
  start: Date;
  end: Date;
  label?: string;
  color?: string;
  createdAt: Date;
}

interface MarkedRangesState {
  ranges: MarkedRange[];
  loaded: boolean;
  loadFromServer: () => Promise<void>;
  addRange: (start: Date, end: Date, label?: string, color?: string) => string;
  removeRange: (id: string) => void;
  updateRange: (id: string, updates: Partial<Pick<MarkedRange, "label" | "color">>) => void;
  clearAll: () => void;
  getRangeAt: (date: Date) => MarkedRange | undefined;
}

// Default colors for marked ranges (cycle through these)
export const MARKED_RANGE_COLORS = [
  "#ef4444", // red
  "#f97316", // orange
  "#eab308", // yellow
  "#22c55e", // green
  "#06b6d4", // cyan
  "#3b82f6", // blue
  "#8b5cf6", // violet
  "#ec4899", // pink
];

let colorIndex = 0;
function getNextColor(): string {
  const color = MARKED_RANGE_COLORS[colorIndex % MARKED_RANGE_COLORS.length];
  colorIndex++;
  return color;
}

function parseRange(r: any): MarkedRange {
  return {
    id: r.id,
    start: new Date(r.start),
    end: new Date(r.end),
    label: r.label,
    color: r.color,
    createdAt: new Date(r.createdAt),
  };
}

export const useMarkedRangesStore = create<MarkedRangesState>()(
  (set, get) => ({
    ranges: [],
    loaded: false,

    loadFromServer: async () => {
      try {
        const data = await apiClient.get("/data/marked-ranges") as { ranges: any[] };
        if (data?.ranges) {
      set({
            ranges: data.ranges.map(parseRange),
            loaded: true,
          });
        }
      } catch (err) {
        console.error("Failed to load marked ranges:", err);
      }
    },

    addRange: (start, end, label, color) => {
      // Optimistic: generate a temp id and add immediately
      const tempId = `temp_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      const assignedColor = color || getNextColor();
      const newRange: MarkedRange = {
        id: tempId,
        start,
        end,
        label,
        color: assignedColor,
        createdAt: new Date(),
      };
      set((state) => ({ ranges: [...state.ranges, newRange] }));

      // Persist to backend, then replace temp id with real id
      apiClient.post("/data/marked-ranges", {
        start: start.toISOString(),
        end: end.toISOString(),
        label,
        color: assignedColor,
      }).then((resp: any) => {
        set((state) => ({
          ranges: state.ranges.map((r) =>
            r.id === tempId ? { ...r, id: resp.id } : r
          ),
        }));
      }).catch((err) => {
        console.error("Failed to save marked range:", err);
        // Revert on failure
        set((state) => ({ ranges: state.ranges.filter((r) => r.id !== tempId) }));
      });

      return tempId;
    },

    removeRange: (id) => {
      const prev = get().ranges;
      set({ ranges: prev.filter((r) => r.id !== id) });

      if (!id.startsWith("temp_")) {
        apiClient.delete(`/data/marked-ranges/${id}`).catch((err) => {
          console.error("Failed to delete marked range:", err);
          // Revert on failure
          set({ ranges: prev });
        });
      }
    },

    updateRange: (id, updates) => {
      const prev = get().ranges;
      set({
        ranges: prev.map((r) => (r.id === id ? { ...r, ...updates } : r)),
      });

      if (!id.startsWith("temp_")) {
        apiClient.put(`/data/marked-ranges/${id}`, updates).catch((err) => {
          console.error("Failed to update marked range:", err);
          // Revert on failure
          set({ ranges: prev });
        });
      }
    },

    clearAll: () => {
      const prev = get().ranges;
      set({ ranges: [] });

      // Delete each from backend
      for (const r of prev) {
        if (!r.id.startsWith("temp_")) {
          apiClient.delete(`/data/marked-ranges/${r.id}`).catch((err) => {
            console.error("Failed to delete marked range:", err);
          });
        }
      }
    },

    getRangeAt: (date) => {
      const time = date.getTime();
      return get().ranges.find(
        (r) => time >= r.start.getTime() && time <= r.end.getTime()
      );
    },
  })
);
