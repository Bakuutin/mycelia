import crossfilter from "crossfilter2";
import { useMemo, useRef } from "react";

export type BucketSummary = {
  count: number;
  totalDurationMs: number;
};

export function toBucketStart(timestampMs: number, bucketMs: number): number {
  return Math.floor(timestampMs / bucketMs) * bucketMs;
}

export function useBucketedTimeline(
  items: { id: string; timestamp: number; durationMs?: number }[],
  bucketMs: number,
) {
  const cfRef = useRef<any>(crossfilter([]));

  useMemo(() => {
    cfRef.current.remove();
    cfRef.current.add(items);
  }, [items]);

  const tsDim = useMemo(() => cfRef.current.dimension((d: any) => d.timestamp), []);

  const bucketDim = useMemo(() => {
    return cfRef.current.dimension((d: any) => toBucketStart(d.timestamp, bucketMs));
  }, [bucketMs]);

  const group = useMemo(() => {
    const add = (p: BucketSummary, v: any) => {
      p.count += 1;
      p.totalDurationMs += v.durationMs ?? 0;
      return p;
    };
    const remove = (p: BucketSummary, v: any) => {
      p.count -= 1;
      p.totalDurationMs -= v.durationMs ?? 0;
      return p;
    };
    const init = (): BucketSummary => ({ count: 0, totalDurationMs: 0 });
    return bucketDim.group().reduce(add, remove, init);
  }, [bucketDim]);

  return { cf: cfRef.current, tsDim, bucketDim, group };
}

export function useSummaryBuckets(
  items: { id: string; timestamp: number; durationMs?: number }[],
  bucketMs: number,
  visible?: { startMs: number; endMs: number },
) {
  const { tsDim, bucketDim, group } = useBucketedTimeline(items, bucketMs);

  useMemo(() => {
    if (!visible) {
      tsDim.filterAll();
      bucketDim.filterAll();
      return;
    }
    const startKey = toBucketStart(visible.startMs, bucketMs);
    const endKey = toBucketStart(visible.endMs, bucketMs) + bucketMs;
    bucketDim.filterRange([startKey, endKey]);
  }, [visible?.startMs, visible?.endMs, bucketMs]);

  return group.all();
}


