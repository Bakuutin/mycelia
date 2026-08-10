export type ReviewSegment = {
  _id: unknown;
  original_id?: unknown;
  original?: unknown;
  runId?: string | null;
  embeddingSpaceId?: string | null;
  speaker?: string | null;
  start: Date | string;
  end: Date | string;
};

export type ReviewGroup = {
  groupId: string;
  segmentIds: string[];
  originalId: string;
  runId: string | null;
  embeddingSpaceId: string | null;
  speaker: string | null;
  start: Date;
  end: Date;
  durationSeconds: number;
};

export type ReviewGroupingOptions = {
  maxGapSeconds?: number;
  maxDurationSeconds?: number;
  maxSegments?: number;
};

const DEFAULT_GROUPING = {
  maxGapSeconds: 2,
  maxDurationSeconds: 30,
  maxSegments: 20,
} as const;

function segmentKey(segment: ReviewSegment) {
  return {
    originalId: String(segment.original_id ?? segment.original ?? ""),
    runId: segment.runId ?? null,
    embeddingSpaceId: segment.embeddingSpaceId ?? null,
    speaker: segment.speaker ?? null,
  };
}

function isCompatible(
  group: ReviewGroup,
  segment: ReviewSegment,
  options: Required<ReviewGroupingOptions>,
): boolean {
  const key = segmentKey(segment);
  const start = new Date(segment.start);
  const end = new Date(segment.end);
  if (!key.speaker || !group.speaker) return false;
  if (
    group.originalId !== key.originalId || group.runId !== key.runId ||
    group.embeddingSpaceId !== key.embeddingSpaceId ||
    group.speaker !== key.speaker
  ) return false;
  if ((start.getTime() - group.end.getTime()) / 1_000 > options.maxGapSeconds) {
    return false;
  }
  if (
    (end.getTime() - group.start.getTime()) / 1_000 > options.maxDurationSeconds
  ) {
    return false;
  }
  return group.segmentIds.length < options.maxSegments;
}

export function groupReviewSegments(
  input: ReviewSegment[],
  overrides: ReviewGroupingOptions = {},
): ReviewGroup[] {
  const options = { ...DEFAULT_GROUPING, ...overrides };
  const segments = [...input].sort((a, b) =>
    new Date(a.start).getTime() - new Date(b.start).getTime()
  );
  const groups: ReviewGroup[] = [];

  for (const segment of segments) {
    const start = new Date(segment.start);
    const end = new Date(segment.end);
    const previous = groups.at(-1);
    if (previous && isCompatible(previous, segment, options)) {
      previous.segmentIds.push(String(segment._id));
      if (end > previous.end) previous.end = end;
      previous.durationSeconds = Math.max(
        0,
        (previous.end.getTime() - previous.start.getTime()) / 1_000,
      );
      continue;
    }

    const key = segmentKey(segment);
    groups.push({
      groupId: `group-${groups.length + 1}`,
      segmentIds: [String(segment._id)],
      ...key,
      start,
      end,
      durationSeconds: Math.max(0, (end.getTime() - start.getTime()) / 1_000),
    });
  }

  return groups;
}
