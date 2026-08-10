import { useState } from "react";
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
import { AlertCircle, Loader2, RefreshCw } from "lucide-react";

type IdentityStatus = {
  labels: {
    sky: number;
    notSky: number;
    total: number;
    recordings: number;
    byRecording?: Array<{ id: string; sky: number; notSky: number; total: number }>;
  };
  calibrations: Array<{ calibrationId: string; status: string; updatedAt?: Date }>;
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
  const { data: identityStatus, refetch: refetchIdentityStatus } = useQuery<IdentityStatus>({
    queryKey: ["speaker-identity-status", profileId],
    enabled: Boolean(profileId),
    queryFn: () => callResource("speaker-segments", {
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
  const {
    data: queue = [],
    isLoading,
    isFetching,
    isError,
    error,
    refetch,
  } = useQuery<any[]>({
    queryKey: ["speaker-review", range.start.getTime(), range.end.getTime()],
    queryFn: () =>
      callResource("speaker-segments", {
        action: "review-queue",
        ...range,
        state: "reviewable",
        limit: 100,
      }) as Promise<any[]>,
    staleTime: 30_000,
  });

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
      if (state === "me") {
        return await callResource("speaker-segments", {
          action: "assign",
          segmentId,
          scope: "segment",
          profileId,
        });
      }
      return await callResource("speaker-segments", {
        action: "annotate",
        originalId,
        segmentId,
        runId: segment.runId,
        start: segment.start,
        end: segment.end,
        excludedProfileIds: [profileId],
      });
    },
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ["speaker-review"] }),
    onError: (error) =>
      toast.error(
        error instanceof Error ? error.message : "Could not label segment",
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
        <Card className={primary?.embeddingSpaceId ? "border-green-500/30" : "border-amber-500/40"}>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">1. Build Sky profile</CardTitle>
            <CardDescription>Combine the saved clean samples into the current embedding space.</CardDescription>
          </CardHeader>
          <CardContent className="text-sm">
            {primary?.embeddingSpaceId
              ? <span className="text-green-700">Ready · revision {primary.revision ?? 1}</span>
              : <span className="text-amber-700">Re-enrollment is required</span>}
          </CardContent>
        </Card>
        <Card className={labels.total >= 100 ? "border-green-500/30" : "border-amber-500/40"}>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">2. Label examples</CardTitle>
            <CardDescription>Use “This is me” and “Not me” below. Counts update automatically.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p><strong>{labels.sky}</strong> Sky · need 40</p>
            <p><strong>{labels.notSky}</strong> not-Sky · need 40</p>
            <p><strong>{labels.total}</strong> total · need 100 across {labels.recordings} recordings</p>
          </CardContent>
        </Card>
        <Card className={latestCalibration ? "border-green-500/30" : "border-muted"}>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">3. Validate and classify</CardTitle>
            <CardDescription>Lock thresholds on separate recordings, then classify stored embeddings.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>{latestCalibration ? `Validated · ${latestCalibration.calibrationId}` : "Not validated yet"}</p>
            <Link className="font-medium text-primary hover:underline" to="/audio/pipeline">
              Open Classify existing →
            </Link>
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
          {!isLoading && !isError && queue.length === 0 && (
            <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
              No reviewable segments in this range. Wait for diarization coverage
              or use a wider range on the Timeline.
            </div>
          )}
          {!isLoading && !isError && queue.length > 0 && (
            <p className="text-sm text-muted-foreground">
              {queue.length} segments ready for review
              {isFetching ? " · refreshing…" : ""}
            </p>
          )}
          {queue.map((segment) => {
            const id = normalizeObjectId(segment._id)!;
            return (
              <div
                key={id}
                className="flex flex-wrap items-center gap-2 rounded-md border p-3 text-sm"
              >
                <Link
                  className="font-mono text-primary hover:underline"
                  to={`/diarizations/${id}`}
                >
                  {new Date(segment.start).toLocaleString()}
                </Link>
                <span>
                  {Math.round(
                    (segment.speakerIdentity?.primaryScore ?? 0) * 100,
                  )}%
                </span>
                <Button
                  size="sm"
                  onClick={() => label.mutate({ segment, state: "me" })}
                >
                  This is me
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => label.mutate({ segment, state: "not-me" })}
                >
                  Not me
                </Button>
              </div>
            );
          })}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>3. Validate Sky calibration</CardTitle>
          <CardDescription>
            Label counts are taken from your manual review automatically. Choose
            two non-overlapping sets of source recording IDs: one for choosing
            thresholds and another for checking that Sky precision is at least 98%.
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
            <p className="text-muted-foreground">{labels.sky} Sky · {labels.notSky} not-Sky · {queue.length} currently uncertain</p>
          </div>
          <div className="space-y-3 md:col-span-3">
            <div>
              <p className="text-sm font-medium">Split labeled recordings</p>
              <p className="text-xs text-muted-foreground">
                Put each source in exactly one set. Calibration chooses thresholds;
                validation checks them on audio the threshold selection never saw.
              </p>
            </div>
            {(labels.byRecording?.length ?? 0) === 0
              ? (
                <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                  No labeled recordings yet. Label segments above or open the Timeline,
                  then this selector will fill automatically.
                </div>
              )
              : labels.byRecording?.slice(0, 20).map((recording) => {
                const selected = calibrationIds.includes(recording.id)
                  ? "calibration"
                  : validationIds.includes(recording.id)
                  ? "validation"
                  : "unused";
                return (
                  <div key={recording.id} className="flex flex-wrap items-center gap-2 rounded-md border p-3 text-sm">
                    <Link className="min-w-0 flex-1 truncate font-mono text-primary hover:underline" to={`/timeline?originalId=${recording.id}`}>
                      {recording.id}
                    </Link>
                    <span className="text-xs text-muted-foreground">
                      {recording.sky} Sky · {recording.notSky} not-Sky
                    </span>
                    {(["calibration", "validation", "unused"] as const).map((target) => (
                      <Button
                        key={target}
                        type="button"
                        size="sm"
                        variant={selected === target ? "default" : "outline"}
                        onClick={() => chooseRecordingSet(recording.id, target)}
                      >
                        {target === "calibration" ? "Calibration" : target === "validation" ? "Validation" : "Unused"}
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
            {saveCalibration.isPending ? "Saving…" : "Validate calibration and unlock classification"}
          </Button>
          {!canValidate && (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm md:col-span-3">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <span>Complete the missing prerequisites above. The button unlocks only after 100 real labels (40/40 minimum), separate recording sets, valid thresholds, and ≥98% validation precision.</span>
            </div>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Classify existing — current results</CardTitle>
          <CardDescription>Identity matching reuses stored diarization embeddings; it does not rerun VAD, STT, or diarization.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-2 text-sm md:grid-cols-5">
            <div className="rounded-md border p-3"><strong>{identityStatus?.classification.identified ?? 0}</strong><br />identified</div>
            <div className="rounded-md border p-3"><strong>{identityStatus?.classification.unknown ?? 0}</strong><br />unknown</div>
            <div className="rounded-md border p-3"><strong>{identityStatus?.classification.uncertain ?? 0}</strong><br />uncertain</div>
            <div className="rounded-md border p-3"><strong>{identityStatus?.classification.unclassified ?? 0}</strong><br />unclassified</div>
            <div className="rounded-md border p-3"><strong>{identityStatus?.latestJob?.state ?? "not run"}</strong><br />latest job</div>
          </div>
          <Button asChild disabled={!latestCalibration}>
            <Link to="/audio/pipeline">Open Pipeline and run Classify existing</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
