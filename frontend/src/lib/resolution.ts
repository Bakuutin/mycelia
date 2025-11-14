export type Resolution = "5min" | "1hour" | "1day" | "1week";

export const RESOLUTION_TO_MS: Record<Resolution, number> = {
  "5min": 5 * 60 * 1000, // 5 minutes
  "1hour": 60 * 60 * 1000, // 1 hour
  "1day": 24 * 60 * 60 * 1000, // 1 day
  "1week": 7 * 24 * 60 * 60 * 1000, // 1 week
};

const day = 1000 * 60 * 60 * 24;

/**
 * Determines the appropriate resolution based on timeline range duration.
 * Similar to logic in backend/app/modules/audio/index.tsx
 */
export function getResolutionForDuration(duration: number): Resolution {
  if (duration > 300 * day) {
    return "1week";
  } else if (duration > 50 * day) {
    return "1day";
  } else if (duration > day) {
    return "1hour";
  } else {
    return "5min";
  }
}

