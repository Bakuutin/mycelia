import { create } from "zustand";

export interface TimelineRangeStore {
  start: Date;
  end: Date;
  setStart: (start: Date) => void;
  setEnd: (end: Date) => void;
  setRange: (start: Date, end: Date) => void;
  reset: () => void;
  duration: number;
}

const day = 1000 * 60 * 60 * 24;

function getDaysAgo(n: number) {
  const today = new Date(new Date().toISOString().split("T")[0]);
  const monthAgo = new Date(today.getTime() - n * day);
  return monthAgo;
}

function getInitialValuesFromURL() {
  if (typeof window === 'undefined') {
    return { start: getDaysAgo(30), end: new Date() };
  }

  const urlParams = new URLSearchParams(globalThis.location.search);
  const startParam = urlParams.get("start");
  const endParam = urlParams.get("end");

  let start: Date;
  let end: Date;

  if (startParam) {
    const startTime = parseInt(startParam);
    if (!isNaN(startTime)) {
      start = new Date(startTime);
    } else {
      start = getDaysAgo(30);
    }
  } else {
    start = getDaysAgo(30);
  }

  if (endParam) {
    const endTime = parseInt(endParam);
    if (!isNaN(endTime)) {
      end = new Date(endTime);
    } else {
      end = new Date();
    }
  } else {
    end = new Date();
  }

  return { start, end };
}

export const useTimelineRange = create<TimelineRangeStore>((set) => {
    const { start, end } = getInitialValuesFromURL();
    
    return {
        start,
        end,
        
        setStart: (start: Date) => set({ start }),
        
        setEnd: (end: Date) => set({ end }),
        
        setRange: (start: Date, end: Date) => set({ start, end }),
        
        reset: () => set({ 
            start: new Date(), 
            end: new Date() 
        }),

        get duration() {
            return this.end.getTime() - this.start.getTime();
        },
    };
}); 