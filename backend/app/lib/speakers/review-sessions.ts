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

export type ReviewDecisionSummary = {
  decisionId: string;
  profileId: string | null;
  profileName: string | null;
  excludedProfileIds: string[];
  excludedProfileNames: string[];
  source: "manual";
  updatedAt: Date | string | null;
};

export function latestReviewAnnotationsBySegment<
  T extends {
    segmentId?: unknown;
    updatedAt?: Date | string | null;
    createdAt?: Date | string | null;
  },
>(annotations: T[]): T[] {
  const sorted = [...annotations].sort((a, b) => {
    const aTime = new Date(a.updatedAt ?? a.createdAt ?? 0).getTime();
    const bTime = new Date(b.updatedAt ?? b.createdAt ?? 0).getTime();
    return bTime - aTime;
  });
  const latest = new Map<string, T>();
  for (const annotation of sorted) {
    const segmentId = String(annotation.segmentId ?? "");
    if (segmentId && !latest.has(segmentId)) latest.set(segmentId, annotation);
  }
  return [...latest.values()];
}

export function applyReviewDecisionRevision<
  T extends { segmentId: unknown; status: string; decisionId?: unknown },
>(
  window: T[],
  input: {
    segmentIds: string[];
    replacesDecisionId: string;
    decisionId: unknown;
  },
): T[] {
  const selected = new Set(input.segmentIds);
  for (const segmentId of selected) {
    const item = window.find((candidate) =>
      String(candidate.segmentId) === segmentId
    );
    if (
      !item || item.status !== "reviewed" ||
      String(item.decisionId ?? "") !== input.replacesDecisionId
    ) {
      throw new Error("Review decision changed elsewhere; reload to continue");
    }
  }
  return window.map((item) =>
    selected.has(String(item.segmentId))
      ? { ...item, decisionId: input.decisionId }
      : item
  );
}

export function restoreReviewDecision<
  T extends { segmentId: unknown; status: string; decisionId?: unknown },
>(
  window: T[],
  input: { segmentIds: unknown[]; decisionId: string },
): { window: T[]; restoredCount: number; firstRestored: unknown | null } {
  const selected = new Set(input.segmentIds.map(String));
  const restoredItems = window.filter((item) =>
    selected.has(String(item.segmentId)) &&
    String(item.decisionId ?? "") === input.decisionId
  );
  if (restoredItems.length === 0) {
    throw new Error("Review decision is no longer current; reload to continue");
  }
  return {
    window: window.map((item) =>
      restoredItems.includes(item)
        ? { ...item, status: "pending", decisionId: null }
        : item
    ),
    restoredCount: restoredItems.length,
    firstRestored: restoredItems[0]?.segmentId ?? null,
  };
}

export function attachReviewDecisionSummaries<
  T extends { decisionId?: unknown },
>(
  window: T[],
  decisions: Array<{
    _id: unknown;
    profileId?: unknown;
    excludedProfileIds?: unknown[];
    source?: unknown;
    updatedAt?: Date | string | null;
  }>,
  profiles: Array<{ _id: unknown; name?: string | null }>,
): Array<T & { decisionSummary?: ReviewDecisionSummary }> {
  const profileNames = new Map(
    profiles.map((
      profile,
    ) => [String(profile._id), profile.name ?? "Deleted profile"]),
  );
  const decisionsById = new Map(
    decisions.map((decision) => [String(decision._id), decision]),
  );
  return window.map((item) => {
    const decisionId = String(item.decisionId ?? "");
    const decision = decisionsById.get(decisionId);
    if (!decision) return item;
    const profileId = decision.profileId ? String(decision.profileId) : null;
    const excludedProfileIds = (decision.excludedProfileIds ?? []).map(String);
    return {
      ...item,
      decisionSummary: {
        decisionId,
        profileId,
        profileName: profileId
          ? profileNames.get(profileId) ?? "Deleted profile"
          : null,
        excludedProfileIds,
        excludedProfileNames: excludedProfileIds.map((id) =>
          profileNames.get(id) ?? "Deleted profile"
        ),
        source: "manual" as const,
        updatedAt: decision.updatedAt ?? null,
      },
    };
  });
}

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
