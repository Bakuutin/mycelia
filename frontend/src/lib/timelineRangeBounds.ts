export interface TimelineDataRange {
  start?: string | Date | null;
  end?: string | Date | null;
}

function validDate(value: string | Date | null | undefined): Date | undefined {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : undefined;
}

export function combineTimelineDataRanges(
  ranges: TimelineDataRange[],
): { start: Date; end: Date } | undefined {
  const starts = ranges.flatMap((range) => {
    const start = validDate(range.start);
    return start ? [start] : [];
  });
  const ends = ranges.flatMap((range) => {
    const end = validDate(range.end);
    return end ? [end] : [];
  });
  if (starts.length === 0 || ends.length === 0) return undefined;
  return {
    start: new Date(Math.min(...starts.map((date) => date.getTime()))),
    end: new Date(Math.max(...ends.map((date) => date.getTime()))),
  };
}
