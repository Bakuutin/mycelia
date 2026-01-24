import { create } from "zustand";
import { z } from "zod";

const zTimelineRangeParams = z.object({
  start: z
    .string()
    .transform((val: string) => {
      const startTime = parseInt(val);
      if (isNaN(startTime)) {
        throw new Error("Invalid start parameter");
      }
      return new Date(startTime);
    })
    .optional(),
  end: z
    .string()
    .transform((val: string) => {
      const endTime = parseInt(val);
      if (isNaN(endTime)) {
        throw new Error("Invalid end parameter");
      }
      return new Date(endTime);
    })
    .optional(),
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
}

const day = 1000 * 60 * 60 * 24;

function getDaysAgo(n: number) {
  const today = new Date(new Date().toISOString().split("T")[0]);
  const monthAgo = new Date(today.getTime() - n * day);
  return monthAgo;
}

function updateURLParams(start: Date, end: Date) {
  if (typeof window === "undefined") return;

  const url = new URL(globalThis.location.href);
  url.searchParams.set("start", start.getTime().toString());
  url.searchParams.set("end", end.getTime().toString());
  globalThis.history.replaceState({}, "", url.toString());
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

export const useTimelineRange = create<TimelineRangeStore>((set, get) => {
  const { start, end } = getInitialValuesFromURL();

  return {
    start,
    end,

    setStart: (start: Date) => {
      set({ start });
      updateURLParams(start, get().end);
    },

    setEnd: (end: Date) => {
      set({ end });
      updateURLParams(get().start, end);
    },

    setRange: (start: Date, end: Date) => {
      set({ start, end });
      updateURLParams(start, end);
    },

    reset: () => {
      const start = new Date();
      const end = new Date();
      set({ start, end });
      updateURLParams(start, end);
    },

    get center() {
      return new Date((this.start.getTime() + this.end.getTime()) / 2);
    },

    get duration() {
      return this.end.getTime() - this.start.getTime();
    },
  };
});
