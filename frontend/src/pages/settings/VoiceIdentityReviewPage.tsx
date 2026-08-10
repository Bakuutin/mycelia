import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { callResource } from "@/lib/api";
import { normalizeObjectId } from "@/lib/diarization";
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
import { AlertCircle, Loader2, RefreshCw } from "lucide-react";
import {
  type VoiceIdentityDecision,
  VoiceIdentityReviewPlayer,
  type VoiceIdentityReviewSegment,
} from "./VoiceIdentityReviewPlayer";

const AUTO_PLAY_STORAGE_KEY = "voice-identity-review-autoplay-next";

type ReviewHistoryEntry = {
  annotationId: string;
  segment: VoiceIdentityReviewSegment;
  decision: VoiceIdentityDecision;
};

type IdentityStatus = {
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
  classification: {
    identified: number;
    unknown: number;
    uncertain: number;
    unclassified: number;
  };
  latestJob?: {
    _id: unknown;
    state: string;
    progress?: Record<string, number>;
    result?: Record<string, number>;
    failedReason?: string;
  } | null;
};

export default function VoiceIdentityReviewPage() {
  const queryClient = useQueryClient();
  const [positive, setPositive] = useState(0.7);
  const [negative, setNegative] = useState(0.35);
  const [precision, setPrecision] = useState(0.98);
  const [calibrationRecordings, setCalibrationRecordings] = useState("");
  const [validationRecordings, setValidationRecordings] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [history, setHistory] = useState<ReviewHistoryEntry[]>([]);
  const [sessionTotal, setSessionTotal] = useState<number | null>(null);
  const [playOnMount, setPlayOnMount] = useState(false);
  const [autoPlayNext, setAutoPlayNext] = useState(() => {
    try {
      const stored = localStorage.getItem(AUTO_PLAY_STORAGE_KEY);
      return stored === null ? true : stored === "true";
    } catch {
      return true;
    }
  });
  const calibrationSectionRef = useRef<HTMLDivElement>(null);
  const [range] = useState(() => ({
    start: new Date(Date.now() - 14 * 86_400_000),
    end: new Date(),
  }));

  const { data: profiles = [] } = useQuery<any[]>({
    queryKey: ["speaker_profiles"],
    queryFn: () =>
      callResource("mongo", {
        action: "find",
        collection: "speaker_profiles",
        query: {},
        options: { sort: { is_primary: -1 } },
      }) as Promise<any[]>,
  });
  const primary = profiles.find((profile) => profile.is_primary);
  const profileId = normalizeObjectId(primary?._id);
  const { data: identityStatus, refetch: refetchIdentityStatus } = useQuery<
    IdentityStatus
  >({
    queryKey: ["speaker-identity-status", profileId],
    enabled: Boolean(profileId),
    queryFn: () =>
      callResource("speaker-segments", {
        action: "identity-status",
        profileId,
      }) as Promise<IdentityStatus>,
    refetchInterval: 15_000,
  });
  const { data: pipelineHealth, isLoading: isLoadingHealth } = useQuery<any>({
    queryKey: ["pipeline-health", "voice-identity"],
    queryFn: () =>
      callResource("jobs", {
        action: "pipeline_health",
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
  const reviewQueryKey = [
    "speaker-review",
    range.start.getTime(),
    range.end.getTime(),
  ] as const;
  const {
    data: queue = [],
    isLoading,
    isFetching,
    isError,
    error,
    refetch,
  } = useQuery<any[]>({
    queryKey: reviewQueryKey,
    queryFn: () =>
      callResource("speaker-segments", {
        action: "review-queue",
        ...range,
        state: "reviewable",
        limit: 100,
      }) as Promise<any[]>,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!isLoading && sessionTotal === null) setSessionTotal(queue.length);
  }, [isLoading, queue.length, sessionTotal]);

  useEffect(() => {
    if (queue.length === 0) {
      setActiveIndex(0);
      return;
    }
    setActiveIndex((current) => Math.min(current, queue.length - 1));
  }, [queue.length]);

  const label = useMutation({
    mutationFn: async (
      { segment, state }: { segment: any; state: "me" | "not-me" },
    ) => {
      if (!profileId) throw new Error("Primary profile is missing");
      const segmentId = normalizeObjectId(segment._id);
      const originalId = normalizeObjectId(
        segment.original_id ?? segment.original,
      );
      if (!segmentId || !originalId) {
        throw new Error("Segment identity is incomplete");
      }
      const annotation = await callResource("speaker-segments", {
        action: "annotate",
        originalId,
        segmentId,
        runId: segment.runId,
        start: segment.start,
        end: segment.end,
        ...(state === "me"
          ? { profileId, excludedProfileIds: [] }
          : { excludedProfileIds: [profileId] }),
      });
      const annotationId = normalizeObjectId((annotation as any)?._id);
      if (!annotationId) throw new Error("Saved annotation has no ID");
      return { annotationId, segment, state };
    },
    onSuccess: ({ annotationId, segment, state }) => {
      const segmentId = normalizeObjectId(segment._id);
      const nextQueue = queue.filter((item) =>
        normalizeObjectId(item._id) !== segmentId
      );
      queryClient.setQueryData(reviewQueryKey, nextQueue);
      setHistory((current) => [...current, {
        annotationId,
        segment,
        decision: state,
      }]);
      setActiveIndex((current) =>
        Math.min(current, Math.max(0, nextQueue.length - 1))
      );
      setPlayOnMount(autoPlayNext && nextQueue.length > 0);
      void refetchIdentityStatus();
    },
    onError: (error) =>
      toast.error(
        error instanceof Error ? error.message : "Could not label segment",
      ),
  });

  const undo = useMutation({
    mutationFn: async (entry: ReviewHistoryEntry) => {
      await callResource("speaker-segments", {
        action: "delete-annotation",
        id: entry.annotationId,
      });
      return entry;
    },
    onSuccess: (entry) => {
      queryClient.setQueryData<any[]>(reviewQueryKey, (current = []) => {
        const restoredId = normalizeObjectId(entry.segment._id);
        return [
          entry.segment,
          ...current.filter((item) =>
            normalizeObjectId(item._id) !== restoredId
          ),
        ];
      });
      setHistory((current) => current.slice(0, -1));
      setActiveIndex(0);
      setPlayOnMount(false);
      void refetchIdentityStatus();
    },
    onError: (error) =>
      toast.error(
        error instanceof Error ? error.message : "Could not undo annotation",
      ),
  });

  const saveCalibration = useMutation({
    mutationFn: async () => {
      if (!profileId || !primary?.embeddingSpaceId) {
        throw new Error(
          "Primary profile has no embedding provenance; re-enroll it first",
        );
      }
      const split = (value: string) =>
        value.split(",").map((item) => item.trim()).filter(Boolean);
      return await callResource("speaker-segments", {
        action: "save-calibration",
        calibrationId: `sky-r${primary.revision ?? 1}-${Date.now()}`,
        profileId,
        profileRevision: primary.revision ?? 1,
        embeddingSpaceId: primary.embeddingSpaceId,
        positiveThreshold: positive,
        negativeThreshold: negative,
        metrics: {
          precision,
          sky: identityStatus?.labels.sky ?? 0,
          notSky: identityStatus?.labels.notSky ?? 0,
          borderline: queue.length,
        },
        calibrationRecordingIds: split(calibrationRecordings),
        validationRecordingIds: split(validationRecordings),
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
  const latestCalibration = identityStatus?.calibrations.find((item) =>
    item.status === "validated"
  );
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
  const canValidate = Boolean(primary?.embeddingSpaceId) &&
    labels.sky >= 40 && labels.notSky >= 40 && labels.total >= 100 &&
    calibrationIds.length > 0 && validationIds.length > 0 &&
    !validationIds.some((id) => calibrationIds.includes(id)) &&
    precision >= 0.98 && negative < positive;
  const labelGateReady = labels.sky >= 40 && labels.notSky >= 40 &&
    labels.total >= 100;
  const missingLabelRequirements = [
    labels.sky < 40 ? `${40 - labels.sky} more Sky` : null,
    labels.notSky < 40 ? `${40 - labels.notSky} more not-Sky` : null,
    labels.total < 100 ? `${100 - labels.total} more total` : null,
  ].filter(Boolean) as string[];
  const activeSegment = queue[activeIndex] as
    | VoiceIdentityReviewSegment
    | undefined;
  const reviewPending = label.isPending || undo.isPending;
  const effectiveSessionTotal = sessionTotal ?? queue.length;
  const setAutoPlayPreference = (enabled: boolean) => {
    setAutoPlayNext(enabled);
    try {
      localStorage.setItem(AUTO_PLAY_STORAGE_KEY, String(enabled));
    } catch {
      // The preference is still valid for the current page session.
    }
  };
  const moveReview = (direction: -1 | 1) => {
    setPlayOnMount(false);
    setActiveIndex((current) =>
      Math.max(0, Math.min(queue.length - 1, current + direction))
    );
  };
  const undoLast = () => {
    const entry = history.at(-1);
    if (entry && !reviewPending) undo.mutate(entry);
  };
  const chooseRecordingSet = (
    id: string,
    target: "calibration" | "validation" | "unused",
  ) => {
    const nextCalibration = calibrationIds.filter((value) => value !== id);
    const nextValidation = validationIds.filter((value) => value !== id);
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
              Use “This is me” and “Not me” below. Counts update automatically.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div>
              <div className="flex justify-between">
                <span>Sky</span>
                <strong>{labels.sky} / 40</strong>
              </div>
              <Progress
                className="mt-1"
                value={Math.min(100, labels.sky / 40 * 100)}
              />
            </div>
            <div>
              <div className="flex justify-between">
                <span>not-Sky</span>
                <strong>{labels.notSky} / 40</strong>
              </div>
              <Progress
                className="mt-1"
                value={Math.min(100, labels.notSky / 40 * 100)}
              />
            </div>
            <div>
              <div className="flex justify-between">
                <span>Total</span>
                <strong>{labels.total} / 100</strong>
              </div>
              <Progress className="mt-1" value={Math.min(100, labels.total)} />
            </div>
            <p className="text-xs text-muted-foreground">
              Across {labels.recordings} recordings
            </p>
          </CardContent>
        </Card>
        <Card
          className={latestCalibration ? "border-green-500/30" : "border-muted"}
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
            <p>
              {latestCalibration
                ? `Validated · ${latestCalibration.calibrationId}`
                : "Not validated yet"}
            </p>
            {!labelGateReady && (
              <p className="text-xs text-muted-foreground">
                Still needed: {missingLabelRequirements.join(" · ")}
              </p>
            )}
            {labelGateReady && !latestCalibration && (
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  calibrationSectionRef.current?.scrollIntoView({
                    behavior: "smooth",
                  })}
              >
                Configure validation split
              </Button>
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
        <CardHeader>
          <CardTitle>2. Segments to label — last 14 days</CardTitle>
          <CardDescription>
            Up to 100 uncertain or not-yet-classified segments from the active
            diarization run. Start here before the first calibration.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {isLoading && (
            <div className="flex items-center gap-2 rounded-md border p-3 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading review queue… normally this takes under 5 seconds.
            </div>
          )}
          {isError && (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/40 p-3 text-sm text-destructive">
              <AlertCircle className="h-4 w-4" />
              <span className="flex-1">
                Could not load the review queue:{" "}
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
          {!isLoading && !isError && queue.length === 0 &&
            history.length === 0 && (
            <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
              No reviewable segments in this range. Wait for diarization
              coverage or use a wider range on the Timeline.
            </div>
          )}
          {!isLoading && !isError && queue.length === 0 && history.length > 0 &&
            (
              <div className="space-y-3 rounded-md border border-green-500/30 bg-green-500/5 p-4 text-sm">
                <p className="font-medium">Loaded review queue completed</p>
                <p className="text-muted-foreground">
                  You answered {history.length}{" "}
                  segments in this session. Undo remains available for the
                  latest decision.
                </p>
                <Button
                  variant="outline"
                  onClick={undoLast}
                  disabled={reviewPending}
                >
                  Undo last decision
                </Button>
              </div>
            )}
          {!isLoading && !isError && queue.length > 0 && (
            <p className="text-sm text-muted-foreground">
              {queue.length} segments ready for review
              {isFetching ? " · refreshing…" : ""}
            </p>
          )}
          {activeSegment && (
            <VoiceIdentityReviewPlayer
              key={normalizeObjectId(activeSegment._id) ?? activeIndex}
              segment={activeSegment}
              position={activeIndex + 1}
              remaining={queue.length}
              sessionAnswered={history.length}
              sessionTotal={effectiveSessionTotal}
              pending={reviewPending}
              autoPlayNext={autoPlayNext}
              playOnMount={playOnMount}
              canPrevious={activeIndex > 0}
              canNext={activeIndex < queue.length - 1}
              canUndo={history.length > 0}
              onDecision={(state) => {
                if (!reviewPending) {
                  label.mutate({ segment: activeSegment, state });
                }
              }}
              onPrevious={() => moveReview(-1)}
              onNext={() => moveReview(1)}
              onUndo={undoLast}
              onAutoPlayChange={setAutoPlayPreference}
            />
          )}
        </CardContent>
      </Card>
      <Card ref={calibrationSectionRef}>
        <CardHeader>
          <CardTitle>3. Validate Sky calibration</CardTitle>
          <CardDescription>
            Label counts are taken from your manual review automatically. Choose
            two non-overlapping sets of source recording IDs: one for choosing
            thresholds and another for checking that Sky precision is at least
            98%.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          <label className="text-sm">
            Positive threshold<Input
              type="number"
              step="0.01"
              value={positive}
              onChange={(e) => setPositive(Number(e.target.value))}
            />
          </label>
          <label className="text-sm">
            Negative threshold<Input
              type="number"
              step="0.01"
              value={negative}
              onChange={(e) => setNegative(Number(e.target.value))}
            />
          </label>
          <label className="text-sm">
            Validation precision (0–1)<Input
              type="number"
              step="0.001"
              value={precision}
              onChange={(e) => setPrecision(Number(e.target.value))}
            />
          </label>
          <div className="rounded-md border bg-muted/30 p-3 text-sm md:col-span-2">
            <p className="font-medium">Labels from review</p>
            <p className="text-muted-foreground">
              {labels.sky} Sky · {labels.notSky} not-Sky · {queue.length}{" "}
              currently reviewable
            </p>
          </div>
          <div className="space-y-3 md:col-span-3">
            <div>
              <p className="text-sm font-medium">Split labeled recordings</p>
              <p className="text-xs text-muted-foreground">
                Put each source in exactly one set. Calibration chooses
                thresholds; validation checks them on audio the threshold
                selection never saw.
              </p>
            </div>
            {(labels.byRecording?.length ?? 0) === 0
              ? (
                <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                  No labeled recordings yet. Label segments above or open the
                  Timeline, then this selector will fill automatically.
                </div>
              )
              : labels.byRecording?.slice(0, 20).map((recording) => {
                const selected = calibrationIds.includes(recording.id)
                  ? "calibration"
                  : validationIds.includes(recording.id)
                  ? "validation"
                  : "unused";
                return (
                  <div
                    key={recording.id}
                    className="flex flex-wrap items-center gap-2 rounded-md border p-3 text-sm"
                  >
                    <Link
                      className="min-w-0 flex-1 truncate font-mono text-primary hover:underline"
                      to={`/timeline?originalId=${recording.id}`}
                    >
                      {recording.id}
                    </Link>
                    <span className="text-xs text-muted-foreground">
                      {recording.sky} Sky · {recording.notSky} not-Sky
                    </span>
                    {(["calibration", "validation", "unused"] as const).map((
                      target,
                    ) => (
                      <Button
                        key={target}
                        type="button"
                        size="sm"
                        variant={selected === target ? "default" : "outline"}
                        onClick={() => chooseRecordingSet(recording.id, target)}
                      >
                        {target === "calibration"
                          ? "Calibration"
                          : target === "validation"
                          ? "Validation"
                          : "Unused"}
                      </Button>
                    ))}
                  </div>
                );
              })}
          </div>
          <Button
            className="md:col-span-3"
            onClick={() => saveCalibration.mutate()}
            disabled={saveCalibration.isPending || !canValidate}
          >
            {saveCalibration.isPending
              ? "Saving…"
              : "Validate calibration and unlock classification"}
          </Button>
          {!canValidate && (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm md:col-span-3">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <span>
                Complete the missing prerequisites above. The button unlocks
                only after 100 real labels (40/40 minimum), separate recording
                sets, valid thresholds, and ≥98% validation precision.
              </span>
            </div>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Classify existing — current results</CardTitle>
          <CardDescription>
            Identity matching reuses stored diarization embeddings; it does not
            rerun VAD, STT, or diarization.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-2 text-sm md:grid-cols-5">
            <div className="rounded-md border p-3">
              <strong>{identityStatus?.classification.identified ?? 0}</strong>
              <br />identified
            </div>
            <div className="rounded-md border p-3">
              <strong>{identityStatus?.classification.unknown ?? 0}</strong>
              <br />unknown
            </div>
            <div className="rounded-md border p-3">
              <strong>{identityStatus?.classification.uncertain ?? 0}</strong>
              <br />uncertain
            </div>
            <div className="rounded-md border p-3">
              <strong>
                {identityStatus?.classification.unclassified ?? 0}
              </strong>
              <br />unclassified
            </div>
            <div className="rounded-md border p-3">
              <strong>{identityStatus?.latestJob?.state ?? "not run"}</strong>
              <br />latest job
            </div>
          </div>
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
