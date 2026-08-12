import { useEffect, useMemo, useState } from "react";
import {
  resolveTimelineQueryRange,
  type TimelineQueryRange,
} from "@/lib/timelineQueryRange";

export function useTimelineQueryRange(
  start: Date,
  end: Date,
  alignmentMs: number,
  delayMs = 300,
): { start: Date; end: Date; alignmentMs: number } {
  const startMs = start.getTime();
  const endMs = end.getTime();
  const [queryRange, setQueryRange] = useState<TimelineQueryRange>(() =>
    resolveTimelineQueryRange(
      { start: startMs, end: endMs },
      undefined,
      alignmentMs,
    )
  );

  useEffect(() => {
    const timeout = globalThis.setTimeout(() => {
      setQueryRange((previous) =>
        resolveTimelineQueryRange(
          { start: startMs, end: endMs },
          previous,
          alignmentMs,
        )
      );
    }, delayMs);
    return () => globalThis.clearTimeout(timeout);
  }, [alignmentMs, delayMs, endMs, startMs]);

  return useMemo(() => ({
    start: new Date(queryRange.start),
    end: new Date(queryRange.end),
    alignmentMs: queryRange.alignmentMs,
  }), [queryRange]);
}
