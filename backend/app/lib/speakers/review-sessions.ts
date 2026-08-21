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

export type ReviewQualityOptions = {
  minDurationSeconds?: number;
  deduplicateOverlaps?: boolean;
  duplicateOverlapRatio?: number;
};

export type ReviewQualityStats = {
  input: number;
  accepted: number;
  shortExcluded: number;
  duplicateExcluded: number;
};

export type ReviewDecisionSummary = {
  decisionId: string;
  outcome: "assigned" | "skipped";
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
      !item || !["reviewed", "skipped"].includes(item.status) ||
      String(item.decisionId ?? "") !== input.replacesDecisionId
    ) {
      throw new Error("Review decision changed elsewhere; reload to continue");
    }
  }
  return window.map((item) =>
    selected.has(String(item.segmentId))
      ? { ...item, status: "reviewed", decisionId: input.decisionId }
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
    outcome?: unknown;
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
        outcome: decision.outcome === "skipped" ? "skipped" : "assigned",
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

const DEFAULT_QUALITY = {
  minDurationSeconds: 1,
  deduplicateOverlaps: true,
  duplicateOverlapRatio: 0.8,
} as const;

function durationMs(segment: ReviewSegment): number {
  return Math.max(
    0,
    new Date(segment.end).getTime() - new Date(segment.start).getTime(),
  );
}

function overlapRatio(a: ReviewSegment, b: ReviewSegment): number {
  const intersection = Math.max(
    0,
    Math.min(new Date(a.end).getTime(), new Date(b.end).getTime()) -
      Math.max(new Date(a.start).getTime(), new Date(b.start).getTime()),
  );
  const shorter = Math.min(durationMs(a), durationMs(b));
  return shorter > 0 ? intersection / shorter : 0;
}

function qualityRecordingKey(segment: ReviewSegment): string {
  const originalId = String(segment.original_id ?? segment.original ?? "");
  if (!originalId) return `segment:${String(segment._id)}`;
  return [
    originalId,
    segment.runId ?? "",
    segment.embeddingSpaceId ?? "",
  ].join(":");
}

export function prepareReviewCandidates<T extends ReviewSegment>(
  input: T[],
  overrides: ReviewQualityOptions = {},
): {
  candidates: Array<T & { reviewQuality?: { duplicateCount: number } }>;
  stats: ReviewQualityStats;
} {
  const options = { ...DEFAULT_QUALITY, ...overrides };
  const minimumMs = Math.max(0, options.minDurationSeconds * 1_000);
  const sorted = [...input].sort((a, b) =>
    new Date(a.start).getTime() - new Date(b.start).getTime()
  );
  const shortExcluded = sorted.filter((segment) =>
    durationMs(segment) < minimumMs
  );
  const eligible = sorted.filter((segment) => durationMs(segment) >= minimumMs);
  if (!options.deduplicateOverlaps) {
    return {
      candidates: eligible,
      stats: {
        input: input.length,
        accepted: eligible.length,
        shortExcluded: shortExcluded.length,
        duplicateExcluded: 0,
      },
    };
  }

  const accepted: Array<T & { reviewQuality?: { duplicateCount: number } }> =
    [];
  let duplicateExcluded = 0;
  for (const candidate of eligible) {
    const key = qualityRecordingKey(candidate);
    const duplicateIndex = accepted.findLastIndex((previous) => {
      if (qualityRecordingKey(previous) !== key) return false;
      if (new Date(previous.end) <= new Date(candidate.start)) return false;
      return overlapRatio(previous, candidate) >=
        options.duplicateOverlapRatio;
    });
    if (duplicateIndex < 0) {
      accepted.push(candidate);
      continue;
    }
    duplicateExcluded += 1;
    const previous = accepted[duplicateIndex];
    const previousDuplicateCount = previous.reviewQuality?.duplicateCount ?? 0;
    if (durationMs(candidate) > durationMs(previous)) {
      accepted[duplicateIndex] = {
        ...candidate,
        reviewQuality: { duplicateCount: previousDuplicateCount + 1 },
      };
    } else {
      previous.reviewQuality = { duplicateCount: previousDuplicateCount + 1 };
    }
  }

  return {
    candidates: accepted.sort((a, b) =>
      new Date(a.start).getTime() - new Date(b.start).getTime()
    ),
    stats: {
      input: input.length,
      accepted: accepted.length,
      shortExcluded: shortExcluded.length,
      duplicateExcluded,
    },
  };
}

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
