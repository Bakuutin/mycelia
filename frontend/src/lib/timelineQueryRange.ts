export interface TimelineRangeMs {
  start: number;
  end: number;
}

export interface TimelineQueryRange extends TimelineRangeMs {
  alignmentMs: number;
}

export function resolveTimelineQueryRange(
  visible: TimelineRangeMs,
  previous: TimelineQueryRange | undefined,
  alignmentMs: number,
): TimelineQueryRange {
  const alignment = Math.max(1, Math.round(alignmentMs));
  if (
    previous?.alignmentMs === alignment &&
    visible.start >= previous.start &&
    visible.end <= previous.end
  ) {
    return previous;
  }

  const duration = Math.max(visible.end - visible.start, alignment);
  const padding = Math.min(duration / 2, alignment * 2);
  return {
    start: Math.floor((visible.start - padding) / alignment) * alignment,
    end: Math.ceil((visible.end + padding) / alignment) * alignment,
    alignmentMs: alignment,
  };
}
