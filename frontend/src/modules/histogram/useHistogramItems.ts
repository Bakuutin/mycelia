import { useCallback, useEffect, useMemo } from "react";
import _ from "lodash";
import { getResolutionForDuration, RESOLUTION_TO_MS } from "@/lib/resolution";
import { useHistogramCache, type HistogramItem } from "./useHistogramCache";
import { useWebSocketSubscription } from "@/hooks/useWebSocket";

export type { HistogramItem };

export function useHistogramItems(start: Date, end: Date) {
  const {
    data,
    fetchMissingRanges,
    indexByResolution,
    ensureIndex,
    invalidateAll,
  } = useHistogramCache();

  const duration = end.getTime() - start.getTime();
  const resolution = getResolutionForDuration(duration);

  const binSize = RESOLUTION_TO_MS[resolution];
  const queryStart = new Date(start.getTime() - duration - binSize);
  const queryEnd = new Date(end.getTime() + duration + binSize);

  const debouncedFetchMissingRanges = useCallback(
    _.debounce((resolution, start, end) => {
      fetchMissingRanges(resolution, start, end);
    }, 300),
    [fetchMissingRanges],
  );

  useEffect(() => {
    debouncedFetchMissingRanges(
      resolution,
      queryStart.getTime(),
      queryEnd.getTime(),
    );
  }, [resolution, queryStart.getTime(), queryEnd.getTime()]);

  useWebSocketSubscription(
    "mongo:histogram",
    (message) => {
      const { event, data } = message;
      if (!data || event !== "mongo.change") return;

      const { collection } = data;
      if (!collection || !collection.startsWith("histogram_")) return;

      invalidateAll();
    },
    true,
  );

  const filteredItems = useMemo(() => {
    ensureIndex(resolution);
    const idx = indexByResolution[resolution];
    if (!idx) {
      return data[resolution]?.items ?? [];
    }
    idx.tsDim.filterRange([queryStart.getTime(), queryEnd.getTime()]);
    const rows = idx.tsDim.top(Infinity) as HistogramItem[];
    idx.tsDim.filterAll();
    return rows;
  }, [
    indexByResolution[resolution]?.cf,
    data[resolution]?.items,
    queryStart.getTime(),
    queryEnd.getTime(),
  ]);

  return {
    items: filteredItems,
    resolution,
  };
}
