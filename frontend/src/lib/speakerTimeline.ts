export type SpeakerTimelineState =
  | "matched"
  | "rejected"
  | "uncertain"
  | "unclassified";

export type SpeakerTimelineValidity =
  | "verified"
  | "provisional"
  | "manual";

export type SpeakerTimelineFilters = {
  states?: SpeakerTimelineState[];
  validities?: SpeakerTimelineValidity[];
};

export type SpeakerTimelineInterval = {
  segmentId: string;
  start: Date | string | number;
  end: Date | string | number;
  state: SpeakerTimelineState;
  validity?: SpeakerTimelineValidity;
  profileId?: string;
};

export type SpeakerTimelineBucket = {
  start: Date | string | number;
  end: Date | string | number;
  counts: Partial<Record<SpeakerTimelineState, number>>;
  validityCounts?: Partial<Record<SpeakerTimelineValidity, number>>;
  dominantState?: SpeakerTimelineState;
  dominantValidity?: SpeakerTimelineValidity;
};

export type SpeakerTimelineSummary = {
  mode: "intervals" | "buckets";
  status: "ready" | "no_data";
  reason?: string;
  profile?: { id: string; name?: string };
  calibration?: { id: string; status: "full" | "pilot" };
  intervals?: SpeakerTimelineInterval[];
  buckets?: SpeakerTimelineBucket[];
  truncated?: boolean;
  totals: {
    segments: number;
    matched: number;
    rejected: number;
    uncertain: number;
    unclassified: number;
    verified?: number;
    provisional?: number;
  };
};

export function buildSpeakerTimelineSummaryRequest(input: {
  start: Date;
  end: Date;
  detail: "intervals" | "buckets";
  bucketMs: number;
  filters: SpeakerTimelineFilters;
}) {
  return {
    action: "speaker-timeline-summary" as const,
    start: input.start,
    end: input.end,
    detail: input.detail,
    bucketMs: input.bucketMs,
    filters: input.filters,
  };
}

export function dominantSpeakerBucket(bucket: SpeakerTimelineBucket): {
  state: SpeakerTimelineState;
  validity?: SpeakerTimelineValidity;
} {
  const state = bucket.dominantState ??
    (Object.entries(bucket.counts).sort((a, b) => b[1] - a[1])[0]?.[0] as
      | SpeakerTimelineState
      | undefined) ??
    "unclassified";
  const validity = bucket.dominantValidity ??
    (bucket.validityCounts
      ? Object.entries(bucket.validityCounts).sort((a, b) => b[1] - a[1])[0]
        ?.[0] as SpeakerTimelineValidity | undefined
      : undefined);
  return { state, validity };
}

export function hasSpeakerTimelineData(
  summary?: SpeakerTimelineSummary,
): boolean {
  return Boolean(
    summary &&
      (summary.totals.segments > 0 ||
        (summary.intervals?.length ?? 0) > 0 ||
        (summary.buckets?.length ?? 0) > 0),
  );
}
