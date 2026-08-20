import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { callResource } from "@/lib/api";
import { normalizeObjectId } from "@/lib/diarization";
import { getSpeakerIdentityProgressView } from "@/lib/speakerIdentityProgress";
import {
  loadVoiceIdentityStatus,
  loadVoiceProfiles,
  voiceIdentityKeys,
} from "@/lib/voiceIdentity";
import { useAudioPlaybackStore } from "@/stores/audioPlaybackStore";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  Plus,
  RefreshCw,
} from "lucide-react";
import {
  VoiceIdentityReviewPlayer,
  type VoiceIdentityReviewSegment,
} from "./VoiceIdentityReviewPlayer";

const AUTO_PLAY_STORAGE_KEY = "voice-identity-review-autoplay-next";

type ReviewHistoryEntry = {
  decisionId: string;
};

type ReviewWindowItem = {
  segmentId: unknown;
  groupId?: string;
  status: "pending" | "skipped" | "reviewed";
  decisionId?: unknown;
  decisionSummary?: {
    decisionId: string;
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
  sessionLoadedCount?: number;
  reviewedCount: number;
  skippedCount: number;
  windowReviewedCount?: number;
  windowSkippedCount?: number;
  windowNumber?: number;
  hasMore?: boolean;
  backlogEstimate: number;
  backlogEstimateCapped?: boolean;
  preferences?: {
    autoPlay?: boolean;
    groupMode?: boolean;
    compactMode?: boolean;
  };
  lastOpenedAt?: Date | string;
  querySnapshot: {
    rangeMode: "fixed" | "all_before";
    start: Date | string;
    end: Date | string;
  };
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
  thresholds: { positiveThreshold: number; negativeThreshold: number } | null;
  calibrationMetrics: CalibrationMetrics | null;
  validationMetrics: CalibrationMetrics | null;
  blockers: string[];
  canValidate: boolean;
};

type CalibrationMetrics = {
  total: number;
  positives: number;
  negatives: number;
  identified: number;
  rejected: number;
  uncertain: number;
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
    { calibrationId: string; status: string; updatedAt?: Date }
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
    unclassified: number;
  };
};

export default function VoiceIdentityReviewPage() {
  const queryClient = useQueryClient();
  const [calibrationRecordings, setCalibrationRecordings] = useState("");
  const [validationRecordings, setValidationRecordings] = useState("");
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
  const calibrationSectionRef = useRef<HTMLDivElement>(null);

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
  const alternateProfiles = profiles
    .filter((profile) => normalizeObjectId(profile._id) !== reviewProfileId)
    .map((profile) => ({
      id: normalizeObjectId(profile._id) ?? "",
      name: String(profile.name ?? "Unnamed profile"),
    }))
    .filter((profile) => profile.id)
    .sort((a, b) => a.name.localeCompare(b.name));
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
      }) as Promise<IdentityClassificationSnapshot>,
    enabled: false,
    retry: false,
  });
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

  const createSession = useMutation({
    mutationFn: async () => {
      if (!reviewProfileId) throw new Error("Choose a voice profile first");
      const now = new Date();
      const data: Record<string, unknown> = {
        action: "create-review-session",
        targetProfileIds: [reviewProfileId],
        embeddingSpaceIds: reviewProfile?.embeddingSpaceId
          ? [reviewProfile.embeddingSpaceId]
          : [],
        rangeMode: newRange === "all" ? "all_before" : "fixed",
        limit: 100,
        preferences: {
          autoPlay: autoPlayNext,
          groupMode: true,
          compactMode: true,
        },
      };
      if (newRange !== "all") {
        const end = newRange === "custom" && customEnd
          ? new Date(customEnd)
          : now;
        const start = newRange === "custom" && customStart
          ? new Date(customStart)
          : new Date(
            end.getTime() - (newRange === "30d" ? 30 : 14) * 86_400_000,
          );
        if (
          !Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())
        ) {
          throw new Error("Enter a valid custom date range");
        }
        data.start = start;
        data.end = end;
      }
      return await callResource("speaker-segments", data) as ReviewSession;
    },
    onSuccess: (session) => {
      const id = normalizeObjectId(session._id);
      setSelectedSessionId(id);
      queryClient.setQueryData(["speaker-review-session", id], session);
      void queryClient.invalidateQueries({ queryKey: sessionsQueryKey });
      setShowNewSession(false);
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
      queryClient.setQueryData(sessionQueryKey, session);
      setHistory([]);
      setPlayOnMount(autoPlayNext && Boolean(session.activeSegmentId));
      void queryClient.invalidateQueries({ queryKey: sessionsQueryKey });
      toast.success(
        session.loadedCount > 0
          ? `Loaded window ${session.windowNumber} with ${session.loadedCount} segments`
          : "No more segments in this frozen backlog",
      );
    },
    onError: (error) =>
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not load the next review window",
      ),
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
        calibrationId: `sky-r${primary.revision ?? 1}-${Date.now()}`,
        profileId,
        profileRevision: primary.revision ?? 1,
        embeddingSpaceId: primary.embeddingSpaceId,
        positiveThreshold: calibrationPreview.thresholds.positiveThreshold,
        negativeThreshold: calibrationPreview.thresholds.negativeThreshold,
        metrics: {
          precision: calibrationPreview.validationMetrics.positivePrecision,
          recall: calibrationPreview.validationMetrics.positiveRecall,
          sky: calibrationPreview.counts.positive,
          notSky: calibrationPreview.counts.negative,
          borderline: calibrationPreview.validationMetrics.uncertain,
        },
        calibrationRecordingIds: effectiveCalibrationIds,
        validationRecordingIds: effectiveValidationIds,
        status: "validated",
        allowLegacyCompatibility: primary.embeddingSpaceId === "legacy-unknown",
      });
    },
    onSuccess: () => {
      void refetchIdentityStatus();
      toast.success(
        "Validated calibration saved; historical classification is unblocked",
      );
    },
    onError: (error) =>
      toast.error(
        error instanceof Error ? error.message : "Calibration rejected",
      ),
  });
  const latestCalibration = identityStatus?.usableCalibration;
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
    ],
    enabled: Boolean(profileId && primary?.embeddingSpaceId),
    queryFn: () =>
      callResource("speaker-segments", {
        action: "calibration-preview",
        profileId,
        calibrationRecordingIds: calibrationIds,
        validationRecordingIds: validationIds,
        targetPrecision: 0.98,
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
  const canValidate = Boolean(calibrationPreview?.canValidate);
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
    : !labelGateReady
    ? "Need labels"
    : calibrationPreview?.blockers.length
    ? "Split blocked"
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
  const reviewPending = label.isPending || undo.isPending ||
    updatePosition.isPending ||
    completeSession.isPending || loadNextWindow.isPending;
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
      !id || item.status !== "reviewed" || !item.decisionSummary ||
      reviewPending
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
  const skipActive = () => {
    if (!activeId || reviewPending) return;
    const nextPending = [
      ...windowItems.slice(activeIndex + 1),
      ...windowItems.slice(0, activeIndex),
    ]
      .find((item) => item.status === "pending");
    updatePosition.mutate({
      skipSegmentId: activeId,
      activeSegmentId: normalizeObjectId(nextPending?.segmentId) ?? null,
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
      toast.success("Sky re-enrollment queued from all saved samples"),
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
            Review the uncertain band first, then lock thresholds on separate
            validation recordings.
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
          </CardContent>
        </Card>
        <Card
          className={latestCalibration
            ? "border-green-500/30"
            : readinessState === "Split blocked"
            ? "border-amber-500/30"
            : "border-muted"}
        >
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              3. Validate and classify
            </CardTitle>
            <CardDescription>
              Lock thresholds on separate recordings, then classify stored
              embeddings.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="font-medium">{readinessState}</p>
            {latestCalibration && (
              <p className="text-xs text-green-700 dark:text-green-400">
                Pilot ready · {latestCalibration.calibrationId}
              </p>
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
                {calibrationPreview?.blockers.map((blocker) => (
                  <p key={blocker} className="text-xs text-amber-600">
                    {blocker}
                  </p>
                ))}
                {canValidate && (
                  <p className="text-xs text-muted-foreground">
                    Fit/Check split is ready for validation.
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
                  Review validation details
                </Button>
              </div>
            )}
            {latestCalibration && (
              <Link
                className="font-medium text-primary hover:underline"
                to="/audio/pipeline"
              >
                Open Classify existing →
              </Link>
            )}
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle>2. Review voice segments</CardTitle>
              <CardDescription>
                Saved sessions resume on any device. Short neighboring segments
                from the same diarized speaker are grouped safely.
              </CardDescription>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowNewSession((value) => !value)}
            >
              <Plus className="mr-1 h-4 w-4" />New session
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="sticky top-2 z-10 grid gap-2 rounded-lg border bg-background/95 p-3 shadow-sm backdrop-blur md:grid-cols-[10rem_minmax(12rem,1fr)_auto_auto_auto]">
            <label className="text-xs text-muted-foreground">
              Target profile
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
                      {session.name}
                    </option>
                  );
                })}
              </select>
            </label>
            <div className="flex min-w-48 items-end gap-2 text-xs">
              <div className="flex-1">
                <div className="flex justify-between text-muted-foreground">
                  <span>Window</span>
                  <span>
                    {reviewSession?.windowReviewedCount ??
                      reviewSession?.reviewedCount ?? 0} reviewed ·{" "}
                    {reviewSession?.windowSkippedCount ??
                      reviewSession?.skippedCount ?? 0} skipped
                  </span>
                </div>
                <Progress
                  className="mt-2 h-2"
                  value={reviewSession?.loadedCount
                    ? (((reviewSession.windowReviewedCount ??
                      reviewSession.reviewedCount) +
                      (reviewSession.windowSkippedCount ??
                        reviewSession.skippedCount)) /
                      reviewSession.loadedCount) * 100
                    : 0}
                />
              </div>
            </div>
            <Button
              size="sm"
              variant={groupMode ? "secondary" : "outline"}
              className="self-end"
              disabled={!reviewSession || reviewPending}
              onClick={() =>
                updatePosition.mutate({
                  preferences: { groupMode: !groupMode },
                })}
            >
              Group short: {groupMode ? "on" : "off"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="self-end"
              disabled={!reviewSession || reviewSession.status !== "active" ||
                reviewPending}
              onClick={() => completeSession.mutate()}
            >
              <CheckCircle2 className="mr-1 h-4 w-4" />Complete
            </Button>
          </div>

          {(showNewSession || (!sessionsLoading && sessions.length === 0)) && (
            <div className="grid gap-2 rounded-lg border border-dashed p-3 md:grid-cols-[12rem_1fr_auto]">
              <label className="text-xs text-muted-foreground">
                Range
                <select
                  className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm text-foreground"
                  value={newRange}
                  onChange={(event) =>
                    setNewRange(event.target.value as typeof newRange)}
                >
                  <option value="14d">Last 14 days</option>
                  <option value="30d">Last 30 days</option>
                  <option value="custom">Custom range</option>
                  <option value="all">Full backlog snapshot</option>
                </select>
              </label>
              {newRange === "custom"
                ? (
                  <div className="grid grid-cols-2 gap-2">
                    <label className="text-xs text-muted-foreground">
                      Start<Input
                        type="datetime-local"
                        value={customStart}
                        onChange={(event) => setCustomStart(event.target.value)}
                      />
                    </label>
                    <label className="text-xs text-muted-foreground">
                      End<Input
                        type="datetime-local"
                        value={customEnd}
                        onChange={(event) => setCustomEnd(event.target.value)}
                      />
                    </label>
                  </div>
                )
                : (
                  <p className="self-center text-xs text-muted-foreground">
                    The session freezes its end time, order and first 100 items.
                    New diarization cannot move your saved position.
                  </p>
                )}
              <Button
                className="self-end"
                onClick={() => createSession.mutate()}
                disabled={!reviewProfileId || createSession.isPending}
              >
                {createSession.isPending ? "Creating…" : "Start review"}
              </Button>
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
          {reviewSession && reviewSession.loadedCount > 0 && (
            <>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span>{reviewSession.loadedCount} items in this window</span>
                <span>{reviewSession.groups.length} playback groups</span>
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
              </div>
              <div className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                Label only a clear target voice. Use{" "}
                <strong className="text-foreground">Skip</strong>{" "}
                for noise, humming you cannot identify, clipped speech, or two
                overlapping voices. Skipped audio is saved in the session but
                excluded from calibration.
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
                      <Button
                        size="sm"
                        onClick={() => loadNextWindow.mutate()}
                        disabled={reviewPending}
                      >
                        {loadNextWindow.isPending
                          ? "Loading…"
                          : "Load next 100"}
                      </Button>
                    )
                    : (
                      <span className="text-xs text-muted-foreground">
                        No more known items · Complete the session
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
                  position={reviewIndex + 1}
                  remaining={windowItems.filter((item) =>
                    item.status === "pending"
                  ).length}
                  sessionAnswered={reviewSession.reviewedCount +
                    reviewSession.skippedCount}
                  sessionTotal={reviewSession.sessionLoadedCount ??
                    reviewSession.loadedCount}
                  pending={reviewPending || decisionSegmentIds.length === 0 ||
                    reviewSession.status !== "active"}
                  autoPlayNext={autoPlayNext}
                  playOnMount={playOnMount}
                  canPrevious={!editingSegmentId && activeIndex > 0}
                  canNext={!editingSegmentId &&
                    activeIndex < windowItems.length - 1}
                  canUndo={history.length > 0}
                  canEdit={reviewItem?.status === "reviewed" &&
                    Boolean(reviewItem.decisionSummary) && !editingSegmentId}
                  editingLabel={editingSegmentId
                    ? reviewItem?.decisionSummary?.profileName ?? "Not Sky"
                    : null}
                  alternateProfiles={alternateProfiles}
                  onDecision={(state) => {
                    if (reviewPending) return;
                    if (state === "skip") {
                      if (editingSegmentId) cancelEdit();
                      else skipActive();
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
                    saveAssignment({
                      profileId: assignedProfileId,
                      excludedProfileIds: [reviewProfileId],
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
              <div
                className="max-h-[28rem] overflow-y-auto rounded-lg border"
                aria-label="Review session items"
              >
                {windowItems.map((item, index) => {
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
                    ? "Not Sky"
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
                    ? "Not Sky · Model"
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
                          disabled={item.status !== "reviewed" ||
                            !item.decisionSummary || reviewPending}
                          onClick={() => beginEdit(item)}
                        >
                          Edit
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </CardContent>
      </Card>
      <Card ref={calibrationSectionRef}>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <CardTitle>3. Validate Sky calibration</CardTitle>
              <CardDescription>
                Backend computes thresholds from one set of recordings, then
                measures them on different audio. Nothing here is a manually
                entered confidence percentage.
              </CardDescription>
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={calibrationPreviewFetching}
              onClick={() => void refetchCalibrationPreview()}
            >
              <RefreshCw
                className={`mr-1 h-4 w-4 ${
                  calibrationPreviewFetching ? "animate-spin" : ""
                }`}
              />
              Recalculate
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 text-sm md:grid-cols-3">
            <div className="rounded-md border p-3">
              <strong>1. Labels</strong>
              <p className="text-xs text-muted-foreground">
                Only clear reviewed speech with a compatible embedding is used.
              </p>
            </div>
            <div className="rounded-md border p-3">
              <strong>2. Fit thresholds</strong>
              <p className="text-xs text-muted-foreground">
                Calibration recordings choose the safest Me / uncertain / Not me
                borders.
              </p>
            </div>
            <div className="rounded-md border p-3">
              <strong>3. Check unseen audio</strong>
              <p className="text-xs text-muted-foreground">
                Validation recordings must independently reach ≥98% auto-match
                precision.
              </p>
            </div>
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
              <div className="grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
                <div className="rounded-md border p-3">
                  <strong>{calibrationPreview.counts.positive}</strong>
                  <br />compatible Sky labels
                </div>
                <div className="rounded-md border p-3">
                  <strong>{calibrationPreview.counts.negative}</strong>
                  <br />compatible not-Sky labels
                </div>
                <div className="rounded-md border p-3">
                  <strong>{calibrationPreview.counts.recordings}</strong>
                  <br />source recordings
                </div>
                <div className="rounded-md border p-3">
                  <strong>{calibrationPreview.counts.incompatible}</strong>
                  <br />excluded: old/missing embedding
                </div>
              </div>

              <div className="grid gap-2 md:grid-cols-4">
                <div className="rounded-md border bg-muted/20 p-3 text-sm">
                  <span className="text-xs text-muted-foreground">
                    Auto “Sky” at
                  </span>
                  <p className="text-xl font-semibold tabular-nums">
                    {calibrationPreview.thresholds?.positiveThreshold.toFixed(
                      3,
                    ) ?? "—"}
                  </p>
                </div>
                <div className="rounded-md border bg-muted/20 p-3 text-sm">
                  <span className="text-xs text-muted-foreground">
                    Auto “not Sky” at
                  </span>
                  <p className="text-xl font-semibold tabular-nums">
                    {calibrationPreview.thresholds?.negativeThreshold.toFixed(
                      3,
                    ) ?? "—"}
                  </p>
                </div>
                <div className="rounded-md border bg-muted/20 p-3 text-sm">
                  <span className="text-xs text-muted-foreground">
                    Validation precision
                  </span>
                  <p
                    className={`text-xl font-semibold tabular-nums ${
                      (calibrationPreview.validationMetrics
                          ?.positivePrecision ?? 0) >= 0.98
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
                    Validation coverage
                  </span>
                  <p className="text-xl font-semibold tabular-nums">
                    {calibrationPreview.validationMetrics
                      ? `${calibrationPreview.validationMetrics.identified}/${calibrationPreview.validationMetrics.total}`
                      : "—"}
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium">Recording split</p>
                    <p className="text-xs text-muted-foreground">
                      Dates and label mix identify each source; the raw ID is
                      only a secondary reference.
                      {calibrationPreview.automaticSplit
                        ? " The split below was balanced automatically."
                        : " You changed the automatic split."}
                    </p>
                  </div>
                  {!calibrationPreview.automaticSplit && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setCalibrationRecordings("");
                        setValidationRecordings("");
                      }}
                    >
                      Reset automatic split
                    </Button>
                  )}
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
                    return (
                      <div
                        key={recording.id}
                        className="grid gap-2 rounded-md border p-3 text-sm md:grid-cols-[minmax(14rem,1fr)_auto_auto] md:items-center"
                      >
                        <div className="min-w-0">
                          <Link
                            className="font-medium text-primary hover:underline"
                            to={`/timeline?originalId=${recording.id}`}
                          >
                            {new Date(recording.start).toLocaleString()} —{" "}
                            {new Date(recording.end).toLocaleTimeString()}
                          </Link>
                          <p className="truncate text-xs text-muted-foreground">
                            {recording.id}
                          </p>
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {recording.positive} Sky · {recording.negative}{" "}
                          not-Sky · {recording.total} total
                        </span>
                        <div className="flex gap-1">
                          {(["calibration", "validation", "unused"] as const)
                            .map((target) => (
                              <Button
                                key={target}
                                type="button"
                                size="sm"
                                variant={selected === target
                                  ? "default"
                                  : "outline"}
                                onClick={() =>
                                  chooseRecordingSet(recording.id, target)}
                              >
                                {target === "calibration"
                                  ? "Fit"
                                  : target === "validation"
                                  ? "Check"
                                  : "Unused"}
                              </Button>
                            ))}
                        </div>
                      </div>
                    );
                  })}
              </div>

              {calibrationPreview.blockers.length > 0 && (
                <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
                  <div className="flex items-center gap-2 font-medium">
                    <AlertCircle className="h-4 w-4 text-amber-600" />What is
                    still needed
                  </div>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
                    {calibrationPreview.blockers.map((blocker) => (
                      <li key={blocker}>{blocker}</li>
                    ))}
                  </ul>
                </div>
              )}

              <Button
                className="w-full"
                onClick={() => saveCalibration.mutate()}
                disabled={saveCalibration.isPending || !canValidate}
              >
                {saveCalibration.isPending
                  ? "Saving server-verified calibration…"
                  : canValidate
                  ? "Save validated calibration and unlock classification"
                  : "Calibration is not ready yet"}
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                The backend recalculates the split metrics during save; the
                browser cannot submit a made-up precision value.
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
              Exact global distribution scans active diarizations only when you
              request it. Campaign progress remains lightweight and live.
            </CardDescription>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void calculateClassification()}
            disabled={isCalculatingClassification}
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
          <div className="grid grid-cols-2 gap-2 text-sm md:grid-cols-5">
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
          {classificationSnapshot && (
            <p className="text-xs text-muted-foreground">
              Exact snapshot:{" "}
              {new Date(classificationSnapshot.asOf).toLocaleString()}
            </p>
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
          <div className="rounded-lg border bg-muted/20 p-4 text-sm">
            <p className="font-medium">
              What happens after the first 100 labels
            </p>
            <ol className="mt-2 grid gap-2 text-muted-foreground md:grid-cols-5">
              <li>
                <strong className="text-foreground">1.</strong> Split recordings
              </li>
              <li>
                <strong className="text-foreground">2.</strong>{" "}
                Validate ≥98% precision
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
              100 labels is the minimum calibration gate, not a stopping point.
              Continue reviewing diverse recordings and the uncertain queue.
            </p>
          </div>
          <Button asChild disabled={!latestCalibration}>
            <Link to="/audio/pipeline">
              Open Pipeline and run Classify existing
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
