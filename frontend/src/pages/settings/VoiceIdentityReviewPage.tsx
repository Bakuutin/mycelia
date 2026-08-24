import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { callResource } from "@/lib/api";
import { normalizeObjectId } from "@/lib/diarization";
import { getSpeakerIdentityProgressView } from "@/lib/speakerIdentityProgress";
import {
  orderVoiceProfilesByRecent,
  readRecentVoiceProfileIds,
  rememberVoiceProfile,
} from "@/lib/voiceProfiles";
import {
  loadVoiceIdentityStatus,
  loadVoiceProfiles,
  voiceIdentityKeys,
} from "@/lib/voiceIdentity";
import { useAudioPlaybackStore } from "@/stores/audioPlaybackStore";
import {
  preloadWaveformAudio,
  WaveformPlayer,
} from "@/components/audio/WaveformPlayer";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  Plus,
  RefreshCw,
} from "lucide-react";
import {
  buildVoiceReviewAudioUrl,
  VoiceIdentityReviewPlayer,
  type VoiceIdentityReviewSegment,
} from "./VoiceIdentityReviewPlayer";

const AUTO_PLAY_STORAGE_KEY = "voice-identity-review-autoplay-next";
const RECOMMENDED_CALIBRATION_PRECISION = 0.98;
const CALIBRATION_PRECISION_PRESETS = [
  { value: 0.98, label: "98%", detail: "Recommended" },
  { value: 0.95, label: "95%", detail: "Pilot" },
  { value: 0.9, label: "90%", detail: "Exploratory" },
] as const;

type ReviewHistoryEntry = {
  decisionId: string;
};

type ReviewWindowItem = {
  segmentId: unknown;
  groupId?: string;
  status: "pending" | "skipped" | "reviewed";
  decisionId?: unknown;
  quality?: { duplicateCount?: number };
  decisionSummary?: {
    decisionId: string;
    outcome: "assigned" | "skipped";
    profileId: string | null;
    profileName: string | null;
    excludedProfileIds: string[];
    excludedProfileNames: string[];
    source: "manual";
    updatedAt: Date | string | null;
  };
};

type ReviewGroup = {
  groupId: string;
  segmentIds: string[];
  start: Date | string;
  end: Date | string;
  durationSeconds: number;
  speaker?: string | null;
};

type ReviewSession = {
  _id: unknown;
  name: string;
  status: "active" | "completed" | "abandoned";
  revision: number;
  targetProfileIds: unknown[];
  window: ReviewWindowItem[];
  groups: ReviewGroup[];
  segments: VoiceIdentityReviewSegment[];
  activeSegmentId?: unknown;
  loadedCount: number;
  windowSize?: number;
  sessionLoadedCount?: number;
  reviewedCount: number;
  skippedCount: number;
  windowReviewedCount?: number;
  windowSkippedCount?: number;
  windowNumber?: number;
  hasMore?: boolean;
  backlogEstimate: number;
  backlogEstimateCapped?: boolean;
  qualityStats?: {
    input: number;
    accepted: number;
    shortExcluded: number;
    duplicateExcluded: number;
  };
  preferences?: {
    autoPlay?: boolean;
    autoAdvanceWindow?: boolean;
    groupMode?: boolean;
    compactMode?: boolean;
  };
  lastOpenedAt?: Date | string;
  querySnapshot: {
    sourceMode?: ReviewSourceMode;
    candidateMode?: "reviewable" | "auto_matched";
    rangeMode: "fixed" | "all_before";
    start: Date | string;
    end: Date | string;
    quality?: {
      minDurationSeconds: number;
      deduplicateOverlaps: boolean;
    };
  };
};

type ReviewSourceMode =
  | "all_matching"
  | "selected_recordings"
  | "timeline_range"
  | "diarization_generation";

type ReviewSourcePayload = {
  sourceMode: ReviewSourceMode;
  targetProfileIds: string[];
  embeddingSpaceIds: string[];
  runIds: string[];
  recordingIds: string[];
  candidateMode: "reviewable" | "auto_matched";
  quality: { minDurationSeconds: number; deduplicateOverlaps: boolean };
  rangeMode: "fixed" | "all_before";
  start?: Date;
  end?: Date;
};

type ReviewSourcePreview = {
  sourceMode: ReviewSourceMode;
  range: { start: Date | string; end: Date | string };
  embeddingSpaceIds: string[];
  runIds: string[];
  recordingIds: string[];
  scope: Omit<ReviewSourcePayload, "start" | "end"> & {
    start: Date | string;
    end: Date | string;
  };
  counts: {
    eligibleSegments: number;
    recordings: number;
    scannedSegments: number;
    capped: boolean;
  };
  qualityStats: {
    input: number;
    accepted: number;
    shortExcluded: number;
    duplicateExcluded: number;
  };
  recordings: Array<{
    id: string;
    name?: string | null;
    path?: string | null;
    eligibleSegments: number;
    start: Date | string;
    end: Date | string;
  }>;
  sampleSegments: VoiceIdentityReviewSegment[];
};

type ReviewHistoryItem = {
  decisionId: string;
  outcome: "assigned" | "skipped";
  assignedProfileId: string | null;
  assignedProfileName: string | null;
  excludedProfileIds: string[];
  excludedProfileNames: string[];
  updatedAt: Date | string | null;
  sessionId: string | null;
  sessionName: string;
  sessionStatus: string | null;
  segment: VoiceIdentityReviewSegment;
};

type ReviewHistoryResponse = {
  items: ReviewHistoryItem[];
  scannedDecisions: number;
  hasMore: boolean;
};

type ReviewSessionSummary = Omit<
  ReviewSession,
  "window" | "groups" | "segments"
>;

type CalibrationPreview = {
  profile: {
    id: string;
    name: string;
    revision: number;
    embeddingSpaceId: string;
  };
  counts: {
    positive: number;
    negative: number;
    total: number;
    recordings: number;
    incompatible: number;
  };
  recordings: Array<{
    id: string;
    positive: number;
    negative: number;
    total: number;
    start: Date | string;
    end: Date | string;
  }>;
  calibrationRecordingIds: string[];
  validationRecordingIds: string[];
  automaticSplit: boolean;
  thresholds: {
    positiveThreshold: number;
    negativeThreshold: number;
    negativeDecisionMode?: "calibrated" | "uncertain_only";
  } | null;
  calibrationMetrics: CalibrationMetrics | null;
  validationMetrics: CalibrationMetrics | null;
  validationIssues?: {
    falsePositive: CalibrationIssue[];
    missedPositive: CalibrationIssue[];
  };
  targetPrecision?: number;
  negativeDecisionMode?: "calibrated" | "uncertain_only";
  recommendedPositiveThreshold?: number | null;
  positiveThresholdSource?: "automatic" | "operator_stricter";
  blockers: string[];
  canValidate: boolean;
};

type CalibrationIssue = {
  kind: "false_positive" | "missed_positive";
  segmentId: string;
  recordingId: string;
  decisionId: string | null;
  sessionId: string | null;
  assignedProfileId: string | null;
  excludedProfileIds: string[];
  updatedAt: Date | string | null;
  label: "positive" | "negative";
  score: number;
  decision: "identified" | "rejected" | "uncertain";
  segment: VoiceIdentityReviewSegment;
};

type CalibrationMetrics = {
  total: number;
  positives: number;
  negatives: number;
  identified: number;
  rejected: number;
  uncertain: number;
  truePositive: number;
  falsePositive: number;
  trueNegative: number;
  falseNegative: number;
  positivePrecision: number;
  positiveRecall: number;
  negativePrecision: number;
  negativeRecall: number;
};

type IdentityStatus = {
  usableCalibration: {
    calibrationId: string;
    status: "validated";
    profileId: string;
    profileRevision: number;
    embeddingSpaceId: string;
    classificationPolicy?: "full" | "pilot";
    targetPrecision?: number;
    maxRangeHours?: number | null;
    negativeDecisionMode?: "calibrated" | "uncertain_only";
    updatedAt?: Date;
  } | null;
  canClassify: boolean;
  blockers: string[];
  labels: {
    sky: number;
    notSky: number;
    total: number;
    recordings: number;
    byRecording?: Array<
      { id: string; sky: number; notSky: number; total: number }
    >;
  };
  calibrations: Array<
    {
      calibrationId: string;
      status: string;
      validity?: "usable" | "stale";
      staleReasons?: string[];
      updatedAt?: Date;
    }
  >;
  latestJob?: {
    _id: unknown;
    state: string;
    progress?: Record<string, number>;
    result?: Record<string, number>;
    failedReason?: string;
  } | null;
  latestCampaign?: {
    campaignId: string;
    status: string;
    processedSegments?: number;
    totalSegments?: number | null;
    pendingSegments?: number | null;
    matched?: number;
    rejected?: number;
    uncertain?: number;
    incompatibleSkipped?: number;
    etaSeconds?: number | null;
    segmentsPerSecond?: number | null;
    batchNumber?: number;
    estimatedBatches?: number;
    currentJobId?: string;
    range?: { start?: Date | string; end?: Date | string };
  } | null;
};

type IdentityClassificationSnapshot = {
  asOf: Date | string;
  classification: {
    identified: number;
    unknown: number;
    uncertain: number;
    provisional?: {
      identified: number;
      unknown: number;
      uncertain: number;
    };
    stale: number;
    unclassified: number;
  };
  calibrationId: string | null;
  classificationPolicy?: "full" | "pilot" | null;
  maxRangeHours?: number | null;
  canRunFullClassification?: boolean;
};

type DiarizationRun = {
  runId: string;
  status: string;
  generation?: number;
  embeddingSpaceId?: string;
  start?: Date | string;
  end?: Date | string;
};

function dateTimeInputValue(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function reviewSourceErrorMessage(error: unknown): string {
  if (
    error instanceof DOMException &&
    ["AbortError", "TimeoutError"].includes(error.name)
  ) {
    return "Preview stopped after 60 seconds. Try a shorter range or retry when Mongo is less busy.";
  }
  const message = error instanceof Error ? error.message : "Unknown error";
  if (/MaxTimeMS|time limit|timed out/i.test(message)) {
    return "The bounded database scan reached its time limit. Retry, choose a shorter range, or wait for heavy diarization writes to finish.";
  }
  return message;
}

export default function VoiceIdentityReviewPage() {
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const timelineSourceStart = Number(searchParams.get("start"));
  const timelineSourceEnd = Number(searchParams.get("end"));
  const timelineSourceAvailable =
    searchParams.get("reviewSource") === "timeline" &&
    Number.isFinite(timelineSourceStart) &&
    Number.isFinite(timelineSourceEnd) &&
    timelineSourceEnd > timelineSourceStart;
  const [calibrationRecordings, setCalibrationRecordings] = useState("");
  const [validationRecordings, setValidationRecordings] = useState("");
  const [calibrationTargetPrecision, setCalibrationTargetPrecision] = useState(
    RECOMMENDED_CALIBRATION_PRECISION,
  );
  const [acceptLowerPrecisionRisk, setAcceptLowerPrecisionRisk] = useState(
    false,
  );
  const [positiveThresholdOverride, setPositiveThresholdOverride] = useState<
    number | null
  >(null);
  const [positiveThresholdDraft, setPositiveThresholdDraft] = useState<
    number | null
  >(null);
  const [calibrationRefreshResult, setCalibrationRefreshResult] = useState<
    {
      state: "success" | "error";
      message: string;
    } | null
  >(null);
  const [history, setHistory] = useState<ReviewHistoryEntry[]>([]);
  const [playOnMount, setPlayOnMount] = useState(false);
  const [editingSegmentId, setEditingSegmentId] = useState<string | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    () => {
      try {
        return localStorage.getItem("voice-identity-review-session");
      } catch {
        return null;
      }
    },
  );
  const [reviewProfileId, setReviewProfileId] = useState<string | null>(null);
  const [showNewSession, setShowNewSession] = useState(false);
  const [newRange, setNewRange] = useState<"14d" | "30d" | "custom" | "all">(
    "14d",
  );
  const [newCandidateMode, setNewCandidateMode] = useState<
    "reviewable" | "auto_matched"
  >("reviewable");
  const [newQualityMode, setNewQualityMode] = useState<"clean" | "all">(
    "clean",
  );
  const [newSourceMode, setNewSourceMode] = useState<ReviewSourceMode>(
    "all_matching",
  );
  const [newRunId, setNewRunId] = useState("");
  const [selectedRecordingIds, setSelectedRecordingIds] = useState<string[]>(
    [],
  );
  const [recordingSearch, setRecordingSearch] = useState("");
  const [sourcePreview, setSourcePreview] = useState<
    ReviewSourcePreview | null
  >(null);
  const [previewedSourcePayload, setPreviewedSourcePayload] = useState<
    ReviewSourcePayload | null
  >(null);
  const [sourcePreviewDirty, setSourcePreviewDirty] = useState(true);
  const sourcePreviewRevisionRef = useRef(0);
  const [sourcePreviewElapsedSeconds, setSourcePreviewElapsedSeconds] =
    useState(0);
  const [newWindowSize, setNewWindowSize] = useState<5 | 10 | 20>(10);
  const [showReviewHistory, setShowReviewHistory] = useState(false);
  const [historyRecordingId, setHistoryRecordingId] = useState<string | null>(
    null,
  );
  const [historyFilter, setHistoryFilter] = useState<
    "all" | "assigned" | "skipped"
  >("all");
  const [sessionItemFilter, setSessionItemFilter] = useState<
    "all" | "pending" | "reviewed" | "skipped" | "short"
  >("all");
  const [historyEditingItem, setHistoryEditingItem] = useState<
    ReviewHistoryItem | null
  >(null);
  const [showCalibrationProblems, setShowCalibrationProblems] = useState(
    false,
  );
  const [calibrationProblemKind, setCalibrationProblemKind] = useState<
    "falsePositive" | "missedPositive"
  >("falsePositive");
  const [calibrationProblemRecordingId, setCalibrationProblemRecordingId] =
    useState<string | null>(null);
  const [calibrationEditingItem, setCalibrationEditingItem] = useState<
    ReviewHistoryItem | null
  >(null);
  const [calibrationEditingPlayOnMount, setCalibrationEditingPlayOnMount] =
    useState(false);
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [autoPlayNext, setAutoPlayNext] = useState(() => {
    try {
      const stored = localStorage.getItem(AUTO_PLAY_STORAGE_KEY);
      return stored === null ? true : stored === "true";
    } catch {
      return true;
    }
  });
  const [recentProfileIds, setRecentProfileIds] = useState(
    readRecentVoiceProfileIds,
  );
  const calibrationSectionRef = useRef<HTMLDivElement>(null);
  const reviewSetupRef = useRef<HTMLDivElement>(null);
  const reviewHistoryRef = useRef<HTMLDivElement>(null);
  const automaticWindowAdvanceRef = useRef(false);
  const timelineSourceAppliedRef = useRef("");

  useEffect(() => {
    if (globalThis.location.hash !== "#calibration") return;
    globalThis.requestAnimationFrame(() => {
      calibrationSectionRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  }, []);

  useEffect(() => {
    if (
      searchParams.get("reviewSource") !== "timeline" ||
      searchParams.get("newSession") !== "1"
    ) return;
    const startMs = timelineSourceStart;
    const endMs = timelineSourceEnd;
    if (!timelineSourceAvailable) return;
    const sourceKey = startMs + ":" + endMs;
    if (timelineSourceAppliedRef.current === sourceKey) return;
    timelineSourceAppliedRef.current = sourceKey;
    setNewSourceMode("timeline_range");
    setNewRange("custom");
    setCustomStart(dateTimeInputValue(new Date(startMs)));
    setCustomEnd(dateTimeInputValue(new Date(endMs)));
    setShowNewSession(true);
    setSourcePreview(null);
    setPreviewedSourcePayload(null);
    setSourcePreviewDirty(true);
    sourcePreviewRevisionRef.current += 1;
  }, [
    searchParams,
    timelineSourceAvailable,
    timelineSourceEnd,
    timelineSourceStart,
  ]);

  const { data: profiles = [] } = useQuery<any[]>({
    queryKey: voiceIdentityKeys.profiles,
    queryFn: loadVoiceProfiles,
  });
  const primary = profiles.find((profile) => profile.is_primary);
  const profileId = normalizeObjectId(primary?._id);
  useEffect(() => {
    if (!reviewProfileId && profileId) setReviewProfileId(profileId);
  }, [profileId, reviewProfileId]);
  const reviewProfile = profiles.find((profile) =>
    normalizeObjectId(profile._id) === reviewProfileId
  );
  useEffect(() => {
    setSourcePreview(null);
    setPreviewedSourcePayload(null);
    setSourcePreviewDirty(true);
    setSelectedRecordingIds([]);
    sourcePreviewRevisionRef.current += 1;
  }, [reviewProfileId]);
  const allProfileOptions = profiles.map((profile) => ({
    id: normalizeObjectId(profile._id) ?? "",
    name: String(profile.name ?? "Unnamed profile"),
  })).filter((profile) => profile.id);
  const alternateProfiles = orderVoiceProfilesByRecent(
    profiles
      .filter((profile) => normalizeObjectId(profile._id) !== reviewProfileId)
      .map((profile) => ({
        id: normalizeObjectId(profile._id) ?? "",
        name: String(profile.name ?? "Unnamed profile"),
      }))
      .filter((profile) => profile.id)
      .sort((a, b) => a.name.localeCompare(b.name)),
    (profile) => profile.id,
    recentProfileIds,
  );
  const rememberAssignedProfile = (assignedProfileId: string) => {
    setRecentProfileIds(rememberVoiceProfile(assignedProfileId));
  };
  const { data: identityStatus, refetch: refetchIdentityStatus } = useQuery<
    IdentityStatus
  >({
    queryKey: voiceIdentityKeys.status(profileId),
    enabled: Boolean(profileId),
    queryFn: () =>
      loadVoiceIdentityStatus(profileId!) as Promise<IdentityStatus>,
    refetchInterval: (query) => {
      const status = (query.state.data as IdentityStatus | undefined)
        ?.latestCampaign?.status;
      return status && ["queued", "counting", "running"].includes(status)
        ? 15_000
        : false;
    },
  });
  const { data: diarizationRuns = [] } = useQuery<DiarizationRun[]>({
    queryKey: ["speaker-runs"],
    queryFn: async () => {
      const value = await callResource("speaker-segments", {
        action: "list-runs",
      });
      return Array.isArray(value) ? value as DiarizationRun[] : [];
    },
    staleTime: 15_000,
  });
  const activeDiarizationRuns = diarizationRuns.filter((run) =>
    run.status === "active"
  );
  useEffect(() => {
    if (!newRunId && activeDiarizationRuns.length > 0) {
      setNewRunId(activeDiarizationRuns[0].runId);
    }
  }, [activeDiarizationRuns, newRunId]);
  const {
    data: classificationSnapshot,
    error: classificationError,
    isFetching: isCalculatingClassification,
    refetch: calculateClassification,
  } = useQuery<IdentityClassificationSnapshot>({
    queryKey: ["speaker-identity-classification"],
    queryFn: () =>
      callResource("speaker-segments", {
        action: "identity-classification",
        profileId,
      }) as Promise<IdentityClassificationSnapshot>,
    enabled: false,
    retry: false,
  });
  const provisionalClassification = classificationSnapshot?.classification
    .provisional;
  const provisionalClassificationTotal = provisionalClassification
    ? provisionalClassification.identified + provisionalClassification.unknown +
      provisionalClassification.uncertain
    : 0;
  const identityCampaignView = identityStatus?.latestCampaign
    ? getSpeakerIdentityProgressView({
      processed: identityStatus.latestCampaign.processedSegments,
      total: identityStatus.latestCampaign.totalSegments,
      remaining: identityStatus.latestCampaign.pendingSegments,
      segmentsPerSecond: identityStatus.latestCampaign.segmentsPerSecond,
      etaSeconds: identityStatus.latestCampaign.etaSeconds,
    })
    : null;
  const { data: pipelineHealth, isLoading: isLoadingHealth } = useQuery<any>({
    queryKey: ["services-health", "voice-identity"],
    queryFn: () =>
      callResource("jobs", {
        action: "services_health",
        force: true,
      }),
    refetchInterval: 30_000,
  });
  const diarizatorHealth = pipelineHealth?.services?.find((service: any) =>
    service.id === "diarizator"
  );
  const diarizatorReady = diarizatorHealth?.status === "healthy";
  const reenrollUnavailableReason = isLoadingHealth
    ? "Checking Diarizator…"
    : !diarizatorReady
    ? diarizatorHealth?.message ??
      "Diarizator is unavailable. Start the CPU or GPU Docker service first."
    : null;
  const sessionsQueryKey = [
    "speaker-review-sessions",
    reviewProfileId,
  ] as const;
  const { data: sessions = [], isLoading: sessionsLoading } = useQuery<
    ReviewSessionSummary[]
  >({
    queryKey: sessionsQueryKey,
    enabled: Boolean(reviewProfileId),
    queryFn: () =>
      callResource("speaker-segments", {
        action: "list-review-sessions",
        profileId: reviewProfileId,
        limit: 20,
      }) as Promise<ReviewSessionSummary[]>,
  });
  const reviewHistoryQueryKey = [
    "speaker-review-history",
    reviewProfileId,
    showReviewHistory ? "all" : "latest",
  ] as const;
  const {
    data: reviewHistory,
    isLoading: reviewHistoryLoading,
    isFetching: reviewHistoryFetching,
  } = useQuery<ReviewHistoryResponse>({
    queryKey: reviewHistoryQueryKey,
    enabled: Boolean(reviewProfileId),
    queryFn: () =>
      callResource("speaker-segments", {
        action: "list-review-history",
        profileId: reviewProfileId,
        limit: showReviewHistory ? 200 : 1,
      }) as Promise<ReviewHistoryResponse>,
  });

  useEffect(() => {
    if (sessionsLoading) return;
    if (sessions.length === 0) {
      if (selectedSessionId) setSelectedSessionId(null);
      return;
    }
    const selectedExists = sessions.some((session) =>
      normalizeObjectId(session._id) === selectedSessionId
    );
    if (!selectedExists) {
      const next = sessions.find((session) => session.status === "active") ??
        sessions[0];
      setSelectedSessionId(normalizeObjectId(next._id));
    }
  }, [selectedSessionId, sessions, sessionsLoading]);

  useEffect(() => {
    try {
      if (selectedSessionId) {
        localStorage.setItem(
          "voice-identity-review-session",
          selectedSessionId,
        );
      } else {
        localStorage.removeItem("voice-identity-review-session");
      }
    } catch {
      // The server remains authoritative when browser storage is unavailable.
    }
  }, [selectedSessionId]);

  const sessionQueryKey = [
    "speaker-review-session",
    selectedSessionId,
  ] as const;
  const selectedSessionExists = sessions.some((session) =>
    normalizeObjectId(session._id) === selectedSessionId
  );
  const {
    data: reviewSession,
    isLoading,
    isFetching,
    isError,
    error,
    refetch,
  } = useQuery<ReviewSession>({
    queryKey: sessionQueryKey,
    enabled: Boolean(selectedSessionId && selectedSessionExists),
    queryFn: () =>
      callResource("speaker-segments", {
        action: "get-review-session",
        sessionId: selectedSessionId,
      }) as Promise<ReviewSession>,
    staleTime: 10_000,
  });

  useEffect(() => {
    if (reviewSession?.preferences?.autoPlay != null) {
      setAutoPlayNext(reviewSession.preferences.autoPlay);
    }
  }, [reviewSession?.preferences?.autoPlay]);

  const invalidateSourcePreview = () => {
    sourcePreviewRevisionRef.current += 1;
    setSourcePreviewDirty(true);
    setPreviewedSourcePayload(null);
  };
  const buildReviewSourcePayload = (): ReviewSourcePayload => {
    if (!reviewProfileId) throw new Error("Choose a voice profile first");
    if (!reviewProfile?.embeddingSpaceId) {
      throw new Error(
        "Re-enroll this profile before creating a review session",
      );
    }
    const now = new Date();
    const data: ReviewSourcePayload = {
      sourceMode: newSourceMode,
      targetProfileIds: [reviewProfileId],
      embeddingSpaceIds: [reviewProfile.embeddingSpaceId],
      runIds: newSourceMode === "diarization_generation" ? [newRunId] : [],
      recordingIds: newSourceMode === "selected_recordings"
        ? selectedRecordingIds
        : [],
      candidateMode: newCandidateMode,
      quality: newQualityMode === "clean"
        ? { minDurationSeconds: 1, deduplicateOverlaps: true }
        : { minDurationSeconds: 0, deduplicateOverlaps: false },
      rangeMode: "fixed",
    };
    if (newSourceMode === "diarization_generation") {
      if (
        !newRunId ||
        !activeDiarizationRuns.some((run) => run.runId === newRunId)
      ) {
        throw new Error("Choose an active diarization generation");
      }
      data.rangeMode = "all_before";
      return data;
    }
    if (newSourceMode === "timeline_range") {
      data.start = new Date(timelineSourceStart);
      data.end = new Date(timelineSourceEnd);
      return data;
    }
    data.rangeMode = newRange === "all" ? "all_before" : "fixed";
    if (newRange === "all") return data;
    const end = newRange === "custom" && customEnd ? new Date(customEnd) : now;
    const start = newRange === "custom" && customStart
      ? new Date(customStart)
      : new Date(
        end.getTime() - (newRange === "30d" ? 30 : 14) * 86_400_000,
      );
    if (
      !Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) ||
      end <= start
    ) {
      throw new Error("Enter a valid review date range");
    }
    data.start = start;
    data.end = end;
    return data;
  };

  const previewReviewSource = useMutation({
    mutationFn: async (
      request: { payload: ReviewSourcePayload; revision: number },
    ) => {
      return await callResource("speaker-segments", {
        action: "preview-review-session",
        ...request.payload,
        previewLimit: 5,
      }, { signal: AbortSignal.timeout(60_000) }) as ReviewSourcePreview;
    },
    onSuccess: (preview, request) => {
      if (request.revision !== sourcePreviewRevisionRef.current) return;
      setSourcePreview(preview);
      setPreviewedSourcePayload({
        ...preview.scope,
        start: new Date(preview.scope.start),
        end: new Date(preview.scope.end),
      });
      setSourcePreviewDirty(false);
    },
    onError: (error, request) => {
      if (request.revision !== sourcePreviewRevisionRef.current) return;
      toast.error("Could not preview review source", {
        description: reviewSourceErrorMessage(error),
      });
    },
  });

  useEffect(() => {
    if (!previewReviewSource.isPending) {
      setSourcePreviewElapsedSeconds(0);
      return;
    }
    const startedAt = Date.now();
    setSourcePreviewElapsedSeconds(0);
    const timer = globalThis.setInterval(() => {
      setSourcePreviewElapsedSeconds(
        Math.floor((Date.now() - startedAt) / 1_000),
      );
    }, 1_000);
    return () => globalThis.clearInterval(timer);
  }, [previewReviewSource.isPending]);

  const startSourcePreview = () => {
    try {
      previewReviewSource.mutate({
        payload: buildReviewSourcePayload(),
        revision: sourcePreviewRevisionRef.current,
      });
    } catch (error) {
      toast.error("Could not preview review source", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    }
  };

  const createSession = useMutation({
    mutationFn: async () => {
      if (sourcePreviewDirty || !sourcePreview || !previewedSourcePayload) {
        throw new Error("Preview the selected source before starting review");
      }
      if (sourcePreview.counts.eligibleSegments === 0) {
        throw new Error("No eligible voice segments were found");
      }
      if (
        newSourceMode === "selected_recordings" &&
        selectedRecordingIds.length === 0
      ) {
        throw new Error("Select at least one recording");
      }
      const data: Record<string, unknown> = {
        action: "create-review-session",
        ...previewedSourcePayload,
        limit: newWindowSize,
        preferences: {
          autoPlay: autoPlayNext,
          autoAdvanceWindow: true,
          groupMode: true,
          compactMode: true,
        },
      };
      return await callResource("speaker-segments", data) as ReviewSession;
    },
    onSuccess: (session) => {
      const id = normalizeObjectId(session._id);
      setSelectedSessionId(id);
      queryClient.setQueryData(["speaker-review-session", id], session);
      void queryClient.invalidateQueries({ queryKey: sessionsQueryKey });
      void queryClient.invalidateQueries({ queryKey: reviewHistoryQueryKey });
      setShowNewSession(false);
      setSourcePreview(null);
      setPreviewedSourcePayload(null);
      setSourcePreviewDirty(true);
      setHistory([]);
      toast.success(
        `Review session created with ${session.loadedCount} segments`,
      );
    },
    onError: (error) =>
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not create review session",
      ),
  });

  const skipDecision = useMutation({
    mutationFn: async (
      {
        segmentIds,
        replacesDecisionId,
      }: { segmentIds: string[]; replacesDecisionId?: string },
    ) => {
      if (!reviewSession || !selectedSessionId) {
        throw new Error("Review session is not loaded");
      }
      return await callResource("speaker-segments", {
        action: "commit-review-skip",
        sessionId: selectedSessionId,
        revision: reviewSession.revision,
        clientRequestId: crypto.randomUUID(),
        segmentIds,
        ...(replacesDecisionId ? { replacesDecisionId } : {}),
      }) as { decision: { _id: unknown }; session: ReviewSession };
    },
    onSuccess: ({ decision, session }) => {
      const decisionId = normalizeObjectId(decision._id);
      queryClient.setQueryData(sessionQueryKey, session);
      if (decisionId) setHistory((current) => [...current, { decisionId }]);
      setEditingSegmentId(null);
      setPlayOnMount(autoPlayNext && Boolean(session.activeSegmentId));
      void refetchIdentityStatus();
      void queryClient.invalidateQueries({
        queryKey: ["speaker-calibration-preview"],
      });
      void queryClient.invalidateQueries({ queryKey: reviewHistoryQueryKey });
      void queryClient.invalidateQueries({ queryKey: sessionsQueryKey });
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "Could not skip segment",
      );
      void refetch();
    },
  });

  const reviseHistory = useMutation({
    mutationFn: async (
      input: {
        item: ReviewHistoryItem;
        outcome: "assigned" | "skipped";
        assignedProfileId?: string;
        excludedProfileIds?: string[];
      },
    ) => {
      if (!reviewProfileId) throw new Error("Choose a review profile");
      return await callResource("speaker-segments", {
        action: "revise-review-history",
        profileId: reviewProfileId,
        segmentId: normalizeObjectId(input.item.segment._id),
        replacesDecisionId: input.item.decisionId,
        clientRequestId: crypto.randomUUID(),
        outcome: input.outcome,
        ...(input.assignedProfileId
          ? { assignedProfileId: input.assignedProfileId }
          : {}),
        excludedProfileIds: input.excludedProfileIds ?? [],
      }) as ReviewHistoryResponse;
    },
    onSuccess: (response) => {
      queryClient.setQueryData(reviewHistoryQueryKey, response);
      setHistoryEditingItem(null);
      setCalibrationEditingItem(null);
      setCalibrationEditingPlayOnMount(false);
      void refetch();
      void refetchIdentityStatus();
      void queryClient.invalidateQueries({
        queryKey: ["speaker-calibration-preview"],
      });
      void queryClient.invalidateQueries({ queryKey: sessionsQueryKey });
      void queryClient.invalidateQueries({ queryKey: reviewHistoryQueryKey });
      toast.success("Previous review answer corrected");
    },
    onError: (error) =>
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not correct review history",
      ),
  });

  const updatePosition = useMutation({
    mutationFn: async (input: {
      activeSegmentId?: string | null;
      skipSegmentId?: string;
      preferences?: Record<string, boolean>;
    }) => {
      if (!reviewSession || !selectedSessionId) {
        throw new Error("Review session is not loaded");
      }
      return await callResource("speaker-segments", {
        action: "update-review-position",
        sessionId: selectedSessionId,
        revision: reviewSession.revision,
        ...input,
      }) as ReviewSession;
    },
    onSuccess: (session, variables) => {
      queryClient.setQueryData(sessionQueryKey, session);
      if (variables.skipSegmentId) {
        setPlayOnMount(autoPlayNext && Boolean(session.activeSegmentId));
      }
    },
    onError: (error) => {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not save review position",
      );
      void refetch();
    },
  });

  const label = useMutation({
    mutationFn: async (
      {
        clientRequestId,
        segmentIds,
        profileId,
        excludedProfileIds,
        replacesDecisionId,
      }: {
        clientRequestId: string;
        segmentIds: string[];
        profileId?: string;
        excludedProfileIds: string[];
        replacesDecisionId?: string;
      },
    ) => {
      if (!reviewProfileId || !reviewSession || !selectedSessionId) {
        throw new Error("Review session or profile is missing");
      }
      return await callResource("speaker-segments", {
        action: replacesDecisionId
          ? "revise-review-decision"
          : "commit-review-decision",
        sessionId: selectedSessionId,
        revision: reviewSession.revision,
        clientRequestId,
        segmentIds,
        ...(profileId ? { profileId } : {}),
        excludedProfileIds,
        ...(replacesDecisionId ? { replacesDecisionId } : {}),
      }) as { decision: { _id: unknown }; session: ReviewSession };
    },
    onSuccess: ({ decision, session }, variables) => {
      const decisionId = normalizeObjectId(decision._id);
      queryClient.setQueryData(sessionQueryKey, session);
      if (variables.replacesDecisionId) {
        const replacedDecisionStillCurrent = session.window.some((item) =>
          normalizeObjectId(item.decisionId) === variables.replacesDecisionId
        );
        if (!replacedDecisionStillCurrent) {
          setHistory((current) =>
            current.filter((entry) =>
              entry.decisionId !== variables.replacesDecisionId
            )
          );
        }
        setEditingSegmentId(null);
        setPlayOnMount(false);
        toast.success("Speaker label corrected");
      } else {
        if (decisionId) setHistory((current) => [...current, { decisionId }]);
        setPlayOnMount(autoPlayNext && Boolean(session.activeSegmentId));
      }
      void refetchIdentityStatus();
      void queryClient.invalidateQueries({
        queryKey: ["speaker-calibration-preview"],
      });
      void queryClient.invalidateQueries({ queryKey: sessionsQueryKey });
      void queryClient.invalidateQueries({ queryKey: reviewHistoryQueryKey });
    },
    onError: (error) => {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not save review decision",
      );
      void refetch();
    },
  });

  const createReviewProfile = useMutation({
    mutationFn: async (
      { name, segmentIds }: { name: string; segmentIds: string[] },
    ) => {
      return await callResource("speaker-segments", {
        action: "create-profile-from-segments",
        name,
        segmentIds,
      }) as { _id: unknown; name: string };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: voiceIdentityKeys.profiles,
      });
      void queryClient.invalidateQueries({
        queryKey: ["speaker_profiles", "timeline-sample"],
      });
    },
    onError: (error) =>
      toast.error("Could not create speaker profile", {
        description: error instanceof Error ? error.message : "Unknown error",
      }),
  });

  const undo = useMutation({
    mutationFn: async (entry: ReviewHistoryEntry) => {
      if (!selectedSessionId || !reviewSession) {
        throw new Error("Review session is not loaded");
      }
      return await callResource("speaker-segments", {
        action: "undo-review-decision",
        sessionId: selectedSessionId,
        revision: reviewSession.revision,
        decisionId: entry.decisionId,
      }) as ReviewSession;
    },
    onSuccess: (session) => {
      queryClient.setQueryData(sessionQueryKey, session);
      setHistory((current) => current.slice(0, -1));
      setPlayOnMount(false);
      void refetchIdentityStatus();
    },
    onError: (error) =>
      toast.error(
        error instanceof Error ? error.message : "Could not undo decision",
      ),
  });

  const completeSession = useMutation({
    mutationFn: async () => {
      if (!selectedSessionId) throw new Error("Review session is not selected");
      return await callResource("speaker-segments", {
        action: "complete-review-session",
        sessionId: selectedSessionId,
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: sessionsQueryKey });
      void refetch();
      toast.success("Review session completed; labels remain saved");
    },
  });

  const loadNextWindow = useMutation({
    mutationFn: async () => {
      if (!selectedSessionId || !reviewSession) {
        throw new Error("Review session is not loaded");
      }
      return await callResource("speaker-segments", {
        action: "load-next-review-window",
        sessionId: selectedSessionId,
        revision: reviewSession.revision,
      }) as ReviewSession;
    },
    onSuccess: (session) => {
      const automaticAdvance = automaticWindowAdvanceRef.current;
      automaticWindowAdvanceRef.current = false;
      queryClient.setQueryData(sessionQueryKey, session);
      setHistory([]);
      setPlayOnMount(autoPlayNext && Boolean(session.activeSegmentId));
      void queryClient.invalidateQueries({ queryKey: sessionsQueryKey });
      if (!automaticAdvance) {
        toast.success(
          session.loadedCount > 0
            ? `Loaded window ${session.windowNumber} with ${session.loadedCount} segments`
            : "No more segments in this frozen backlog",
        );
      }
    },
    onError: (error) => {
      automaticWindowAdvanceRef.current = false;
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not load the next review window",
      );
    },
  });

  const saveCalibration = useMutation({
    mutationFn: async () => {
      if (!profileId || !primary?.embeddingSpaceId) {
        throw new Error(
          "Primary profile has no embedding provenance; re-enroll it first",
        );
      }
      if (
        !calibrationPreview?.thresholds || !calibrationPreview.validationMetrics
      ) {
        throw new Error("Run a valid calibration preview first");
      }
      return await callResource("speaker-segments", {
        action: "save-calibration",
        profileId,
        calibrationRecordingIds: effectiveCalibrationIds,
        validationRecordingIds: effectiveValidationIds,
        targetPrecision: calibrationTargetPrecision,
        acceptLowerPrecisionRisk,
        positiveThresholdOverride: lowerPrecisionPilot
          ? positiveThresholdOverride ?? undefined
          : undefined,
      });
    },
    onSuccess: () => {
      void refetchIdentityStatus();
      toast.success(
        calibrationTargetPrecision >= RECOMMENDED_CALIBRATION_PRECISION
          ? "Production calibration saved; full-range identity classification is allowed"
          : "Pilot calibration saved; classification is limited to a 24-hour pilot",
      );
    },
    onError: (error) =>
      toast.error(
        error instanceof Error ? error.message : "Calibration rejected",
      ),
  });
  const latestCalibration = identityStatus?.usableCalibration;
  const staleCalibrations =
    identityStatus?.calibrations.filter((calibration) =>
      calibration.validity === "stale"
    ) ?? [];
  const labels = identityStatus?.labels ?? {
    sky: 0,
    notSky: 0,
    total: 0,
    recordings: 0,
  };
  const calibrationIds = calibrationRecordings.split(",").map((value) =>
    value.trim()
  ).filter(Boolean);
  const validationIds = validationRecordings.split(",").map((value) =>
    value.trim()
  ).filter(Boolean);
  const {
    data: calibrationPreview,
    dataUpdatedAt: calibrationPreviewUpdatedAt,
    isLoading: calibrationPreviewLoading,
    isFetching: calibrationPreviewFetching,
    isError: calibrationPreviewIsError,
    error: calibrationPreviewError,
    refetch: refetchCalibrationPreview,
  } = useQuery<CalibrationPreview>({
    queryKey: [
      "speaker-calibration-preview",
      profileId,
      calibrationIds,
      validationIds,
      calibrationTargetPrecision,
      positiveThresholdOverride,
    ],
    enabled: Boolean(profileId && primary?.embeddingSpaceId),
    queryFn: () =>
      callResource("speaker-segments", {
        action: "calibration-preview",
        profileId,
        calibrationRecordingIds: calibrationIds,
        validationRecordingIds: validationIds,
        targetPrecision: calibrationTargetPrecision,
        positiveThresholdOverride: calibrationTargetPrecision <
            RECOMMENDED_CALIBRATION_PRECISION
          ? positiveThresholdOverride ?? undefined
          : undefined,
      }) as Promise<CalibrationPreview>,
    staleTime: 10_000,
  });
  const effectiveCalibrationIds = calibrationIds.length === 0 &&
      validationIds.length === 0
    ? calibrationPreview?.calibrationRecordingIds ?? []
    : calibrationIds;
  const effectiveValidationIds = calibrationIds.length === 0 &&
      validationIds.length === 0
    ? calibrationPreview?.validationRecordingIds ?? []
    : validationIds;
  const summarizeCalibrationRecordings = (ids: string[]) =>
    (calibrationPreview?.recordings ?? []).reduce(
      (summary, recording) => {
        if (!ids.includes(recording.id)) return summary;
        summary.recordings += 1;
        summary.sky += recording.positive;
        summary.notSky += recording.negative;
        summary.total += recording.total;
        return summary;
      },
      { recordings: 0, sky: 0, notSky: 0, total: 0 },
    );
  const fitRecordingSummary = summarizeCalibrationRecordings(
    effectiveCalibrationIds,
  );
  const validationRecordingSummary = summarizeCalibrationRecordings(
    effectiveValidationIds,
  );
  const canValidate = Boolean(
    calibrationPreview?.canValidate &&
      (calibrationPreview.targetPrecision ?? calibrationTargetPrecision) ===
        calibrationTargetPrecision &&
      !calibrationPreviewFetching,
  );
  const lowerPrecisionPilot = calibrationTargetPrecision <
    RECOMMENDED_CALIBRATION_PRECISION;
  const previewNegativeDecisionMode = calibrationPreview?.thresholds
    ?.negativeDecisionMode ??
    calibrationPreview?.negativeDecisionMode ??
    (calibrationPreview?.thresholds?.negativeThreshold === -1
      ? "uncertain_only"
      : "calibrated");
  const recommendedPositiveThreshold =
    calibrationPreview?.recommendedPositiveThreshold ??
      (calibrationPreview?.positiveThresholdSource !== "operator_stricter"
        ? calibrationPreview?.thresholds?.positiveThreshold
        : null);
  const displayedPositiveThreshold = positiveThresholdDraft ??
    positiveThresholdOverride ??
    calibrationPreview?.thresholds?.positiveThreshold ??
    recommendedPositiveThreshold;
  const appliedPositiveThreshold = calibrationPreview?.thresholds
    ?.positiveThreshold ?? recommendedPositiveThreshold;
  const previewMatchesPositiveThreshold = positiveThresholdOverride == null
    ? calibrationPreview?.positiveThresholdSource !== "operator_stricter"
    : calibrationPreview?.positiveThresholdSource === "operator_stricter" &&
      Math.abs(
          (calibrationPreview.thresholds?.positiveThreshold ?? -1) -
            positiveThresholdOverride,
        ) < 0.0005;
  const canSaveCalibration = canValidate &&
    positiveThresholdDraft === null &&
    previewMatchesPositiveThreshold &&
    (!lowerPrecisionPilot || acceptLowerPrecisionRisk);
  const resetPositiveThresholdOverride = () => {
    setPositiveThresholdOverride(null);
    setPositiveThresholdDraft(null);
  };
  const clampPositiveThreshold = (value: number) => {
    if (recommendedPositiveThreshold == null) return null;
    return Math.min(
      1,
      Math.max(
        recommendedPositiveThreshold,
        Number(value.toFixed(3)),
      ),
    );
  };
  const commitPositiveThresholdOverride = (value: number) => {
    const clamped = clampPositiveThreshold(value);
    if (clamped == null) return;
    const usesRecommendation = Math.abs(
      clamped - recommendedPositiveThreshold!,
    ) < 0.0005;
    setPositiveThresholdOverride(usesRecommendation ? null : clamped);
    setPositiveThresholdDraft(null);
    setCalibrationRefreshResult(null);
  };
  const calibrationLabelCounts = calibrationPreview?.counts
    ? {
      sky: calibrationPreview.counts.positive,
      notSky: calibrationPreview.counts.negative,
      total: calibrationPreview.counts.total,
      recordings: calibrationPreview.counts.recordings,
    }
    : labels;
  const labelGateReady = calibrationLabelCounts.sky >= 40 &&
    calibrationLabelCounts.notSky >= 40 && calibrationLabelCounts.total >= 100;
  const missingLabelRequirements = [
    calibrationLabelCounts.sky < 40
      ? `${40 - calibrationLabelCounts.sky} more compatible Sky`
      : null,
    calibrationLabelCounts.notSky < 40
      ? `${40 - calibrationLabelCounts.notSky} more compatible not-Sky`
      : null,
    calibrationLabelCounts.total < 100
      ? `${100 - calibrationLabelCounts.total} more compatible total`
      : null,
  ].filter(Boolean) as string[];
  const readinessState = latestCalibration
    ? "Validated"
    : staleCalibrations.length > 0
    ? "Calibration stale"
    : !labelGateReady
    ? "Need labels"
    : calibrationPreview?.blockers.length
    ? "Check needs attention"
    : "Minimum reached";
  const hasWeakRecordingDiversity = labelGateReady &&
    calibrationLabelCounts.recordings <= 3;
  const windowItems = reviewSession?.window ?? [];
  const segmentById = useMemo(
    () =>
      new Map(
        (reviewSession?.segments ?? []).map((segment) => [
          normalizeObjectId(segment._id),
          segment,
        ]),
      ),
    [reviewSession?.segments],
  );
  const durationForItem = (item: ReviewWindowItem) => {
    const segment = segmentById.get(normalizeObjectId(item.segmentId) ?? "");
    return segment
      ? Math.max(
        0,
        (new Date(segment.end).getTime() -
          new Date(segment.start).getTime()) / 1_000,
      )
      : 0;
  };
  const pendingShortIds = windowItems.filter((item) =>
    item.status === "pending" && durationForItem(item) < 1
  ).map((item) => normalizeObjectId(item.segmentId)).filter(
    (id): id is string => Boolean(id),
  );
  const visibleWindowItems = windowItems.filter((item) => {
    if (sessionItemFilter === "all") return true;
    if (sessionItemFilter === "short") return durationForItem(item) < 1;
    return item.status === sessionItemFilter;
  });
  const visibleReviewHistory = (reviewHistory?.items ?? []).filter((item) => {
    const matchesOutcome = historyFilter === "all" ||
      item.outcome === historyFilter;
    const originalId = normalizeObjectId(
      item.segment.original_id ?? item.segment.original,
    );
    return matchesOutcome &&
      (!historyRecordingId || originalId === historyRecordingId);
  });
  const reviewHistoryLabel = (item: ReviewHistoryItem) => {
    if (item.outcome === "skipped") return "Skipped / noise";
    if (item.assignedProfileName) return item.assignedProfileName;
    if (item.excludedProfileIds.includes(reviewProfileId ?? "")) {
      return `Not ${reviewProfile?.name ?? "target"}`;
    }
    return "Manual label";
  };
  const calibrationIssueToHistoryItem = (
    issue: CalibrationIssue,
  ): ReviewHistoryItem => ({
    decisionId: issue.decisionId ?? "",
    outcome: "assigned",
    assignedProfileId: issue.assignedProfileId,
    assignedProfileName: issue.assignedProfileId
      ? allProfileOptions.find((profile) =>
        profile.id === issue.assignedProfileId
      )?.name ?? "Other speaker"
      : null,
    excludedProfileIds: issue.excludedProfileIds,
    excludedProfileNames: issue.excludedProfileIds.map((id) =>
      allProfileOptions.find((profile) => profile.id === id)?.name ?? id
    ),
    updatedAt: issue.updatedAt,
    sessionId: issue.sessionId,
    sessionName: "Calibration check",
    sessionStatus: null,
    segment: issue.segment,
  });
  const latestReviewHistoryItem = reviewHistory?.items[0] ?? null;
  const olderVisibleReviewHistory = visibleReviewHistory.filter((item) =>
    item.decisionId !== latestReviewHistoryItem?.decisionId
  );
  const falsePositiveIssues = calibrationPreview?.validationIssues
    ?.falsePositive ?? [];
  const missedPositiveIssues = calibrationPreview?.validationIssues
    ?.missedPositive ?? [];
  const calibrationIssuesForKind = calibrationProblemKind === "falsePositive"
    ? falsePositiveIssues
    : missedPositiveIssues;
  const visibleCalibrationIssues = calibrationIssuesForKind.filter((issue) =>
    !calibrationProblemRecordingId ||
    issue.recordingId === calibrationProblemRecordingId
  );
  const calibrationIssueCountsByRecording = [
    ...falsePositiveIssues,
    ...missedPositiveIssues,
  ].reduce((counts, issue) => {
    const current = counts.get(issue.recordingId) ?? {
      falsePositive: 0,
      missedPositive: 0,
    };
    current[
      issue.kind === "false_positive" ? "falsePositive" : "missedPositive"
    ] += 1;
    counts.set(issue.recordingId, current);
    return counts;
  }, new Map<string, { falsePositive: number; missedPositive: number }>());
  const calibrationEditingIndex = calibrationEditingItem
    ? visibleCalibrationIssues.findIndex((issue) =>
      issue.decisionId === calibrationEditingItem.decisionId &&
      issue.segmentId === normalizeObjectId(calibrationEditingItem.segment._id)
    )
    : -1;
  const openCalibrationIssueAt = (index: number) => {
    const issue = visibleCalibrationIssues[index];
    if (!issue?.decisionId) return;
    useAudioPlaybackStore.getState().stopActive();
    setCalibrationEditingPlayOnMount(true);
    setCalibrationEditingItem(calibrationIssueToHistoryItem(issue));
  };
  const activeId = normalizeObjectId(reviewSession?.activeSegmentId) ??
    normalizeObjectId(
      windowItems.find((item) => item.status === "pending")?.segmentId,
    );
  const reviewId = editingSegmentId ?? activeId;
  const activeIndex = Math.max(
    0,
    windowItems.findIndex((item) =>
      normalizeObjectId(item.segmentId) === activeId
    ),
  );
  const reviewIndex = Math.max(
    0,
    windowItems.findIndex((item) =>
      normalizeObjectId(item.segmentId) === reviewId
    ),
  );
  const reviewItem = windowItems[reviewIndex];
  const activeSegment = reviewId ? segmentById.get(reviewId) : undefined;
  const groupMode = reviewSession?.preferences?.groupMode !== false;
  const activeGroup = editingSegmentId
    ? undefined
    : reviewSession?.groups.find((group) =>
      group.segmentIds.includes(activeId ?? "")
    );
  const decisionSegmentIds =
    (editingSegmentId
      ? [editingSegmentId]
      : groupMode && activeGroup
      ? activeGroup.segmentIds
      : reviewId
      ? [reviewId]
      : []).filter((id) => {
        const item = windowItems.find((candidate) =>
          normalizeObjectId(candidate.segmentId) === id
        );
        return Boolean(editingSegmentId) || item?.status !== "reviewed";
      });
  const playerSegment = activeSegment && groupMode && activeGroup
    ? {
      ...activeSegment,
      start: activeGroup.start,
      end: activeGroup.end,
    }
    : activeSegment;
  useEffect(() => {
    if (!reviewSession || editingSegmentId || windowItems.length === 0) return;
    const urls = new Set<string>();
    for (
      let index = activeIndex + 1;
      index < windowItems.length && urls.size < 3;
      index += 1
    ) {
      const item = windowItems[index];
      if (item.status !== "pending") continue;
      const segmentId = normalizeObjectId(item.segmentId);
      const segment = segmentId ? segmentById.get(segmentId) : undefined;
      if (!segment) continue;
      const group = groupMode && item.groupId
        ? reviewSession.groups.find((candidate) =>
          candidate.groupId === item.groupId
        )
        : undefined;
      const preloadSegment = group
        ? { ...segment, start: group.start, end: group.end }
        : segment;
      const url = buildVoiceReviewAudioUrl(preloadSegment);
      if (url) urls.add(url);
    }
    urls.forEach(preloadWaveformAudio);
  }, [
    activeIndex,
    editingSegmentId,
    groupMode,
    reviewSession,
    segmentById,
    windowItems,
  ]);
  const reviewPending = label.isPending || createReviewProfile.isPending ||
    skipDecision.isPending || undo.isPending ||
    updatePosition.isPending ||
    completeSession.isPending || loadNextWindow.isPending;
  const autoAdvanceWindow =
    reviewSession?.preferences?.autoAdvanceWindow !== false;
  const sessionAnsweredCount = (reviewSession?.reviewedCount ?? 0) +
    (reviewSession?.skippedCount ?? 0);
  const sessionEstimatedTotal = Math.max(
    sessionAnsweredCount,
    reviewSession?.backlogEstimate ?? 0,
  );
  const sessionRemainingEstimate = Math.max(
    0,
    sessionEstimatedTotal - sessionAnsweredCount,
  );
  const sessionProgressPercent = sessionEstimatedTotal > 0
    ? Math.min(100, sessionAnsweredCount / sessionEstimatedTotal * 100)
    : 0;
  const pendingInWindow = windowItems.some((item) => item.status === "pending");
  useEffect(() => {
    if (
      !reviewSession || reviewSession.status !== "active" ||
      !autoAdvanceWindow || pendingInWindow || reviewPending ||
      !reviewSession.hasMore || reviewSession.loadedCount === 0
    ) return;
    automaticWindowAdvanceRef.current = true;
    loadNextWindow.mutate();
  }, [
    autoAdvanceWindow,
    pendingInWindow,
    reviewPending,
    reviewSession?.hasMore,
    reviewSession?.loadedCount,
    reviewSession?.revision,
    reviewSession?.status,
  ]);
  const setAutoPlayPreference = (enabled: boolean) => {
    setAutoPlayNext(enabled);
    try {
      localStorage.setItem(AUTO_PLAY_STORAGE_KEY, String(enabled));
    } catch {
      // The preference is still valid for the current page session.
    }
    if (reviewSession && !updatePosition.isPending) {
      updatePosition.mutate({ preferences: { autoPlay: enabled } });
    }
  };
  const setAutoAdvanceWindowPreference = (enabled: boolean) => {
    if (reviewSession && !updatePosition.isPending) {
      updatePosition.mutate({
        preferences: { autoAdvanceWindow: enabled },
      });
    }
  };
  const openReviewSetup = () => {
    setShowNewSession(true);
    globalThis.requestAnimationFrame(() => {
      reviewSetupRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  };
  const openHistoryForRecording = (recordingId: string) => {
    setHistoryRecordingId(recordingId);
    setShowReviewHistory(true);
    setHistoryEditingItem(null);
    useAudioPlaybackStore.getState().stopActive();
    globalThis.requestAnimationFrame(() => {
      reviewHistoryRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  };
  const moveReview = (direction: -1 | 1) => {
    if (!reviewSession || reviewPending || windowItems.length === 0) return;
    setPlayOnMount(false);
    const nextIndex = Math.max(
      0,
      Math.min(windowItems.length - 1, activeIndex + direction),
    );
    const nextId = normalizeObjectId(windowItems[nextIndex]?.segmentId);
    if (nextId && nextId !== activeId) {
      updatePosition.mutate({ activeSegmentId: nextId });
    }
  };
  const openReviewSegment = (id: string) => {
    if (reviewPending || id === activeId) return;
    setEditingSegmentId(null);
    useAudioPlaybackStore.getState().stopActive();
    setPlayOnMount(false);
    updatePosition.mutate({ activeSegmentId: id });
  };
  const beginEdit = (item: ReviewWindowItem) => {
    const id = normalizeObjectId(item.segmentId);
    if (
      !id || !["reviewed", "skipped"].includes(item.status) || reviewPending
    ) {
      return;
    }
    useAudioPlaybackStore.getState().stopActive();
    setPlayOnMount(false);
    setEditingSegmentId(id);
  };
  const cancelEdit = () => {
    useAudioPlaybackStore.getState().stopActive();
    setEditingSegmentId(null);
    setPlayOnMount(false);
  };
  const saveAssignment = (assignment: {
    profileId?: string;
    excludedProfileIds: string[];
  }) => {
    if (reviewPending || decisionSegmentIds.length === 0) return;
    label.mutate({
      clientRequestId: crypto.randomUUID(),
      segmentIds: decisionSegmentIds,
      ...assignment,
      ...(editingSegmentId && reviewItem?.decisionSummary
        ? { replacesDecisionId: reviewItem.decisionSummary.decisionId }
        : {}),
    });
  };
  const skipCurrent = () => {
    if (!reviewId || reviewPending) return;
    skipDecision.mutate({
      segmentIds: [reviewId],
      ...(editingSegmentId && reviewItem?.decisionSummary
        ? { replacesDecisionId: reviewItem.decisionSummary.decisionId }
        : {}),
    });
  };
  const undoLast = () => {
    const entry = history.at(-1);
    if (entry && !reviewPending) undo.mutate(entry);
  };
  const chooseRecordingSet = (
    id: string,
    target: "calibration" | "validation" | "unused",
  ) => {
    const nextCalibration = effectiveCalibrationIds.filter((value) =>
      value !== id
    );
    const nextValidation = effectiveValidationIds.filter((value) =>
      value !== id
    );
    if (target === "calibration") nextCalibration.push(id);
    if (target === "validation") nextValidation.push(id);
    setCalibrationRecordings(nextCalibration.join(","));
    setValidationRecordings(nextValidation.join(","));
    resetPositiveThresholdOverride();
    setCalibrationRefreshResult(null);
  };
  const recalculateCalibration = async () => {
    const startedAt = Date.now();
    setCalibrationRefreshResult(null);
    const result = await refetchCalibrationPreview();
    if (result.isError) {
      setCalibrationRefreshResult({
        state: "error",
        message: result.error instanceof Error
          ? result.error.message
          : "Server calculation failed",
      });
      return;
    }
    const elapsedSeconds = Math.max(0.1, (Date.now() - startedAt) / 1_000);
    setCalibrationRefreshResult({
      state: "success",
      message: result.data?.canValidate
        ? `Updated in ${elapsedSeconds.toFixed(1)}s. Ready to save.`
        : `Updated in ${
          elapsedSeconds.toFixed(1)
        }s. Complete the blockers below.`,
    });
  };
  const reenroll = useMutation({
    mutationFn: async () => {
      if (!profileId) throw new Error("Primary profile is missing");
      return await callResource("jobs", {
        action: "enqueue",
        data: { type: "profileReenrollment", profileId },
        trigger: {
          type: "manual",
          reason: "Rebuild primary voice profile from saved samples",
        },
      });
    },
    onSuccess: () =>
      toast.success("Sky re-enrollment queued from all saved samples", {
        description:
          "It starts automatically at the next safe diarization batch boundary.",
      }),
    onError: (error) =>
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not queue re-enrollment",
      ),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold">Voice Identity review</h2>
          <p className="text-muted-foreground">
            Label voices → check accuracy → classify existing recordings.
          </p>
        </div>
        <div className="max-w-md space-y-1 text-right">
          <Button
            variant="outline"
            onClick={() => reenroll.mutate()}
            disabled={!profileId || reenroll.isPending || !diarizatorReady}
            title={reenrollUnavailableReason ?? undefined}
          >
            {reenroll.isPending
              ? "Queueing re-enrollment…"
              : "Re-enroll Sky from saved samples"}
          </Button>
          {reenrollUnavailableReason && (
            <p className="text-xs text-destructive">
              {reenrollUnavailableReason}
            </p>
          )}
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <Card
          className={primary?.embeddingSpaceId
            ? "border-green-500/30"
            : "border-amber-500/40"}
        >
          <CardHeader className="pb-2">
            <CardTitle className="text-base">1. Build Sky profile</CardTitle>
            <CardDescription>
              Combine the saved clean samples into the current embedding space.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm">
            {primary?.embeddingSpaceId
              ? (
                <span className="text-green-700">
                  Ready · revision {primary.revision ?? 1}
                </span>
              )
              : (
                <span className="text-amber-700">
                  Re-enrollment is required
                </span>
              )}
          </CardContent>
        </Card>
        <Card
          className={labels.total >= 100
            ? "border-green-500/30"
            : "border-amber-500/40"}
        >
          <CardHeader className="pb-2">
            <CardTitle className="text-base">2. Label examples</CardTitle>
            <CardDescription>
              Compatible “This is me” and “Not me” labels. Counts update
              automatically.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div>
              <div className="flex justify-between">
                <span>Sky</span>
                <strong>{calibrationLabelCounts.sky} / 40</strong>
              </div>
              <Progress
                className="mt-1"
                value={Math.min(100, calibrationLabelCounts.sky / 40 * 100)}
              />
            </div>
            <div>
              <div className="flex justify-between">
                <span>not-Sky</span>
                <strong>{calibrationLabelCounts.notSky} / 40</strong>
              </div>
              <Progress
                className="mt-1"
                value={Math.min(
                  100,
                  calibrationLabelCounts.notSky / 40 * 100,
                )}
              />
            </div>
            <div>
              <div className="flex justify-between">
                <span>Total</span>
                <strong>{calibrationLabelCounts.total} / 100</strong>
              </div>
              <Progress
                className="mt-1"
                value={Math.min(100, calibrationLabelCounts.total)}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Across {calibrationLabelCounts.recordings} recordings
            </p>
            <div
              className={`rounded-md border p-2 text-xs ${
                labelGateReady
                  ? "border-green-500/30 bg-green-500/5"
                  : "border-amber-500/30 bg-amber-500/5"
              }`}
            >
              {labelGateReady
                ? (
                  <>
                    Label-volume gate reached. The remaining gate is validation
                    precision ≥
                    {Math.round(calibrationTargetPrecision * 100)}% on
                    recordings not used to choose the thresholds.
                  </>
                )
                : `Still needed: ${missingLabelRequirements.join(" · ")}`}
            </div>
          </CardContent>
        </Card>
        <Card
          className={latestCalibration
            ? "border-green-500/30"
            : readinessState === "Check needs attention" ||
                readinessState === "Calibration stale"
            ? "border-amber-500/30"
            : "border-muted"}
        >
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              3. Validate and classify
            </CardTitle>
            <CardDescription>
              Verify accuracy on separate recordings, then classify history.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="font-medium">{readinessState}</p>
            {latestCalibration && (
              <>
                <p className="text-xs text-green-700 dark:text-green-400">
                  {latestCalibration.classificationPolicy === "full"
                    ? "Production classification ready"
                    : `Pilot ready · maximum ${
                      latestCalibration.maxRangeHours ?? 24
                    } hours`} · {latestCalibration.calibrationId}
                </p>
                {latestCalibration.negativeDecisionMode ===
                    "uncertain_only" && (
                  <p className="text-xs text-muted-foreground">
                    Safe Sky-first mode: auto not-Sky is off; everything below
                    the Sky threshold remains uncertain for review.
                  </p>
                )}
              </>
            )}
            {!latestCalibration && staleCalibrations.length > 0 && (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-xs text-amber-700 dark:text-amber-400">
                {staleCalibrations.length} saved calibration
                {staleCalibrations.length === 1 ? " is" : "s are"}{" "}
                stale and cannot unlock classification. {staleCalibrations[0]
                  ?.staleReasons?.slice(0, 2).join("; ")}
              </div>
            )}
            {!labelGateReady && (
              <p className="text-xs text-muted-foreground">
                Still needed: {missingLabelRequirements.join(" · ")}
              </p>
            )}
            {hasWeakRecordingDiversity && (
              <p className="text-xs text-amber-600">
                Only {calibrationLabelCounts.recordings}{" "}
                source recordings. The formal label minimum is reached, but
                conditions are not diverse; add distinct recordings if
                validation fails.
              </p>
            )}
            {labelGateReady && !latestCalibration && (
              <div className="space-y-2">
                {calibrationPreview?.validationMetrics && (
                  <p className="text-xs text-amber-600">
                    Independent accuracy{" "}
                    {(calibrationPreview.validationMetrics.positivePrecision *
                      100).toFixed(1)}% · target{" "}
                    {Math.round(calibrationTargetPrecision * 100)}% ·{" "}
                    {calibrationPreview.validationMetrics.falsePositive}{" "}
                    wrong Sky results
                  </p>
                )}
                {canValidate && (
                  <p className="text-xs text-muted-foreground">
                    Independent check passed. Save the calibration below.
                  </p>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    calibrationSectionRef.current?.scrollIntoView({
                      behavior: "smooth",
                    })}
                >
                  See result and next step
                </Button>
              </div>
            )}
            {latestCalibration && (
              <Link
                className="font-medium text-primary hover:underline"
                to="/jobs?type=speakerIdentity"
              >
                Open classification launcher →
              </Link>
            )}
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle>2. Review voices</CardTitle>
              <CardDescription>
                One continuous stream. The app keeps a small audio buffer ready
                and loads the next clips automatically.
              </CardDescription>
            </div>
            {sessions.length > 0 && !showNewSession &&
              reviewSession?.status === "active" && (
              <Button
                size="sm"
                variant="outline"
                onClick={openReviewSetup}
              >
                <Plus className="mr-1 h-4 w-4" />
                Start another stream
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="sticky top-2 z-10 grid gap-2 rounded-lg border bg-background/95 p-3 shadow-sm backdrop-blur md:grid-cols-[11rem_minmax(12rem,1fr)_minmax(15rem,1fr)_auto_auto]">
            <label className="text-xs text-muted-foreground">
              Profile being reviewed
              <select
                className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm text-foreground"
                value={reviewProfileId ?? ""}
                onChange={(event) => {
                  useAudioPlaybackStore.getState().stopActive();
                  setReviewProfileId(event.target.value || null);
                  setSelectedSessionId(null);
                  setHistory([]);
                  setPlayOnMount(false);
                }}
                aria-label="Review target profile"
              >
                {profiles.map((profile) => {
                  const id = normalizeObjectId(profile._id) ?? "";
                  return (
                    <option key={id} value={id}>
                      {profile.name ?? id}
                      {profile.is_primary ? " · primary" : ""}
                    </option>
                  );
                })}
              </select>
            </label>
            <label className="text-xs text-muted-foreground">
              Saved session
              <select
                className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm text-foreground"
                value={selectedSessionId ?? ""}
                onChange={(event) => {
                  useAudioPlaybackStore.getState().stopActive();
                  setSelectedSessionId(event.target.value || null);
                  setHistory([]);
                  setPlayOnMount(false);
                }}
                disabled={sessionsLoading || sessions.length === 0}
                aria-label="Saved review session"
              >
                {sessions.length === 0 && (
                  <option value="">No saved sessions</option>
                )}
                {sessions.map((session) => {
                  const id = normalizeObjectId(session._id) ?? "";
                  return (
                    <option key={id} value={id}>
                      {session.status === "active" ? "Resume" : "Completed"} ·
                      {" "}
                      {session.querySnapshot?.candidateMode === "auto_matched"
                        ? "Auto-match audit · "
                        : "Review queue · "}
                      {session.name} · {session.reviewedCount} labeled ·{" "}
                      {session.skippedCount} skipped
                    </option>
                  );
                })}
              </select>
            </label>
            <div className="flex min-w-48 items-end gap-2 text-xs">
              <div className="flex-1">
                <div className="flex justify-between text-muted-foreground">
                  <span>Current stream</span>
                  <span>
                    {reviewSession?.reviewedCount ?? 0} labeled ·{" "}
                    {reviewSession?.skippedCount ?? 0} skipped
                  </span>
                </div>
                <Progress
                  className="mt-2 h-2"
                  value={sessionProgressPercent}
                />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {reviewSession
                    ? `${sessionRemainingEstimate.toLocaleString()} estimated remaining`
                    : "Choose or start a stream"}
                </p>
              </div>
            </div>
            {reviewSession?.status === "active"
              ? (
                <>
                  <label className="flex items-center gap-2 self-end rounded-md border px-2 py-2 text-xs">
                    <Switch
                      checked={autoAdvanceWindow}
                      disabled={reviewPending}
                      onCheckedChange={setAutoAdvanceWindowPreference}
                      aria-label="Load review windows automatically"
                    />
                    <span>
                      <strong className="block">Continuous</strong>
                      <span className="text-[10px] text-muted-foreground">
                        load next automatically
                      </span>
                    </span>
                  </label>
                  <Button
                    size="sm"
                    variant="outline"
                    className="self-end"
                    disabled={reviewPending}
                    onClick={() => completeSession.mutate()}
                  >
                    <CheckCircle2 className="mr-1 h-4 w-4" />Finish stream
                  </Button>
                </>
              )
              : (
                <div className="self-end rounded-md border px-3 py-2 text-xs text-muted-foreground md:col-span-2">
                  Finished · saved answers remain in calibration
                </div>
              )}
          </div>

          <p className="text-xs text-muted-foreground">
            “Me” and “Not me” refer to{" "}
            <strong className="text-foreground">
              {reviewProfile?.name ?? "the selected profile"}
            </strong>. Calibration progress above counts all saved streams:{" "}
            <strong className="text-foreground">
              {calibrationLabelCounts.total} usable labels
            </strong>. The buffer size below is only a loading detail, not a
            target you must finish.
          </p>

          {(showNewSession || (!sessionsLoading && sessions.length === 0) ||
            Boolean(reviewSession && reviewSession.status !== "active")) && (
            <div
              ref={reviewSetupRef}
              className="scroll-mt-4 space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-medium">Start continuous review</p>
                  <p className="text-xs text-muted-foreground">
                    Choose the source once. Clips then keep flowing until the
                    source is exhausted or you press Finish stream.
                  </p>
                </div>
                {showNewSession && sessions.length > 0 &&
                  reviewSession?.status === "active" && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setShowNewSession(false)}
                  >
                    Cancel
                  </Button>
                )}
              </div>
              <div className="grid gap-2 md:grid-cols-4">
                <label className="text-xs text-muted-foreground">
                  Source
                  <select
                    className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm text-foreground"
                    value={newSourceMode}
                    onChange={(event) => {
                      setNewSourceMode(
                        event.target.value as ReviewSourceMode,
                      );
                      setSourcePreview(null);
                      invalidateSourcePreview();
                    }}
                  >
                    <option value="all_matching">
                      All matching recordings
                    </option>
                    <option value="selected_recordings">
                      Selected recordings
                    </option>
                    <option
                      value="timeline_range"
                      disabled={!timelineSourceAvailable}
                    >
                      {timelineSourceAvailable
                        ? "Current Timeline range"
                        : "Current Timeline range · select on Timeline first"}
                    </option>
                    <option
                      value="diarization_generation"
                      disabled={activeDiarizationRuns.length === 0}
                    >
                      Specific diarization generation
                    </option>
                  </select>
                </label>
                <label className="text-xs text-muted-foreground">
                  Candidates
                  <select
                    className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm text-foreground"
                    value={newCandidateMode}
                    onChange={(event) => {
                      setNewCandidateMode(
                        event.target.value as typeof newCandidateMode,
                      );
                      invalidateSourcePreview();
                    }}
                  >
                    <option value="reviewable">
                      Uncertain + unclassified
                    </option>
                    <option value="auto_matched">
                      Audit automatic matches
                    </option>
                  </select>
                </label>
                <label className="text-xs text-muted-foreground">
                  Audio quality
                  <select
                    className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm text-foreground"
                    value={newQualityMode}
                    onChange={(event) => {
                      setNewQualityMode(
                        event.target.value as typeof newQualityMode,
                      );
                      invalidateSourcePreview();
                    }}
                  >
                    <option value="clean">
                      Clear speech · ≥1s · deduplicate
                    </option>
                    <option value="all">All fragments · diagnostic</option>
                  </select>
                </label>
                {(newSourceMode === "all_matching" ||
                  newSourceMode === "selected_recordings") && (
                  <label className="text-xs text-muted-foreground">
                    Date range
                    <select
                      className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm text-foreground"
                      value={newRange}
                      onChange={(event) => {
                        setNewRange(event.target.value as typeof newRange);
                        invalidateSourcePreview();
                      }}
                    >
                      <option value="14d">Last 14 days</option>
                      <option value="30d">Last 30 days</option>
                      <option value="custom">Custom range</option>
                      <option value="all">Full backlog snapshot</option>
                    </select>
                  </label>
                )}
              </div>

              <details className="rounded-md border bg-background px-3 py-2 text-xs">
                <summary className="cursor-pointer font-medium">
                  Advanced loading settings
                </summary>
                <label className="mt-2 block max-w-xs text-muted-foreground">
                  Preload buffer
                  <select
                    className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm text-foreground"
                    value={newWindowSize}
                    onChange={(event) =>
                      setNewWindowSize(
                        Number(event.target.value) as typeof newWindowSize,
                      )}
                  >
                    <option value={5}>5 clips</option>
                    <option value={10}>10 clips · recommended</option>
                    <option value={20}>20 clips</option>
                  </select>
                  <span className="mt-1 block">
                    This affects preloading only. With Continuous enabled, the
                    next buffer arrives automatically.
                  </span>
                </label>
              </details>

              {newSourceMode === "diarization_generation" && (
                <label className="block text-xs text-muted-foreground">
                  Active generation
                  <select
                    className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm text-foreground"
                    value={newRunId}
                    onChange={(event) => {
                      setNewRunId(event.target.value);
                      invalidateSourcePreview();
                    }}
                  >
                    {activeDiarizationRuns.map((run) => (
                      <option key={run.runId} value={run.runId}>
                        Generation {run.generation ?? "?"} · {run.runId}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {newRange === "custom" &&
                newSourceMode !== "diarization_generation" && (
                <div className="grid grid-cols-2 gap-2">
                  <label className="text-xs text-muted-foreground">
                    Start
                    <Input
                      type="datetime-local"
                      value={customStart}
                      readOnly={newSourceMode === "timeline_range"}
                      onChange={(event) => {
                        setCustomStart(event.target.value);
                        invalidateSourcePreview();
                      }}
                    />
                  </label>
                  <label className="text-xs text-muted-foreground">
                    End
                    <Input
                      type="datetime-local"
                      value={customEnd}
                      readOnly={newSourceMode === "timeline_range"}
                      onChange={(event) => {
                        setCustomEnd(event.target.value);
                        invalidateSourcePreview();
                      }}
                    />
                  </label>
                </div>
              )}

              <div className="grid gap-2 md:grid-cols-2">
                <div className="rounded-md border p-3">
                  <p className="mb-2 text-xs font-medium text-muted-foreground">
                    1 · Find clips
                  </p>
                  <Button
                    className="w-full"
                    variant="outline"
                    onClick={startSourcePreview}
                    disabled={!reviewProfileId ||
                      previewReviewSource.isPending}
                  >
                    {previewReviewSource.isPending
                      ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Checking… {sourcePreviewElapsedSeconds}s
                        </>
                      )
                      : sourcePreviewDirty
                      ? "Check available audio"
                      : "Check again"}
                  </Button>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {previewReviewSource.isPending
                      ? "Scanning up to 5,000 stored segments; this can take about a minute."
                      : sourcePreview && !sourcePreviewDirty
                      ? `${
                        sourcePreview.counts.capped ? "At least " : ""
                      }${sourcePreview.counts.eligibleSegments.toLocaleString()} clips in ${sourcePreview.counts.recordings.toLocaleString()} recordings are ready.`
                      : "Required once after changing the source or date range."}
                  </p>
                </div>
                <div
                  className={`rounded-md border p-3 ${
                    sourcePreview && !sourcePreviewDirty
                      ? "border-sky-500/40 bg-sky-500/5"
                      : "bg-muted/20"
                  }`}
                >
                  <p className="mb-2 text-xs font-medium text-muted-foreground">
                    2 · Start the stream
                  </p>
                  <Button
                    className="w-full"
                    onClick={() => createSession.mutate()}
                    disabled={!reviewProfileId || createSession.isPending ||
                      sourcePreviewDirty || !sourcePreview ||
                      !previewedSourcePayload ||
                      sourcePreview.counts.eligibleSegments === 0 ||
                      (newSourceMode === "selected_recordings" &&
                        selectedRecordingIds.length === 0)}
                  >
                    {createSession.isPending
                      ? "Starting…"
                      : sourcePreview && !sourcePreviewDirty
                      ? `Start review · ${sourcePreview.counts.eligibleSegments.toLocaleString()} available`
                      : "Start review"}
                  </Button>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {sourcePreview && !sourcePreviewDirty
                      ? "Ready. The next clips will load automatically."
                      : "Unlocks after step 1. There is no 10-clip batch to finish."}
                  </p>
                </div>
              </div>

              {sourcePreviewDirty && sourcePreview && (
                <p className="text-xs text-amber-600">
                  Source changed · run step 1 again.
                </p>
              )}

              {previewReviewSource.isError && (
                <p className="text-xs text-destructive">
                  {reviewSourceErrorMessage(previewReviewSource.error)}
                </p>
              )}

              {sourcePreview && (
                <div className="space-y-2 rounded-md bg-muted/30 p-2">
                  <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                    <span>
                      Frozen range:{" "}
                      {new Date(sourcePreview.range.start).toLocaleString()} →
                      {" "}
                      {new Date(sourcePreview.range.end).toLocaleString()}
                    </span>
                    <span>
                      Hidden by quality filter:{" "}
                      {sourcePreview.qualityStats.shortExcluded} short ·{" "}
                      {sourcePreview.qualityStats.duplicateExcluded} overlapping
                    </span>
                    <span>
                      Embedding space:{" "}
                      {sourcePreview.embeddingSpaceIds.join(", ")}
                    </span>
                    {sourcePreview.runIds.length > 0 && (
                      <span>Run: {sourcePreview.runIds.join(", ")}</span>
                    )}
                  </div>
                  <p className="text-xs font-medium text-foreground">
                    Ready to start. Audio will load {newWindowSize}{" "}
                    clips ahead and continue automatically; there is no
                    batch-complete button to press.
                  </p>
                  {newSourceMode === "selected_recordings" &&
                    sourcePreview.recordings.length > 9 && (
                    <Input
                      value={recordingSearch}
                      onChange={(event) =>
                        setRecordingSearch(event.target.value)}
                      placeholder="Filter recordings by name, date, or ID"
                      className="h-8"
                    />
                  )}
                  <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                    {sourcePreview.recordings.filter((recording) => {
                      const query = recordingSearch.trim().toLowerCase();
                      if (!query) return true;
                      return [
                        recording.id,
                        recording.name,
                        recording.path,
                        new Date(recording.start).toLocaleString(),
                      ].some((value) =>
                        String(value ?? "").toLowerCase().includes(query)
                      );
                    }).slice(
                      0,
                      newSourceMode === "selected_recordings" ? 30 : 9,
                    )
                      .map((recording) => {
                        const selected = selectedRecordingIds.includes(
                          recording.id,
                        );
                        return (
                          <div
                            key={recording.id}
                            className="flex items-center gap-2 rounded-md border bg-background p-2 text-xs"
                          >
                            {newSourceMode === "selected_recordings" && (
                              <input
                                type="checkbox"
                                checked={selected}
                                aria-label={"Select recording " + recording.id}
                                onChange={() => {
                                  setSelectedRecordingIds((current) =>
                                    selected
                                      ? current.filter((id) =>
                                        id !== recording.id
                                      )
                                      : [...current, recording.id]
                                  );
                                  invalidateSourcePreview();
                                }}
                              />
                            )}
                            <div className="min-w-0 flex-1">
                              <p className="truncate font-medium">
                                {recording.name ??
                                  new Date(recording.start).toLocaleString()}
                              </p>
                              <p className="text-muted-foreground">
                                {recording.eligibleSegments} segments ·{" "}
                                {new Date(recording.start).toLocaleString()}
                              </p>
                            </div>
                            <Link
                              className="text-primary hover:underline"
                              to={"/timeline?start=" +
                                new Date(recording.start).getTime() + "&end=" +
                                new Date(recording.end).getTime()}
                            >
                              Timeline
                            </Link>
                          </div>
                        );
                      })}
                  </div>
                  {sourcePreview.recordings.length > 9 && (
                    <p className="text-xs text-muted-foreground">
                      Showing up to{" "}
                      {newSourceMode === "selected_recordings" ? 30 : 9} of{" "}
                      {sourcePreview.recordings.length}{" "}
                      recordings. Search, select, then preview again to freeze
                      the narrower source.
                    </p>
                  )}
                  {sourcePreview.sampleSegments.length > 0 && (
                    <div className="space-y-2 border-t pt-2">
                      <p className="text-xs font-medium">
                        Sample clips from this source
                      </p>
                      <div className="grid gap-2 md:grid-cols-2">
                        {sourcePreview.sampleSegments.slice(0, 5).map(
                          (segment) => {
                            const id = normalizeObjectId(segment._id) ??
                              `${segment.start}`;
                            const audioUrl = buildVoiceReviewAudioUrl(segment);
                            if (!audioUrl) return null;
                            const duration = Math.max(
                              0,
                              (new Date(segment.end).getTime() -
                                new Date(segment.start).getTime()) / 1_000,
                            );
                            return (
                              <div
                                key={id}
                                className="rounded-md border bg-background p-2"
                              >
                                <WaveformPlayer
                                  audioUrl={audioUrl}
                                  duration={duration}
                                  ariaLabel={`Preview ${
                                    duration.toFixed(1)
                                  } second voice clip`}
                                />
                                <p className="mt-1 text-xs text-muted-foreground">
                                  {duration.toFixed(1)}s ·{" "}
                                  {new Date(segment.start).toLocaleString()}
                                </p>
                              </div>
                            );
                          },
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {isLoading && selectedSessionId && (
            <div className="flex items-center gap-2 rounded-md border p-3 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />Loading saved review
              session…
            </div>
          )}
          {isError && (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/40 p-3 text-sm text-destructive">
              <AlertCircle className="h-4 w-4" />
              <span className="flex-1">
                Could not load the review session:{" "}
                {error instanceof Error ? error.message : "unknown error"}
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void refetch()}
              >
                <RefreshCw className="mr-2 h-4 w-4" />Retry
              </Button>
            </div>
          )}
          {reviewSession && reviewSession.loadedCount === 0 && (
            <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
              No unlabelled active diarization segments matched this frozen
              range. Complete it and start a wider session, or check Diarization
              coverage on Timeline.
            </div>
          )}
          {reviewSession && reviewSession.status !== "active" && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
              <div>
                <p className="font-medium">This saved stream is finished</p>
                <p className="text-xs text-muted-foreground">
                  Its labels are already counted above. Pending rows are only
                  the old preload buffer; start a new stream to keep reviewing.
                </p>
              </div>
              <Button size="sm" onClick={openReviewSetup}>
                Continue reviewing
              </Button>
            </div>
          )}
          {reviewSession && reviewSession.status === "active" &&
            reviewSession.loadedCount > 0 && (
            <>
              {reviewSession.loadedCount > 20 && (
                <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-muted-foreground">
                  This saved session has a legacy{" "}
                  {reviewSession.loadedCount}-item window. It is preserved so
                  its position and answers do not move. You can safely end it
                  and start a new 10-clip rolling session; saved labels remain
                  part of calibration.
                </div>
              )}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">
                  {reviewSession.querySnapshot?.candidateMode === "auto_matched"
                    ? "Auditing automatic matches"
                    : "Uncertain + unclassified"}
                </span>
                <span>{reviewSession.loadedCount} items in this window</span>
                <span>{reviewSession.groups.length} playback groups</span>
                {reviewSession.qualityStats && (
                  <span>
                    Quality filter hid{" "}
                    {reviewSession.qualityStats.shortExcluded} short ·{" "}
                    {reviewSession.qualityStats.duplicateExcluded} overlapping
                  </span>
                )}
                <span>
                  Backlog estimate:{" "}
                  {reviewSession.backlogEstimateCapped ? "at least " : ""}
                  {reviewSession.backlogEstimate}
                </span>
                <span>
                  {isFetching
                    ? "Saving/refreshing…"
                    : `Saved · revision ${reviewSession.revision}`}
                </span>
                <Button
                  size="sm"
                  variant={groupMode ? "secondary" : "outline"}
                  className="h-7"
                  disabled={reviewPending}
                  onClick={() =>
                    updatePosition.mutate({
                      preferences: { groupMode: !groupMode },
                    })}
                >
                  Group short clips: {groupMode ? "on" : "off"}
                </Button>
              </div>
              <div className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                Label only a clear target voice. Use{" "}
                <strong className="text-foreground">Skip</strong>{" "}
                for noise, humming you cannot identify, clipped speech, or two
                overlapping voices. Skipped audio is saved in the session but
                excluded from calibration.
                {!reviewSession.querySnapshot?.quality && (
                  <>
                    {" "}This older session predates automatic quality
                    filtering; use the Short filter or start a new clean-speech
                    session.
                  </>
                )}
              </div>
              {windowItems.every((item) => item.status !== "pending") &&
                reviewSession.status === "active" && (
                <div className="flex items-center justify-between rounded-md border border-green-500/30 bg-green-500/5 px-3 py-2 text-sm">
                  <span>
                    Window {reviewSession.windowNumber ?? 1} complete ·{" "}
                    {reviewSession.reviewedCount} reviewed and{" "}
                    {reviewSession.skippedCount} skipped across this session.
                  </span>
                  {reviewSession.hasMore
                    ? (
                      autoAdvanceWindow
                        ? (
                          <span className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Continuing automatically · loading next{" "}
                            {reviewSession.windowSize ?? 10}…
                          </span>
                        )
                        : (
                          <Button
                            size="sm"
                            onClick={() => loadNextWindow.mutate()}
                            disabled={reviewPending}
                          >
                            {loadNextWindow.isPending
                              ? "Loading…"
                              : `Load next ${reviewSession.windowSize ?? 10}`}
                          </Button>
                        )
                    )
                    : (
                      <span className="text-xs text-muted-foreground">
                        Source exhausted · press Finish stream when ready
                      </span>
                    )}
                </div>
              )}
              {activeGroup && groupMode && activeGroup.segmentIds.length > 1 &&
                (
                  <div className="rounded-md border border-sky-500/30 bg-sky-500/5 px-3 py-2 text-sm">
                    Playing one safe group:{" "}
                    <strong>
                      {activeGroup.segmentIds.length} short segments
                    </strong>
                    {" · "}
                    {activeGroup.durationSeconds.toFixed(1)}{" "}
                    sec. “Me”/“Not me” applies to {decisionSegmentIds.length}
                    {" "}
                    unreviewed items. Turn “Group short” off to label one at a
                    time.
                  </div>
                )}
              {playerSegment && (
                <VoiceIdentityReviewPlayer
                  key={`${
                    normalizeObjectId(playerSegment._id) ?? activeIndex
                  }-${activeGroup?.groupId ?? "single"}`}
                  segment={playerSegment}
                  profileName={reviewProfile?.name ?? "target profile"}
                  profileOptions={allProfileOptions}
                  position={reviewIndex + 1}
                  remaining={windowItems.filter((item) =>
                    item.status === "pending"
                  ).length}
                  sessionAnswered={(reviewSession.windowReviewedCount ?? 0) +
                    (reviewSession.windowSkippedCount ?? 0)}
                  sessionTotal={reviewSession.loadedCount}
                  pending={reviewPending || decisionSegmentIds.length === 0 ||
                    (reviewSession.status !== "active" && !editingSegmentId) ||
                    Boolean(historyEditingItem) ||
                    Boolean(calibrationEditingItem)}
                  shortcutsEnabled={!historyEditingItem &&
                    !calibrationEditingItem}
                  autoPlayNext={autoPlayNext}
                  playOnMount={playOnMount}
                  canPrevious={!editingSegmentId && activeIndex > 0}
                  canNext={!editingSegmentId &&
                    activeIndex < windowItems.length - 1}
                  canUndo={history.length > 0}
                  canEdit={Boolean(reviewItem) &&
                    ["reviewed", "skipped"].includes(reviewItem.status) &&
                    !editingSegmentId}
                  editingLabel={editingSegmentId
                    ? reviewItem?.status === "skipped"
                      ? "Skipped"
                      : reviewItem?.decisionSummary?.profileName ??
                        `Not ${reviewProfile?.name ?? "target"}`
                    : null}
                  alternateProfiles={alternateProfiles}
                  creatingProfile={createReviewProfile.isPending}
                  onDecision={(state) => {
                    if (reviewPending) return;
                    if (state === "skip") {
                      skipCurrent();
                    } else if (state === "me") {
                      if (reviewProfileId) {
                        saveAssignment({
                          profileId: reviewProfileId,
                          excludedProfileIds: [],
                        });
                      }
                    } else if (reviewProfileId) {
                      saveAssignment({ excludedProfileIds: [reviewProfileId] });
                    }
                  }}
                  onAssignProfile={(assignedProfileId) => {
                    if (!reviewProfileId) return;
                    rememberAssignedProfile(assignedProfileId);
                    saveAssignment({
                      profileId: assignedProfileId,
                      excludedProfileIds: [reviewProfileId],
                    });
                  }}
                  onCreateProfile={async (name) => {
                    if (!reviewProfileId || decisionSegmentIds.length === 0) {
                      throw new Error("No review segment is selected");
                    }
                    const profile = await createReviewProfile.mutateAsync({
                      name,
                      segmentIds: [...decisionSegmentIds],
                    });
                    const createdProfileId = normalizeObjectId(profile._id);
                    if (!createdProfileId) {
                      throw new Error("New speaker profile has no valid ID");
                    }
                    rememberAssignedProfile(createdProfileId);
                    await label.mutateAsync({
                      clientRequestId: crypto.randomUUID(),
                      segmentIds: [...decisionSegmentIds],
                      profileId: createdProfileId,
                      excludedProfileIds: [reviewProfileId],
                      ...(editingSegmentId && reviewItem?.decisionSummary
                        ? {
                          replacesDecisionId:
                            reviewItem.decisionSummary.decisionId,
                        }
                        : {}),
                    });
                    toast.success(`${profile.name} created and assigned`, {
                      description:
                        "Add a clean Timeline voice sample before calibrating this speaker.",
                    });
                  }}
                  onPrevious={() => moveReview(-1)}
                  onNext={() => moveReview(1)}
                  onUndo={undoLast}
                  onEdit={() => reviewItem && beginEdit(reviewItem)}
                  onCancelEdit={cancelEdit}
                  onAutoPlayChange={setAutoPlayPreference}
                />
              )}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">
                    Loaded buffer · all {windowItems.length} items
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Edit works for labels and skips. Previous windows are in
                    Reviewed history below.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    className="h-9 rounded-md border bg-background px-2 text-sm"
                    value={sessionItemFilter}
                    onChange={(event) =>
                      setSessionItemFilter(
                        event.target.value as typeof sessionItemFilter,
                      )}
                    aria-label="Filter current review items"
                  >
                    <option value="all">All items</option>
                    <option value="pending">Remaining</option>
                    <option value="reviewed">Labeled</option>
                    <option value="skipped">Skipped</option>
                    <option value="short">Shorter than 1 second</option>
                  </select>
                  {pendingShortIds.length > 0 && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={reviewPending}
                      onClick={() =>
                        skipDecision.mutate({
                          segmentIds: pendingShortIds,
                        })}
                    >
                      Skip {pendingShortIds.length} short remaining
                    </Button>
                  )}
                </div>
              </div>
              <div
                className="max-h-[28rem] overflow-y-auto rounded-lg border"
                aria-label="Review session items"
              >
                {visibleWindowItems.map((item) => {
                  const index = windowItems.findIndex((candidate) =>
                    normalizeObjectId(candidate.segmentId) ===
                      normalizeObjectId(item.segmentId)
                  );
                  const id = normalizeObjectId(item.segmentId) ?? "";
                  const segment = segmentById.get(id);
                  if (!segment) return null;
                  const duration = Math.max(
                    0,
                    (new Date(segment.end).getTime() -
                      new Date(segment.start).getTime()) / 1_000,
                  );
                  const group = reviewSession.groups.find((candidate) =>
                    candidate.groupId === item.groupId
                  );
                  const previousGroupId = index > 0
                    ? windowItems[index - 1]?.groupId
                    : null;
                  const score = segment.speakerIdentity?.primaryScore;
                  const manualLabel = item.decisionSummary?.profileId
                    ? item.decisionSummary.profileName ?? "Deleted profile"
                    : item.decisionSummary?.excludedProfileIds.includes(
                        reviewProfileId ?? "",
                      )
                    ? `Not ${reviewProfile?.name ?? "target"}`
                    : null;
                  const modelProfile = profiles.find((profile) =>
                    normalizeObjectId(profile._id) ===
                      normalizeObjectId(
                        (segment.speakerIdentity as any)?.profileId,
                      )
                  );
                  const identityLabel = manualLabel
                    ? `${manualLabel} · Manual`
                    : item.status === "skipped"
                    ? "Skipped"
                    : item.status === "reviewed"
                    ? "Reviewed · Manual"
                    : segment.speakerIdentity?.state === "matched"
                    ? `${modelProfile?.name ?? "Matched profile"} · Model`
                    : segment.speakerIdentity?.state === "rejected"
                    ? `Not ${reviewProfile?.name ?? "target"} · Model`
                    : segment.speakerIdentity?.state === "uncertain"
                    ? "Uncertain · Model"
                    : "Pending";
                  return (
                    <div key={id}>
                      {item.groupId !== previousGroupId && group && (
                        <div className="sticky top-0 flex items-center justify-between border-b bg-muted/90 px-3 py-1 text-[11px] text-muted-foreground backdrop-blur">
                          <span>
                            {group.segmentIds.length > 1
                              ? `Group · ${group.segmentIds.length} nearby segments`
                              : "Single segment"}
                          </span>
                          <span>
                            {group.durationSeconds.toFixed(1)} sec ·{" "}
                            {group.speaker ?? "speaker unknown"}
                          </span>
                        </div>
                      )}
                      <div
                        className={`flex min-w-[48rem] items-center border-b transition-colors ${
                          id === reviewId
                            ? "bg-sky-500/10 ring-1 ring-inset ring-sky-500/40"
                            : "hover:bg-muted/50"
                        }`}
                      >
                        <button
                          type="button"
                          className="grid h-10 flex-1 grid-cols-[2.5rem_8rem_4rem_minmax(7rem,1fr)_10rem] items-center gap-2 px-3 text-left text-xs"
                          onClick={() => openReviewSegment(id)}
                        >
                          <span className="tabular-nums text-muted-foreground">
                            #{index + 1}
                          </span>
                          <span className="tabular-nums">
                            {new Date(segment.start).toLocaleString()}
                          </span>
                          <span
                            className={duration < 1
                              ? "font-medium text-amber-600"
                              : ""}
                          >
                            {duration.toFixed(1)}s
                          </span>
                          <span className="truncate text-muted-foreground">
                            {(segment as any).speaker ?? "speaker unknown"}
                            {duration < 1
                              ? " · very short; skip if unclear/noise"
                              : ""}
                            {item.quality?.duplicateCount
                              ? ` · ${item.quality.duplicateCount} overlapping duplicate${
                                item.quality.duplicateCount === 1 ? "" : "s"
                              } hidden`
                              : ""}
                          </span>
                          <span
                            className={item.decisionSummary
                              ? "font-medium text-green-600"
                              : item.status === "skipped"
                              ? "text-amber-600"
                              : "text-muted-foreground"}
                          >
                            {identityLabel}
                            {!item.decisionSummary && typeof score === "number"
                              ? ` · ${Math.round(score * 100)}%`
                              : ""}
                          </span>
                        </button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="mr-2 h-8"
                          aria-label={`Edit segment ${index + 1}`}
                          disabled={item.status === "pending" || reviewPending}
                          onClick={() => beginEdit(item)}
                        >
                          Edit
                        </Button>
                      </div>
                    </div>
                  );
                })}
                {visibleWindowItems.length === 0 && (
                  <div className="p-6 text-center text-sm text-muted-foreground">
                    No items match this filter.
                  </div>
                )}
              </div>
            </>
          )}
          <div
            ref={reviewHistoryRef}
            className="scroll-mt-4 rounded-lg border"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 border-b p-3">
              <div>
                <p className="text-sm font-medium">
                  Latest saved label
                </p>
                <p className="text-xs text-muted-foreground">
                  Every answer is saved immediately and can be corrected.
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setShowReviewHistory((value) => !value);
                  setHistoryRecordingId(null);
                  setHistoryEditingItem(null);
                  useAudioPlaybackStore.getState().stopActive();
                }}
              >
                {showReviewHistory ? "Hide older labels" : "Show history"}
              </Button>
            </div>
            {reviewHistoryLoading
              ? (
                <div className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />Loading latest
                  label…
                </div>
              )
              : latestReviewHistoryItem
              ? (() => {
                const item = latestReviewHistoryItem;
                const duration = Math.max(
                  0,
                  (new Date(item.segment.end).getTime() -
                    new Date(item.segment.start).getTime()) / 1_000,
                );
                return (
                  <div className="flex flex-wrap items-center gap-3 bg-muted/20 px-3 py-2 text-sm">
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left hover:text-primary"
                      onClick={() => {
                        useAudioPlaybackStore.getState().stopActive();
                        setShowReviewHistory(true);
                        setHistoryEditingItem(item);
                      }}
                    >
                      <span className="block font-medium">
                        {reviewHistoryLabel(item)}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {new Date(item.segment.start).toLocaleString()} ·{" "}
                        {duration.toFixed(1)}s ·{" "}
                        {item.segment.speaker ?? "speaker unknown"}
                      </span>
                    </button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        useAudioPlaybackStore.getState().stopActive();
                        setShowReviewHistory(true);
                        setHistoryEditingItem(item);
                      }}
                    >
                      Listen / edit
                    </Button>
                  </div>
                );
              })()
              : (
                <p className="p-3 text-sm text-muted-foreground">
                  No saved labels yet.
                </p>
              )}
            {showReviewHistory && (
              <div className="space-y-3 border-t p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      className="h-9 rounded-md border bg-background px-2 text-sm"
                      value={historyFilter}
                      onChange={(event) =>
                        setHistoryFilter(
                          event.target.value as typeof historyFilter,
                        )}
                      aria-label="Filter reviewed history"
                    >
                      <option value="all">All previous answers</option>
                      <option value="assigned">Speaker labels</option>
                      <option value="skipped">Skipped / noise</option>
                    </select>
                    {historyRecordingId && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setHistoryRecordingId(null)}
                      >
                        One calibration recording · clear filter
                      </Button>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {reviewHistoryFetching
                      ? "Refreshing…"
                      : olderVisibleReviewHistory.length + " older labels"}
                  </span>
                </div>
                {historyEditingItem && (
                  <VoiceIdentityReviewPlayer
                    key={"history-" + historyEditingItem.decisionId}
                    segment={historyEditingItem.segment}
                    profileName={reviewProfile?.name ?? "target profile"}
                    profileOptions={allProfileOptions}
                    position={1}
                    remaining={0}
                    sessionAnswered={1}
                    sessionTotal={1}
                    pending={reviseHistory.isPending ||
                      createReviewProfile.isPending}
                    autoPlayNext={false}
                    playOnMount={false}
                    canPrevious={false}
                    canNext={false}
                    canUndo={false}
                    canEdit={false}
                    editingLabel={reviewHistoryLabel(historyEditingItem)}
                    alternateProfiles={alternateProfiles}
                    creatingProfile={createReviewProfile.isPending}
                    onDecision={(state) => {
                      if (!reviewProfileId) return;
                      if (state === "skip") {
                        reviseHistory.mutate({
                          item: historyEditingItem,
                          outcome: "skipped",
                        });
                      } else if (state === "me") {
                        reviseHistory.mutate({
                          item: historyEditingItem,
                          outcome: "assigned",
                          assignedProfileId: reviewProfileId,
                        });
                      } else {
                        reviseHistory.mutate({
                          item: historyEditingItem,
                          outcome: "assigned",
                          excludedProfileIds: [reviewProfileId],
                        });
                      }
                    }}
                    onAssignProfile={(assignedProfileId) => {
                      if (!reviewProfileId) return;
                      rememberAssignedProfile(assignedProfileId);
                      reviseHistory.mutate({
                        item: historyEditingItem,
                        outcome: "assigned",
                        assignedProfileId,
                        excludedProfileIds: [reviewProfileId],
                      });
                    }}
                    onCreateProfile={async (name) => {
                      if (!reviewProfileId) return;
                      const segmentId = normalizeObjectId(
                        historyEditingItem.segment._id,
                      );
                      if (!segmentId) throw new Error("Segment is unavailable");
                      const profile = await createReviewProfile.mutateAsync({
                        name,
                        segmentIds: [segmentId],
                      });
                      const assignedProfileId = normalizeObjectId(profile._id);
                      if (!assignedProfileId) {
                        throw new Error("New speaker profile has no valid ID");
                      }
                      rememberAssignedProfile(assignedProfileId);
                      await reviseHistory.mutateAsync({
                        item: historyEditingItem,
                        outcome: "assigned",
                        assignedProfileId,
                        excludedProfileIds: [reviewProfileId],
                      });
                    }}
                    onPrevious={() => {}}
                    onNext={() => {}}
                    onUndo={() => {}}
                    onEdit={() => {}}
                    onCancelEdit={() => {
                      useAudioPlaybackStore.getState().stopActive();
                      setHistoryEditingItem(null);
                    }}
                    onAutoPlayChange={() => {}}
                  />
                )}
                {!reviewHistoryLoading && (
                  <div
                    className="max-h-[24rem] overflow-y-auto rounded-md border"
                    aria-label="Reviewed history items"
                  >
                    {olderVisibleReviewHistory.map((item) => {
                      const duration = Math.max(
                        0,
                        (new Date(item.segment.end).getTime() -
                          new Date(item.segment.start).getTime()) / 1_000,
                      );
                      const startMs = new Date(item.segment.start).getTime();
                      const endMs = new Date(item.segment.end).getTime();
                      return (
                        <div
                          key={item.decisionId + "-" +
                            normalizeObjectId(item.segment._id)}
                          className={`grid gap-2 border-b px-3 py-2 text-xs last:border-b-0 sm:grid-cols-[minmax(12rem,1fr)_8rem_auto_auto] sm:items-center ${
                            historyEditingItem?.decisionId === item.decisionId
                              ? "bg-sky-500/10"
                              : "hover:bg-muted/40"
                          }`}
                        >
                          <button
                            type="button"
                            className="min-w-0 text-left"
                            onClick={() => {
                              useAudioPlaybackStore.getState().stopActive();
                              setHistoryEditingItem(item);
                            }}
                          >
                            <span className="block truncate font-medium">
                              {new Date(item.segment.start).toLocaleString()} ·
                              {" "}
                              {duration.toFixed(1)}s
                            </span>
                            <span className="block truncate text-muted-foreground">
                              {item.sessionName} ·{" "}
                              {item.segment.speaker ?? "speaker unknown"}
                            </span>
                          </button>
                          <span
                            className={item.outcome === "skipped"
                              ? "text-amber-600"
                              : "font-medium text-green-600"}
                          >
                            {reviewHistoryLabel(item)}
                          </span>
                          <Link
                            className="text-primary hover:underline"
                            to={"/timeline?start=" + (startMs - 5_000) +
                              "&end=" + (endMs + 5_000)}
                          >
                            Timeline
                          </Link>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              useAudioPlaybackStore.getState().stopActive();
                              setHistoryEditingItem(item);
                            }}
                          >
                            Select
                          </Button>
                        </div>
                      );
                    })}
                    {olderVisibleReviewHistory.length === 0 && (
                      <div className="p-6 text-center text-sm text-muted-foreground">
                        No older saved labels match this filter.
                      </div>
                    )}
                  </div>
                )}
                {reviewHistory?.hasMore && (
                  <p className="text-xs text-muted-foreground">
                    Showing the 200 most recent current answers. Older answers
                    remain stored.
                  </p>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
      <Card id="calibration" ref={calibrationSectionRef}>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <CardTitle>
                3. Check whether {primary?.name ?? "the primary voice"} is ready
              </CardTitle>
              <CardDescription>
                The label count is only the first gate. This check learns a
                boundary on some recordings and tests it on different audio.
              </CardDescription>
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={calibrationPreviewFetching}
              onClick={() => void recalculateCalibration()}
            >
              <RefreshCw
                className={`mr-1 h-4 w-4 ${
                  calibrationPreviewFetching ? "animate-spin" : ""
                }`}
              />
              {calibrationPreviewFetching
                ? "Recalculating on server…"
                : "Refresh result"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-md border bg-muted/20 p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <strong>
                  Calibration target: {primary?.name ?? "Sky"} · primary · rev.
                  {" "}
                  {primary?.revision ?? 1}
                </strong>
                <p className="text-xs text-muted-foreground">
                  Embedding space:{" "}
                  {primary?.embeddingSpaceId ?? "missing — re-enroll required"}
                </p>
              </div>
              {calibrationPreviewUpdatedAt > 0 && !calibrationPreviewFetching &&
                (
                  <span className="text-xs text-muted-foreground">
                    Preview updated{" "}
                    {new Date(calibrationPreviewUpdatedAt).toLocaleTimeString()}
                  </span>
                )}
            </div>
            {reviewProfileId && reviewProfileId !== profileId && (
              <div className="mt-2 rounded border border-amber-500/40 bg-amber-500/5 p-2 text-xs">
                You are reviewing{" "}
                {reviewProfile?.name ?? "another profile"}, but this calibration
                remains Sky-first. Assign or exclude Sky explicitly for those
                labels to affect this calibration.
              </div>
            )}
          </div>

          {calibrationPreview && (
            <div
              className={`rounded-lg border p-4 ${
                canValidate
                  ? "border-green-500/40 bg-green-500/5"
                  : labelGateReady
                  ? "border-amber-500/40 bg-amber-500/5"
                  : "bg-muted/20"
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">
                    {canValidate
                      ? "Ready to save and classify"
                      : !labelGateReady
                      ? "More clear labels are needed"
                      : calibrationPreview.validationMetrics
                      ? `Not ready yet: ${
                        (calibrationPreview.validationMetrics
                          .positivePrecision * 100).toFixed(1)
                      }% verified accuracy, ${
                        Math.round(calibrationTargetPrecision * 100)
                      }% required`
                      : "Choose separate Learn and Check recordings"}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {canValidate
                      ? `The independent Check set passed. Save this calibration, then run speakerIdentity for 24 hours.`
                      : labelGateReady &&
                          calibrationPreview.validationMetrics
                      ? `${calibrationPreview.validationMetrics.falsePositive} of ${calibrationPreview.validationMetrics.identified} automatic “${
                        primary?.name ?? "Me"
                      }” results were false on unseen recordings. Review labels in the Check recordings or try a bounded pilot below.`
                      : `Keep reviewing clear speech until the label and recording requirements below are complete.`}
                  </p>
                </div>
                <div className="text-right text-xs text-muted-foreground">
                  <strong className="block text-foreground">
                    {calibrationPreview.counts.total} usable labels ·{" "}
                    {calibrationPreview.counts.recordings} recordings
                  </strong>
                  Refresh uses saved embeddings. It does not classify history or
                  save anything.
                </div>
              </div>
            </div>
          )}

          <div className="rounded-md border bg-muted/20 p-3 text-sm">
            <strong>How this check works</strong>
            <p className="mt-1 text-xs text-muted-foreground">
              <strong className="text-foreground">Learn</strong>{" "}
              recordings choose the similarity boundary →{" "}
              <strong className="text-foreground">Check</strong>{" "}
              recordings test that frozen boundary on unseen audio → Save only
              when the selected accuracy target passes. Changing a recording
              role recalculates automatically; Refresh simply repeats the same
              test with the latest saved labels.
            </p>
          </div>

          <div className="space-y-3 rounded-md border bg-muted/20 p-3">
            <div>
              <p className="text-sm font-medium">
                Accuracy target
              </p>
              <p className="text-xs text-muted-foreground">
                98% enables full history. Lower targets are limited to a
                risk-acknowledged 24-hour pilot.
              </p>
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              {CALIBRATION_PRECISION_PRESETS.map((preset) => (
                <Button
                  key={preset.value}
                  type="button"
                  variant={calibrationTargetPrecision === preset.value
                    ? "default"
                    : "outline"}
                  className="h-auto justify-start px-3 py-2 text-left"
                  onClick={() => {
                    setCalibrationTargetPrecision(preset.value);
                    setAcceptLowerPrecisionRisk(false);
                    resetPositiveThresholdOverride();
                    setCalibrationRefreshResult(null);
                  }}
                >
                  <span>
                    <span className="block font-semibold">{preset.label}</span>
                    <span className="block text-xs opacity-75">
                      {preset.detail}
                    </span>
                  </span>
                </Button>
              ))}
            </div>
            <details className="rounded-md border bg-background px-3 py-2 text-xs">
              <summary className="cursor-pointer font-medium">
                Advanced: custom accuracy target
              </summary>
              <label className="mt-2 flex max-w-xs items-center gap-2 text-muted-foreground">
                Required precision
                <Input
                  className="h-8 w-24"
                  type="number"
                  min={90}
                  max={100}
                  step={0.5}
                  value={Number(
                    (calibrationTargetPrecision * 100).toFixed(1),
                  )}
                  onChange={(event) => {
                    const percent = Number(event.target.value);
                    if (
                      !Number.isFinite(percent) || percent < 90 ||
                      percent > 100
                    ) return;
                    setCalibrationTargetPrecision(
                      Number((percent / 100).toFixed(3)),
                    );
                    setAcceptLowerPrecisionRisk(false);
                    resetPositiveThresholdOverride();
                    setCalibrationRefreshResult(null);
                  }}
                  aria-label="Custom required precision percent"
                />
                <span>%</span>
              </label>
            </details>
            {lowerPrecisionPilot
              ? (
                <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs">
                  <p>
                    <strong>Limited pilot only.</strong> A{" "}
                    {Math.round(calibrationTargetPrecision * 100)}% target can
                    tolerate roughly{" "}
                    {Math.round((1 - calibrationTargetPrecision) * 100)}{" "}
                    false matches per 100 automatic “Me” results in this
                    validation sample. Real recordings may perform worse. This
                    calibration is limited to 24 hours and cannot unlock
                    historical backfill.
                  </p>
                  <label className="flex cursor-pointer items-start gap-2">
                    <Checkbox
                      checked={acceptLowerPrecisionRisk}
                      onCheckedChange={(checked) =>
                        setAcceptLowerPrecisionRisk(checked === true)}
                      aria-label="Accept lower precision pilot risk"
                    />
                    <span>
                      I understand the false-match risk and want to save a
                      bounded pilot calibration.
                    </span>
                  </label>
                </div>
              )
              : (
                <p className="text-xs text-muted-foreground">
                  Production mode: the server chooses the safest threshold from
                  Learn audio and requires the independent Check set to pass.
                </p>
              )}
          </div>

          <div
            className={`rounded-md border p-3 text-sm ${
              calibrationRefreshResult?.state === "error"
                ? "border-destructive/40 text-destructive"
                : "text-muted-foreground"
            }`}
          >
            {calibrationPreviewFetching
              ? "Recalculating scores and thresholds on the server…"
              : calibrationRefreshResult?.message ??
                "Refresh repeats the current Learn/Check calculation. Save below creates the calibration used by jobs."}
          </div>

          {calibrationPreviewLoading && (
            <div className="flex items-center gap-2 rounded-md border p-3 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />Computing scores from
              reviewed embeddings…
            </div>
          )}
          {calibrationPreviewIsError && (
            <div className="rounded-md border border-destructive/40 p-3 text-sm text-destructive">
              Calibration preview failed:{" "}
              {calibrationPreviewError instanceof Error
                ? calibrationPreviewError.message
                : "unknown error"}
            </div>
          )}

          {calibrationPreview && (
            <>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-md border bg-muted/20 p-3 text-sm">
                  <span className="text-xs text-muted-foreground">
                    Independent accuracy
                  </span>
                  <p
                    className={`text-xl font-semibold tabular-nums ${
                      (calibrationPreview.validationMetrics
                          ?.positivePrecision ?? 0) >=
                          calibrationTargetPrecision
                        ? "text-green-600"
                        : "text-amber-600"
                    }`}
                  >
                    {calibrationPreview.validationMetrics
                      ? `${
                        (calibrationPreview.validationMetrics
                          .positivePrecision * 100).toFixed(1)
                      }%`
                      : "—"}
                  </p>
                </div>
                <div className="rounded-md border bg-muted/20 p-3 text-sm">
                  <span className="text-xs text-muted-foreground">
                    Automatic results
                  </span>
                  <p className="text-xl font-semibold tabular-nums">
                    {calibrationPreview.validationMetrics
                      ? `${calibrationPreview.validationMetrics.identified}/${calibrationPreview.validationMetrics.total}`
                      : "—"}
                  </p>
                </div>
                <div className="rounded-md border bg-muted/20 p-3 text-sm">
                  <span className="text-xs text-muted-foreground">
                    Wrong “{primary?.name ?? "Me"}” results
                  </span>
                  <p
                    className={`text-xl font-semibold tabular-nums ${
                      (calibrationPreview.validationMetrics?.falsePositive ??
                          0) === 0
                        ? "text-green-600"
                        : "text-amber-600"
                    }`}
                  >
                    {calibrationPreview.validationMetrics?.falsePositive ?? "—"}
                  </p>
                  {falsePositiveIssues.length > 0 && (
                    <Button
                      type="button"
                      size="sm"
                      variant="link"
                      className="h-auto px-0 py-1 text-xs"
                      onClick={() => {
                        setCalibrationProblemKind("falsePositive");
                        setCalibrationProblemRecordingId(null);
                        setShowCalibrationProblems(true);
                      }}
                    >
                      Review {falsePositiveIssues.length} problem clips
                    </Button>
                  )}
                </div>
                <div className="rounded-md border bg-muted/20 p-3 text-sm">
                  <span className="text-xs text-muted-foreground">
                    Found “{primary?.name ?? "Me"}” speech
                  </span>
                  <p className="text-xl font-semibold tabular-nums">
                    {calibrationPreview.validationMetrics
                      ? `${
                        (calibrationPreview.validationMetrics.positiveRecall *
                          100).toFixed(1)
                      }%`
                      : "—"}
                  </p>
                </div>
              </div>

              {(falsePositiveIssues.length > 0 ||
                missedPositiveIssues.length > 0) && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium">
                        Clips that failed the independent check
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Listen before changing anything. If your saved label is
                        wrong, correct it here; if the label is right, keep it —
                        the matcher threshold needs to improve instead.
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setShowCalibrationProblems((value) => !value);
                        setCalibrationProblemRecordingId(null);
                        setCalibrationEditingItem(null);
                        setCalibrationEditingPlayOnMount(false);
                        useAudioPlaybackStore.getState().stopActive();
                      }}
                    >
                      {showCalibrationProblems
                        ? "Hide problem clips"
                        : "Review problem clips"}
                    </Button>
                  </div>
                  {labelGateReady && !canValidate && (
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-500/20 bg-background/70 px-3 py-2 text-xs">
                      <p className="max-w-3xl text-muted-foreground">
                        <strong className="text-foreground">
                          {calibrationLabelCounts.total}{" "}
                          labels are enough to diagnose this result.
                        </strong>{" "}
                        If the problem labels are correct, audit the{" "}
                        {primary?.sample_count ?? 0}{" "}
                        saved Sky samples for a second speaker, overlap, noise,
                        or long silence. Sky is currently one averaged profile
                        embedding, so one outlier can move every score. Replace
                        only bad samples, rebuild Sky, then refresh this check;
                        your labels stay saved.
                      </p>
                      <Button asChild type="button" size="sm" variant="outline">
                        <Link to="/settings/voice-profiles">
                          Audit Sky samples
                        </Link>
                      </Button>
                    </div>
                  )}
                  {showCalibrationProblems && (
                    <div className="mt-3 space-y-3 border-t border-amber-500/20 pt-3">
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant={calibrationProblemKind === "falsePositive"
                            ? "default"
                            : "outline"}
                          onClick={() => {
                            setCalibrationProblemKind("falsePositive");
                            setCalibrationProblemRecordingId(null);
                            setCalibrationEditingItem(null);
                            setCalibrationEditingPlayOnMount(false);
                          }}
                        >
                          Wrong “{primary?.name ?? "Me"}” ·{" "}
                          {falsePositiveIssues.length}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant={calibrationProblemKind === "missedPositive"
                            ? "default"
                            : "outline"}
                          onClick={() => {
                            setCalibrationProblemKind("missedPositive");
                            setCalibrationProblemRecordingId(null);
                            setCalibrationEditingItem(null);
                            setCalibrationEditingPlayOnMount(false);
                          }}
                        >
                          Missed “{primary?.name ?? "Me"}” ·{" "}
                          {missedPositiveIssues.length}
                        </Button>
                        {calibrationProblemRecordingId && (
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            onClick={() =>
                              setCalibrationProblemRecordingId(null)}
                          >
                            One recording · show all
                          </Button>
                        )}
                      </div>

                      {calibrationEditingItem && (
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-background p-2">
                            <span className="text-sm font-medium">
                              Problem {calibrationEditingIndex + 1} of{" "}
                              {visibleCalibrationIssues.length}
                            </span>
                            <div className="flex gap-2">
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={calibrationEditingIndex <= 0 ||
                                  reviseHistory.isPending}
                                onClick={() =>
                                  openCalibrationIssueAt(
                                    calibrationEditingIndex - 1,
                                  )}
                              >
                                Previous problem
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                disabled={calibrationEditingIndex < 0 ||
                                  calibrationEditingIndex >=
                                    visibleCalibrationIssues.length - 1 ||
                                  reviseHistory.isPending}
                                onClick={() =>
                                  openCalibrationIssueAt(
                                    calibrationEditingIndex + 1,
                                  )}
                              >
                                Next problem · autoplay
                              </Button>
                            </div>
                          </div>
                          <VoiceIdentityReviewPlayer
                            key={"calibration-" +
                              calibrationEditingItem.decisionId}
                            segment={calibrationEditingItem.segment}
                            profileName={reviewProfile?.name ??
                              "target profile"}
                            profileOptions={allProfileOptions}
                            position={calibrationEditingIndex + 1}
                            remaining={Math.max(
                              0,
                              visibleCalibrationIssues.length -
                                calibrationEditingIndex - 1,
                            )}
                            sessionAnswered={calibrationEditingIndex + 1}
                            sessionTotal={visibleCalibrationIssues.length}
                            pending={reviseHistory.isPending ||
                              createReviewProfile.isPending}
                            autoPlayNext={false}
                            playOnMount={calibrationEditingPlayOnMount}
                            canPrevious={calibrationEditingIndex > 0}
                            canNext={calibrationEditingIndex >= 0 &&
                              calibrationEditingIndex <
                                visibleCalibrationIssues.length - 1}
                            canUndo={false}
                            canEdit={false}
                            editingLabel={reviewHistoryLabel(
                              calibrationEditingItem,
                            )}
                            alternateProfiles={alternateProfiles}
                            creatingProfile={createReviewProfile.isPending}
                            onDecision={(state) => {
                              if (!reviewProfileId) return;
                              if (state === "skip") {
                                reviseHistory.mutate({
                                  item: calibrationEditingItem,
                                  outcome: "skipped",
                                });
                              } else if (state === "me") {
                                reviseHistory.mutate({
                                  item: calibrationEditingItem,
                                  outcome: "assigned",
                                  assignedProfileId: reviewProfileId,
                                });
                              } else {
                                reviseHistory.mutate({
                                  item: calibrationEditingItem,
                                  outcome: "assigned",
                                  excludedProfileIds: [reviewProfileId],
                                });
                              }
                            }}
                            onAssignProfile={(assignedProfileId) => {
                              if (!reviewProfileId) return;
                              rememberAssignedProfile(assignedProfileId);
                              reviseHistory.mutate({
                                item: calibrationEditingItem,
                                outcome: "assigned",
                                assignedProfileId,
                                excludedProfileIds: [reviewProfileId],
                              });
                            }}
                            onCreateProfile={async (name) => {
                              if (!reviewProfileId) return;
                              const segmentId = normalizeObjectId(
                                calibrationEditingItem.segment._id,
                              );
                              if (!segmentId) {
                                throw new Error("Segment is unavailable");
                              }
                              const created = await createReviewProfile
                                .mutateAsync({ name, segmentIds: [segmentId] });
                              const assignedProfileId = normalizeObjectId(
                                created._id,
                              );
                              if (!assignedProfileId) {
                                throw new Error(
                                  "New speaker profile has no valid ID",
                                );
                              }
                              rememberAssignedProfile(assignedProfileId);
                              await reviseHistory.mutateAsync({
                                item: calibrationEditingItem,
                                outcome: "assigned",
                                assignedProfileId,
                                excludedProfileIds: [reviewProfileId],
                              });
                            }}
                            onPrevious={() =>
                              openCalibrationIssueAt(
                                calibrationEditingIndex - 1,
                              )}
                            onNext={() =>
                              openCalibrationIssueAt(
                                calibrationEditingIndex + 1,
                              )}
                            onUndo={() => {}}
                            onEdit={() => {}}
                            onCancelEdit={() => {
                              useAudioPlaybackStore.getState().stopActive();
                              setCalibrationEditingItem(null);
                              setCalibrationEditingPlayOnMount(false);
                            }}
                            onAutoPlayChange={() => {}}
                          />
                        </div>
                      )}

                      <div className="max-h-[24rem] overflow-y-auto rounded-md border bg-background">
                        {visibleCalibrationIssues.map((issue, issueIndex) => {
                          const duration = Math.max(
                            0,
                            (new Date(issue.segment.end).getTime() -
                              new Date(issue.segment.start).getTime()) / 1_000,
                          );
                          const startMs = new Date(issue.segment.start)
                            .getTime();
                          const endMs = new Date(issue.segment.end).getTime();
                          return (
                            <div
                              key={issue.kind + "-" + issue.segmentId}
                              className={`grid gap-2 border-b px-3 py-2 text-xs last:border-b-0 sm:grid-cols-[minmax(14rem,1fr)_7rem_auto_auto] sm:items-center ${
                                calibrationEditingItem?.decisionId ===
                                    issue.decisionId
                                  ? "bg-sky-500/10"
                                  : ""
                              }`}
                            >
                              <button
                                type="button"
                                className="min-w-0 text-left"
                                disabled={!issue.decisionId}
                                onClick={() =>
                                  openCalibrationIssueAt(issueIndex)}
                              >
                                <span className="block truncate font-medium">
                                  {new Date(issue.segment.start)
                                    .toLocaleString()} · {duration.toFixed(1)}s
                                </span>
                                <span className="block truncate text-muted-foreground">
                                  {issue.kind === "false_positive"
                                    ? `Labeled Not ${
                                      primary?.name ?? "Me"
                                    }, matcher predicted ${
                                      primary?.name ?? "Me"
                                    }`
                                    : `Labeled ${
                                      primary?.name ?? "Me"
                                    }, matcher left it ${issue.decision}`}
                                </span>
                              </button>
                              <span className="tabular-nums text-muted-foreground">
                                similarity {Math.round(issue.score * 100)}%
                              </span>
                              <Link
                                className="text-primary hover:underline"
                                to={`/timeline?start=${startMs - 5_000}&end=${
                                  endMs + 5_000
                                }`}
                              >
                                Timeline
                              </Link>
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                disabled={!issue.decisionId}
                                onClick={() =>
                                  openCalibrationIssueAt(issueIndex)}
                              >
                                Listen / fix
                              </Button>
                            </div>
                          );
                        })}
                        {visibleCalibrationIssues.length === 0 && (
                          <p className="p-4 text-sm text-muted-foreground">
                            No clips in this problem category.
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              <details className="rounded-md border bg-muted/10 p-3 text-sm">
                <summary className="cursor-pointer font-medium">
                  Advanced threshold diagnostics
                </summary>
                <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
                  <span>
                    Learned Sky threshold{" "}
                    <strong>
                      {calibrationPreview.thresholds?.positiveThreshold
                        .toFixed(3) ?? "—"}
                    </strong>
                  </span>
                  <span>
                    Not-Sky mode{" "}
                    <strong>
                      {previewNegativeDecisionMode === "uncertain_only"
                        ? "off · remains uncertain"
                        : calibrationPreview.thresholds?.negativeThreshold
                          .toFixed(3) ?? "—"}
                    </strong>
                  </span>
                  <span>
                    Compatible labels{" "}
                    <strong>
                      {calibrationPreview.counts.positive} Sky ·{" "}
                      {calibrationPreview.counts.negative} not-Sky
                    </strong>
                  </span>
                  <span>
                    Excluded old embeddings{" "}
                    <strong>{calibrationPreview.counts.incompatible}</strong>
                  </span>
                </div>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <strong className="mt-3 block">
                      Stricter automatic Sky matching
                    </strong>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Raising the positive cosine threshold produces fewer
                      automatic Sky matches. Coverage and recall usually fall;
                      precision may improve. The control can never go below the
                      server recommendation.
                    </p>
                  </div>
                  {calibrationPreview.positiveThresholdSource ===
                      "operator_stricter" && (
                    <span className="rounded-full bg-amber-500/10 px-2 py-1 text-xs font-medium text-amber-700 dark:text-amber-400">
                      Operator-stricter pilot
                    </span>
                  )}
                </div>
                {!lowerPrecisionPilot
                  ? (
                    <p className="mt-3 rounded-md border border-dashed p-2 text-xs text-muted-foreground">
                      Disabled for the 98–100% production policy. Production
                      thresholds are selected from Fit only; tuning them after
                      seeing Check results would contaminate independent
                      validation. Choose a provisional target below 98% to run a
                      bounded diagnostic pilot.
                    </p>
                  )
                  : recommendedPositiveThreshold == null ||
                      displayedPositiveThreshold == null
                  ? (
                    <p className="mt-3 text-xs text-muted-foreground">
                      A server recommendation must be calculated before this
                      control becomes available.
                    </p>
                  )
                  : (
                    <div className="mt-3 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                        <span>
                          Server recommendation{" "}
                          <strong className="tabular-nums">
                            {recommendedPositiveThreshold.toFixed(3)}
                          </strong>
                        </span>
                        <span>
                          Applied threshold{" "}
                          <strong className="tabular-nums">
                            {appliedPositiveThreshold?.toFixed(3) ?? "—"}
                          </strong>
                        </span>
                        {positiveThresholdDraft != null && (
                          <span className="text-amber-700 dark:text-amber-400">
                            Draft{" "}
                            <strong className="tabular-nums">
                              {positiveThresholdDraft.toFixed(3)}
                            </strong>{" "}
                            · not applied yet
                          </span>
                        )}
                      </div>
                      <Slider
                        min={recommendedPositiveThreshold}
                        max={1}
                        step={0.005}
                        value={[displayedPositiveThreshold]}
                        disabled={calibrationPreviewFetching}
                        onValueChange={([value]) => {
                          const clamped = clampPositiveThreshold(value);
                          if (clamped != null) {
                            setPositiveThresholdDraft(clamped);
                          }
                        }}
                        onValueCommit={([value]) =>
                          commitPositiveThresholdOverride(value)}
                        aria-label="Stricter positive Sky cosine threshold"
                      />
                      <div className="flex flex-wrap items-end gap-2">
                        <label className="min-w-36 flex-1">
                          <span className="text-xs text-muted-foreground">
                            Positive cosine threshold
                          </span>
                          <Input
                            className="mt-1 h-8 font-mono"
                            type="number"
                            min={recommendedPositiveThreshold}
                            max={1}
                            step={0.005}
                            value={displayedPositiveThreshold.toFixed(3)}
                            disabled={calibrationPreviewFetching}
                            onChange={(event) => {
                              const clamped = clampPositiveThreshold(
                                Number(event.target.value),
                              );
                              if (clamped != null) {
                                setPositiveThresholdDraft(clamped);
                              }
                            }}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                commitPositiveThresholdOverride(
                                  Number(event.currentTarget.value),
                                );
                                event.currentTarget.blur();
                              }
                            }}
                          />
                        </label>
                        <Button
                          type="button"
                          size="sm"
                          disabled={positiveThresholdDraft == null ||
                            calibrationPreviewFetching}
                          onClick={() => {
                            if (positiveThresholdDraft != null) {
                              commitPositiveThresholdOverride(
                                positiveThresholdDraft,
                              );
                            }
                          }}
                        >
                          {calibrationPreviewFetching
                            ? "Recalculating…"
                            : "Apply & recalculate"}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={positiveThresholdOverride == null &&
                            positiveThresholdDraft == null}
                          onClick={() => {
                            resetPositiveThresholdOverride();
                            setCalibrationRefreshResult(null);
                          }}
                        >
                          Use server recommendation
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Release the slider, or enter a number and press Apply
                        (or Enter), to recalculate held-out metrics. An
                        unapplied draft never changes the metrics or enables
                        Save. Any override makes this an explicitly
                        operator-tuned provisional pilot; it is not production
                        validation evidence.
                      </p>
                    </div>
                  )}
              </details>

              {previewNegativeDecisionMode === "uncertain_only" && (
                <div className="rounded-md border border-blue-500/30 bg-blue-500/5 p-3 text-sm">
                  <strong>Safe mode:</strong>{" "}
                  <span className="text-muted-foreground">
                    automatic Sky matches are allowed; everything else remains
                    uncertain instead of being marked not-Sky.
                  </span>
                </div>
              )}

              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium">
                      Choose recording roles
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {calibrationPreview.automaticSplit
                        ? "A balanced split is selected automatically. Change it only when a recording contains questionable labels or unusually similar voices."
                        : "Custom split active. Each recording must be in exactly one role."}
                    </p>
                  </div>
                  {!calibrationPreview.automaticSplit && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setCalibrationRecordings("");
                        setValidationRecordings("");
                        resetPositiveThresholdOverride();
                        setCalibrationRefreshResult(null);
                      }}
                    >
                      Restore recommended split
                    </Button>
                  )}
                </div>
                <div className="grid gap-2 md:grid-cols-3">
                  <div className="rounded-md border border-sky-500/30 bg-sky-500/5 p-3 text-xs">
                    <strong>Learn</strong>
                    <p className="mt-1 text-muted-foreground">
                      {fitRecordingSummary.recordings} recordings ·{" "}
                      {fitRecordingSummary.sky} Sky ·{" "}
                      {fitRecordingSummary.notSky} not-Sky
                    </p>
                    <p className="mt-1">Chooses the similarity boundary.</p>
                  </div>
                  <div className="rounded-md border border-green-500/30 bg-green-500/5 p-3 text-xs">
                    <strong>Independent check</strong>
                    <p className="mt-1 text-muted-foreground">
                      {validationRecordingSummary.recordings} recordings ·{" "}
                      {validationRecordingSummary.sky} Sky ·{" "}
                      {validationRecordingSummary.notSky} not-Sky
                    </p>
                    <p className="mt-1">
                      Measures accuracy on audio Learn never saw.
                    </p>
                  </div>
                  <div className="rounded-md border p-3 text-xs">
                    <strong>Not used</strong>
                    <p className="mt-1 text-muted-foreground">
                      Ignored by this calculation. Labels stay saved and can be
                      used later.
                    </p>
                  </div>
                </div>
                {calibrationPreview.recordings.length === 0
                  ? (
                    <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                      No compatible reviewed segments yet. Continue the review
                      session above.
                    </div>
                  )
                  : calibrationPreview.recordings.map((recording) => {
                    const selected =
                      effectiveCalibrationIds.includes(recording.id)
                        ? "calibration"
                        : effectiveValidationIds.includes(recording.id)
                        ? "validation"
                        : "unused";
                    const recordingIssues = calibrationIssueCountsByRecording
                      .get(recording.id);
                    const recordingIssueTotal = recordingIssues
                      ? recordingIssues.falsePositive +
                        recordingIssues.missedPositive
                      : 0;
                    return (
                      <div
                        key={recording.id}
                        title={`Recording ${recording.id}`}
                        className="grid gap-2 rounded-md border p-3 text-sm md:grid-cols-[minmax(14rem,1fr)_auto_minmax(13rem,auto)] md:items-center"
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <Link
                              className="font-medium text-primary hover:underline"
                              to={`/timeline?start=${
                                new Date(recording.start).getTime()
                              }&end=${new Date(recording.end).getTime()}`}
                            >
                              {new Date(recording.start).toLocaleString()} —
                              {" "}
                              {new Date(recording.end).toLocaleTimeString()}
                            </Link>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7"
                              onClick={() =>
                                openHistoryForRecording(recording.id)}
                            >
                              Review saved labels
                            </Button>
                            {recordingIssueTotal > 0 && (
                              <Button
                                size="sm"
                                variant="link"
                                className="h-7 px-0 text-amber-700 dark:text-amber-400"
                                onClick={() => {
                                  setCalibrationProblemKind(
                                    (recordingIssues?.falsePositive ?? 0) > 0
                                      ? "falsePositive"
                                      : "missedPositive",
                                  );
                                  setCalibrationProblemRecordingId(
                                    recording.id,
                                  );
                                  setShowCalibrationProblems(true);
                                  setCalibrationEditingItem(null);
                                  setCalibrationEditingPlayOnMount(false);
                                }}
                              >
                                {recordingIssueTotal}{" "}
                                check problem{recordingIssueTotal === 1
                                  ? ""
                                  : "s"}
                              </Button>
                            )}
                          </div>
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {recording.positive} Sky · {recording.negative}{" "}
                          not-Sky · {recording.total} total
                        </span>
                        <label className="text-xs text-muted-foreground">
                          Role in this calibration
                          <select
                            className="mt-1 block h-9 w-full rounded-md border bg-background px-2 text-sm text-foreground"
                            value={selected}
                            aria-label={`Calibration role for ${recording.id}`}
                            onChange={(event) =>
                              chooseRecordingSet(
                                recording.id,
                                event.target.value as
                                  | "calibration"
                                  | "validation"
                                  | "unused",
                              )}
                          >
                            <option value="calibration">
                              Learn — choose threshold
                            </option>
                            <option value="validation">
                              Check — test unseen audio
                            </option>
                            <option value="unused">
                              Not used — ignore for now
                            </option>
                          </select>
                        </label>
                      </div>
                    );
                  })}
              </div>

              {calibrationPreview.blockers.length > 0 && (
                <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
                  <div className="flex items-center gap-2 font-medium">
                    <AlertCircle className="h-4 w-4 text-amber-600" />Next
                    action
                  </div>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
                    {calibrationPreview.blockers.map((blocker) => (
                      <li key={blocker}>
                        {/Validation auto-match precision is below/i.test(
                            blocker,
                          )
                          ? `Independent accuracy is below ${
                            Math.round(calibrationTargetPrecision * 100)
                          }%. Review the saved labels in Check recordings, then refresh the result.`
                          : /Calibration set needs both/i.test(blocker)
                          ? "Learn needs both Sky and not-Sky examples. Move a mixed recording to Learn."
                          : /Validation set needs both/i.test(blocker)
                          ? "Check needs both Sky and not-Sky examples. Move a different mixed recording to Check."
                          : /at least two different source recordings/i.test(
                              blocker,
                            )
                          ? "Use at least two different recordings: one for Learn and another for Check."
                          : blocker}
                      </li>
                    ))}
                  </ul>
                  {calibrationPreview.blockers.some((blocker) =>
                    /No (?:threshold pair|auto-Sky threshold) reaches/i.test(
                      blocker,
                    )
                  ) && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      More random labels are not automatically better. Correct
                      ambiguous labels in Check, restore the recommended split,
                      or use 95%/90% only for a bounded 24-hour pilot.
                    </p>
                  )}
                </div>
              )}

              <Button
                className="w-full"
                onClick={() => saveCalibration.mutate()}
                disabled={saveCalibration.isPending || !canSaveCalibration}
              >
                {saveCalibration.isPending
                  ? "Saving server-verified calibration…"
                  : !canValidate
                  ? "Calibration is not ready yet"
                  : lowerPrecisionPilot && !acceptLowerPrecisionRisk
                  ? "Confirm the pilot risk to continue"
                  : lowerPrecisionPilot
                  ? `Save ${
                    Math.round(calibrationTargetPrecision * 100)
                  }% calibration for a 24-hour pilot`
                  : "Save validated calibration (98%) for full-range classification"}
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                Save verifies the result again. A sub-98% pilot never unlocks
                historical backfill.
              </p>
            </>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div>
            <CardTitle>Classify existing — current results</CardTitle>
            <CardDescription>
              Full-calibration results and bounded provisional pilot results are
              counted separately. Older incompatible decisions remain visible as
              stale.
            </CardDescription>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void calculateClassification()}
            disabled={!profileId || isCalculatingClassification}
          >
            <RefreshCw
              className={`mr-2 h-4 w-4 ${
                isCalculatingClassification ? "animate-spin" : ""
              }`}
            />
            {classificationSnapshot ? "Recalculate exact" : "Calculate exact"}
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/20 p-3">
            <div className="min-w-[16rem] flex-1">
              <p className="text-sm font-medium">Run speakerIdentity</p>
              <p className="text-xs text-muted-foreground">
                The Jobs launcher resolves Sky, its current revision,
                server-validated calibration, and a compatible active
                diarization generation automatically. Start with 24 hours,
                review the result, then expand the range.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button asChild size="sm">
                <Link to="/jobs?type=speakerIdentity">
                  Open prefilled launcher
                </Link>
              </Button>
              <Button asChild size="sm" variant="outline">
                <Link to="/settings/voice-identity/operations">
                  Generations & operations
                </Link>
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm md:grid-cols-3 xl:grid-cols-6">
            <div className="rounded-md border p-3">
              <strong>
                {classificationSnapshot?.classification.identified ?? "—"}
              </strong>
              <br />identified
            </div>
            <div className="rounded-md border p-3">
              <strong>
                {classificationSnapshot?.classification.unknown ?? "—"}
              </strong>
              <br />unknown
            </div>
            <div className="rounded-md border p-3">
              <strong>
                {classificationSnapshot?.classification.uncertain ?? "—"}
              </strong>
              <br />uncertain
            </div>
            <div className="rounded-md border border-amber-500/30 p-3">
              <strong>
                {classificationSnapshot?.classification.stale ?? "—"}
              </strong>
              <br />stale decisions
            </div>
            <div className="rounded-md border p-3">
              <strong>
                {classificationSnapshot?.classification.unclassified ?? "—"}
              </strong>
              <br />unclassified
            </div>
            <div className="rounded-md border p-3">
              <strong>{identityStatus?.latestJob?.state ?? "not run"}</strong>
              <br />latest job
            </div>
          </div>
          {provisionalClassificationTotal > 0 && provisionalClassification && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
              <p className="font-medium">Provisional 24-hour pilot results</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {provisionalClassification.identified} identified ·{" "}
                {provisionalClassification.unknown} unknown ·{" "}
                {provisionalClassification.uncertain}{" "}
                uncertain. Audit the automatic “Me” matches before trying to
                reach the 98% full calibration target.
              </p>
            </div>
          )}
          {classificationSnapshot && (
            <div className="text-xs text-muted-foreground">
              Exact snapshot: {new Date(classificationSnapshot.asOf)
                .toLocaleString()} · current calibration:{" "}
              {classificationSnapshot
                .calibrationId ?? "none"} · policy:{" "}
              {classificationSnapshot.classificationPolicy ?? "none"}
            </div>
          )}
          {classificationError && (
            <p className="text-xs text-red-600">
              {classificationError instanceof Error
                ? classificationError.message
                : "Exact classification scan failed"}
            </p>
          )}
          {identityStatus?.latestCampaign && identityCampaignView && (
            <div className="space-y-2 rounded-lg border bg-muted/20 p-4 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium">
                    Latest backfill · {identityStatus.latestCampaign.status}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Batch {identityStatus.latestCampaign.batchNumber ?? 0}/
                    {identityStatus.latestCampaign.estimatedBatches ?? "?"}
                  </p>
                </div>
                <div className="flex gap-2">
                  {identityStatus.latestCampaign.currentJobId && (
                    <Button asChild size="sm" variant="outline">
                      <Link
                        to={`/jobs/${identityStatus.latestCampaign.currentJobId}`}
                      >
                        Job details
                      </Link>
                    </Button>
                  )}
                  {identityStatus.latestCampaign.range?.start && (
                    <Button asChild size="sm" variant="outline">
                      <Link
                        to={`/timeline?start=${
                          new Date(
                            identityStatus.latestCampaign.range.start,
                          ).getTime()
                        }&end=${
                          identityStatus.latestCampaign.range.end
                            ? new Date(
                              identityStatus.latestCampaign.range.end,
                            ).getTime()
                            : Date.now()
                        }`}
                      >
                        See speakers on Timeline
                      </Link>
                    </Button>
                  )}
                </div>
              </div>
              {identityStatus.latestCampaign.totalSegments != null && (
                <Progress
                  value={identityCampaignView.percent}
                  className="h-2"
                />
              )}
              <div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
                <span>{identityCampaignView.progressLabel}</span>
                <span>{identityCampaignView.etaLabel}</span>
              </div>
              <div className="flex flex-wrap gap-3 text-xs">
                <span className="text-green-600">
                  {identityStatus.latestCampaign.matched ?? 0} Sky
                </span>
                <span>
                  {identityStatus.latestCampaign.rejected ?? 0} not Sky
                </span>
                <span className="text-amber-600">
                  {identityStatus.latestCampaign.uncertain ?? 0} uncertain
                </span>
                <span className="text-muted-foreground">
                  {identityStatus.latestCampaign.incompatibleSkipped ?? 0}{" "}
                  incompatible
                </span>
                <span className="text-muted-foreground">
                  {identityCampaignView.remainingLabel}
                  {identityCampaignView.rateLabel
                    ? `${
                      identityCampaignView.remainingLabel ? " · " : ""
                    }${identityCampaignView.rateLabel}`
                    : ""}
                </span>
              </div>
            </div>
          )}
          <details className="rounded-lg border bg-muted/20 p-4 text-sm">
            <summary className="cursor-pointer font-medium">
              Workflow after calibration
            </summary>
            <ol className="mt-3 grid gap-2 text-muted-foreground md:grid-cols-5">
              <li>
                <strong className="text-foreground">1.</strong> Split recordings
              </li>
              <li>
                <strong className="text-foreground">2.</strong>{" "}
                Validate the selected precision target
              </li>
              <li>
                <strong className="text-foreground">3.</strong>{" "}
                Classify a one-day pilot
              </li>
              <li>
                <strong className="text-foreground">4.</strong>{" "}
                Review uncertain results
              </li>
              <li>
                <strong className="text-foreground">5.</strong>{" "}
                Expand to 7 days, then history
              </li>
            </ol>
            <p className="mt-3 text-xs text-muted-foreground">
              100 total with at least 40 target and 40 not-target labels is only
              the minimum volume gate. Quality is accepted only when a separate
              validation set reaches the selected positive-precision target. 98%
              unlocks production and historical backfill; 95% or 90% saves only
              a risk-acknowledged 24-hour pilot. More clean, diverse recordings
              help; repeating nearly identical clips does not. Review remains
              incremental after classification, especially for uncertain results
              and new profiles.
            </p>
          </details>
        </CardContent>
      </Card>
    </div>
  );
}
