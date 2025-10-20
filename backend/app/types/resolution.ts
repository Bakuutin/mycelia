import ms from "ms";

export type Resolution = "5min" | "1hour" | "1day" | "1week";

export const RESOLUTION_TO_MS: Record<Resolution, number> = {
  "5min": ms("5m"),
  "1hour": ms("1h"),
  "1day": ms("1d"),
  "1week": ms("1w"),
};

export const RESOLUTION_ORDER: Resolution[] = Object.keys(
  RESOLUTION_TO_MS,
) as Resolution[];

export const LOWEST_RESOLUTION: Resolution = RESOLUTION_ORDER[0];
export const HIGHEST_RESOLUTION: Resolution =
  RESOLUTION_ORDER[RESOLUTION_ORDER.length - 1];
