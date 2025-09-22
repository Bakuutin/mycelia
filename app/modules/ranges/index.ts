
import crossfilter from "npm:crossfilter2";
import { useMemo, useRef } from "react";
import type { TimelineItem } from "@/types/timeline.ts";
import { useTimelineRange } from "@/stores/timelineRange.ts";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

const FIVE_MINUTES = 5 * MINUTE;
const ONE_HOUR = HOUR;
const ONE_DAY = DAY;
const ONE_WEEK = WEEK;

const RESOLUTION_TO_MS: Record<Resolution, number> = {
  "5min": FIVE_MINUTES,
  "1hour": ONE_HOUR,
  "1day": ONE_DAY,
  "1week": ONE_WEEK,
};

export type Resolution = "5min" | "1hour" | "1day" | "1week";

export type BucketSummary = {
  count: number;
  totalDurationMs: number;
  speechProbabilityMax: number;
  speechProbabilityAvg: number;
  hasSpeech: number;
};

export type BucketResult = {
  key: number;
  value: BucketSummary;
};

function toBucketStart(timestampMs: number, bucketMs: number): number {
  return Math.floor(timestampMs / bucketMs) * bucketMs;
}

export function useBucketedTimeline(
  items: TimelineItem[],
  bucketMs: number,
) {
  const cfRef = useRef(crossfilter([]));

  useMemo(() => {
    cfRef.current.remove();
    const crossfilterItems = items.map((item: TimelineItem) => ({
      id: item.id,
      timestamp: item.start.getTime(),
      durationMs: item.end.getTime() - item.start.getTime(),
      speechProbabilityMax: item.totals?.audio_chunks?.speech_probability_max || 0,
      speechProbabilityAvg: item.totals?.audio_chunks?.speech_probability_avg || 0,
      hasSpeech: item.totals?.audio_chunks?.has_speech || 0,
      count: item.totals?.audio_chunks?.count || 0,
    }));
    cfRef.current.add(crossfilterItems);
  }, [items]);

  const timestampDim = useMemo(() => {
    return cfRef.current.dimension((d: any) => d.timestamp);
  }, []);

  const bucketDim = useMemo(() => {
    timestampDim.dispose?.();
    return cfRef.current.dimension((d: any) => toBucketStart(d.timestamp, bucketMs));
  }, [bucketMs]);

  const bucketGroup = useMemo(() => {
    const add = (p: BucketSummary, v: any) => {
      p.count += v.count || 1;
      p.totalDurationMs += v.durationMs || 0;
      p.speechProbabilityMax = Math.max(p.speechProbabilityMax, v.speechProbabilityMax || 0);
      p.speechProbabilityAvg = ((p.speechProbabilityAvg * (p.count - 1)) + (v.speechProbabilityAvg || 0)) / p.count;
      p.hasSpeech += v.hasSpeech || 0;
      return p;
    };
    const remove = (p: BucketSummary, v: any) => {
      p.count -= v.count || 1;
      p.totalDurationMs -= v.durationMs || 0;
      if (p.count > 0) {
        p.speechProbabilityAvg = ((p.speechProbabilityAvg * (p.count + 1)) - (v.speechProbabilityAvg || 0)) / p.count;
      } else {
        p.speechProbabilityMax = 0;
        p.speechProbabilityAvg = 0;
      }
      p.hasSpeech -= v.hasSpeech || 0;
      return p;
    };
    const init = (): BucketSummary => ({
      count: 0,
      totalDurationMs: 0,
      speechProbabilityMax: 0,
      speechProbabilityAvg: 0,
      hasSpeech: 0,
    });
    return bucketDim.group().reduce(add, remove, init);
  }, [bucketDim]);

  return { cf: cfRef.current, timestampDim, bucketDim, bucketGroup };
}

export function useSummaryBuckets(
  items: TimelineItem[],
  resolution: Resolution,
  visible?: { startMs: number; endMs: number },
): BucketResult[] {
  const bucketMs = RESOLUTION_TO_MS[resolution];
  const { timestampDim, bucketDim, bucketGroup } = useBucketedTimeline(items, bucketMs);

  useMemo(() => {
    if (visible) {
      timestampDim.filterRange([visible.startMs, visible.endMs]);
    } else {
      timestampDim.filterAll();
    }
  }, [visible?.startMs, visible?.endMs, timestampDim]);

  const results = useMemo(() => {
    const rawResults = bucketGroup.all();
    return rawResults.filter((bucket: BucketResult) => bucket.value.count > 0);
  }, [bucketGroup, visible?.startMs, visible?.endMs]);

  return results;
}

export function useTimelineRangeBuckets(
  items: TimelineItem[],
  resolution: Resolution,
  visibleStartMs: number,
  visibleEndMs: number,
): BucketResult[] {
  return useSummaryBuckets(items, resolution, {
    startMs: visibleStartMs,
    endMs: visibleEndMs,
  });
}

export function useTimelineRangeIntegration(
  items: TimelineItem[],
  resolution: Resolution,
) {
  const { start, end } = useTimelineRange();
  const visibleStartMs = start.getTime();
  const visibleEndMs = end.getTime();

  return useTimelineRangeBuckets(items, resolution, visibleStartMs, visibleEndMs);
}

