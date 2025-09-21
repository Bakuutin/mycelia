import { create } from "zustand";
import { z } from "zod";

const zTimelineRangeParams = z.object({
  start: z.string().transform((val: string) => {
    const startTime = parseInt(val);
    if (isNaN(startTime)) {
      throw new Error("Invalid start parameter");
    }
    return new Date(startTime);
  }).optional(),
  end: z.string().transform((val: string) => {
    const endTime = parseInt(val);
    if (isNaN(endTime)) {
      throw new Error("Invalid end parameter");
    }
    return new Date(endTime);
  }).optional(),
});

export interface TimelineRangeStore {
  start: Date;
  end: Date;
  setStart: (start: Date) => void;
  setEnd: (end: Date) => void;
  setRange: (start: Date, end: Date) => void;
  reset: () => void;
  duration: number;
  center: Date;
  autoCenter: boolean;
  setAutoCenter: (enabled: boolean) => void;
  toggleAutoCenter: () => void;
}

const day = 1000 * 60 * 60 * 24;

function getDaysAgo(n: number) {
  const today = new Date(new Date().toISOString().split("T")[0]);
  const monthAgo = new Date(today.getTime() - n * day);
  return monthAgo;
}

function getInitialValuesFromURL() {
  if (typeof window === "undefined") {
    return { start: getDaysAgo(30), end: new Date() };
  }

  const urlParams = new URLSearchParams(globalThis.location.search);
  const startParam = urlParams.get("start");
  const endParam = urlParams.get("end");

  try {
    const params = zTimelineRangeParams.parse({
      start: startParam,
      end: endParam,
    });

    return {
      start: params.start || getDaysAgo(30),
      end: params.end || new Date(),
    };
  } catch {
    return { start: getDaysAgo(30), end: new Date() };
  }
}

export const useTimelineRange = create<TimelineRangeStore>((set: any) => {
  const { start, end } = getInitialValuesFromURL();

  return {
    start,
    end,
    autoCenter: false,

    setStart: (start: Date) => set({ start }),

    setEnd: (end: Date) => set({ end }),

    setRange: (start: Date, end: Date) => set({ start, end }),

    reset: () =>
      set({
        start: new Date(),
        end: new Date(),
      }),

    get center() {
      return new Date((this.start.getTime() + this.end.getTime()) / 2);
    },

    get duration() {
      return this.end.getTime() - this.start.getTime();
    },

    setAutoCenter: (enabled: boolean) => set({ autoCenter: enabled }),
    toggleAutoCenter: () => set((state: any) => ({ autoCenter: !state.autoCenter })),
  };
});
