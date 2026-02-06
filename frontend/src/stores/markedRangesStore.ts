import { create } from "zustand";
import { persist } from "zustand/middleware";

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
  addRange: (start: Date, end: Date, label?: string, color?: string) => string;
  removeRange: (id: string) => void;
  updateRange: (id: string, updates: Partial<Pick<MarkedRange, "label" | "color">>) => void;
  clearAll: () => void;
  getRangeAt: (date: Date) => MarkedRange | undefined;
}

// Generate a simple unique ID
function generateId(): string {
  return `mr_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

// Default colors for marked ranges (cycle through these)
const DEFAULT_COLORS = [
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
  const color = DEFAULT_COLORS[colorIndex % DEFAULT_COLORS.length];
  colorIndex++;
  return color;
}

export const useMarkedRangesStore = create<MarkedRangesState>()(
  persist(
    (set, get) => ({
      ranges: [],

      addRange: (start, end, label, color) => {
        const id = generateId();
        const newRange: MarkedRange = {
          id,
          start,
          end,
          label,
          color: color || getNextColor(),
          createdAt: new Date(),
        };
        set((state) => ({
          ranges: [...state.ranges, newRange],
        }));
        return id;
      },

      removeRange: (id) => {
        set((state) => ({
          ranges: state.ranges.filter((r) => r.id !== id),
        }));
      },

      updateRange: (id, updates) => {
        set((state) => ({
          ranges: state.ranges.map((r) =>
            r.id === id ? { ...r, ...updates } : r
          ),
        }));
      },

      clearAll: () => {
        set({ ranges: [] });
      },

      getRangeAt: (date) => {
        const time = date.getTime();
        return get().ranges.find(
          (r) => time >= r.start.getTime() && time <= r.end.getTime()
        );
      },
    }),
    {
      name: "mycelia-marked-ranges",
      // Custom serialization to handle Date objects
      storage: {
        getItem: (name) => {
          const str = localStorage.getItem(name);
          if (!str) return null;
          const parsed = JSON.parse(str);
          // Convert date strings back to Date objects
          if (parsed.state?.ranges) {
            parsed.state.ranges = parsed.state.ranges.map((r: any) => ({
              ...r,
              start: new Date(r.start),
              end: new Date(r.end),
              createdAt: new Date(r.createdAt),
            }));
          }
          return parsed;
        },
        setItem: (name, value) => {
          localStorage.setItem(name, JSON.stringify(value));
        },
        removeItem: (name) => {
          localStorage.removeItem(name);
        },
      },
    }
  )
);
