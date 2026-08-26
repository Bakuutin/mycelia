import { useEffect, useMemo, useState } from "react";
import type { MapTimelineSummary } from "@/types/location";

export function MapTimeNavigator({
  summary,
  start,
  end,
  cursor,
  onCommitRange,
  onSelectTime,
}: {
  summary: MapTimelineSummary | undefined;
  start: Date;
  end: Date;
  cursor?: Date;
  onCommitRange: (start: Date, end: Date) => void;
  onSelectTime: (time: Date) => void;
}) {
  const dataStart = summary
    ? new Date(summary.dataRange.start).getTime()
    : start.getTime();
  const dataEnd = summary
    ? new Date(summary.dataRange.end).getTime()
    : end.getTime();
  const [draftStart, setDraftStart] = useState(start.getTime());
  const [draftEnd, setDraftEnd] = useState(end.getTime());
  useEffect(() => setDraftStart(start.getTime()), [start.getTime()]);
  useEffect(() => setDraftEnd(end.getTime()), [end.getTime()]);
  const maxValue = Math.max(dataStart + 1, dataEnd);
  const maxDwell = Math.max(
    1,
    ...(summary?.buckets ?? []).map((bucket) => bucket.dwellMs),
  );
  const maxConversations = Math.max(
    1,
    ...(summary?.buckets ?? []).map((bucket) => bucket.conversationCount),
  );
  const commit = () => {
    const from = Math.min(draftStart, draftEnd - 1);
    const to = Math.max(draftEnd, from + 1);
    onCommitRange(new Date(from), new Date(to));
  };
  const cursorLeft = useMemo(() => {
    if (!cursor || maxValue <= dataStart) return undefined;
    return `${
      ((cursor.getTime() - dataStart) / (maxValue - dataStart)) * 100
    }%`;
  }, [cursor?.getTime(), dataStart, maxValue]);

  return (
    <div className="relative h-20 rounded-md border bg-background/95 px-2 pb-7 pt-2">
      <div className="flex h-10 items-end gap-px overflow-hidden">
        {(summary?.buckets ?? []).map((bucket, index) => {
          const dwell = Math.max(2, bucket.dwellMs / maxDwell * 34);
          const conversation = Math.max(
            0,
            bucket.conversationCount / maxConversations * 34,
          );
          return (
            <button
              type="button"
              key={new Date(bucket.start).getTime()}
              className="relative min-w-px flex-1 rounded-t bg-teal-500/60 hover:bg-teal-400"
              style={{ height: dwell }}
              title={`${
                new Date(bucket.start).toLocaleDateString()
              } · ${bucket.stayCount} stays · ${bucket.conversationCount} conversations`}
              onClick={() =>
                onSelectTime(
                  new Date(
                    (new Date(bucket.start).getTime() +
                      new Date(bucket.end).getTime()) / 2,
                  ),
                )}
            >
              {conversation > 0 && (
                <span
                  className="absolute inset-x-0 bottom-0 rounded-t bg-violet-500/85"
                  style={{ height: conversation }}
                />
              )}
              <span className="sr-only">Bucket {index + 1}</span>
            </button>
          );
        })}
      </div>
      {cursorLeft && (
        <span
          className="pointer-events-none absolute bottom-6 top-1 w-0.5 bg-amber-500"
          style={{ left: cursorLeft }}
        />
      )}
      <input
        aria-label="Selected period start"
        type="range"
        min={dataStart}
        max={maxValue}
        value={Math.max(dataStart, Math.min(draftStart, maxValue))}
        onChange={(event) =>
          setDraftStart(
            Math.min(Number(event.currentTarget.value), draftEnd - 1),
          )}
        onPointerUp={commit}
        onKeyUp={commit}
        className="absolute inset-x-2 bottom-4 h-2 cursor-ew-resize accent-teal-600"
      />
      <input
        aria-label="Selected period end"
        type="range"
        min={dataStart}
        max={maxValue}
        value={Math.max(dataStart, Math.min(draftEnd, maxValue))}
        onChange={(event) =>
          setDraftEnd(
            Math.max(Number(event.currentTarget.value), draftStart + 1),
          )}
        onPointerUp={commit}
        onKeyUp={commit}
        className="absolute inset-x-2 bottom-1 h-2 cursor-ew-resize accent-violet-600"
      />
    </div>
  );
}
