import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { callResource } from "@/lib/api";
import { normalizeObjectId } from "@/lib/diarization";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DateTimePicker } from "@/components/ui/datetime-picker";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  getRunComparison,
  validateOperationRange,
} from "@/lib/voiceIdentityOperations";
import { useActionDialog } from "@/components/ActionDialogProvider";
import { getSpeakerIdentityProgressView } from "@/lib/speakerIdentityProgress";
import {
  loadVoiceIdentityStatus,
  loadVoiceProfiles,
  voiceIdentityKeys,
  type VoiceIdentityStatus,
  type VoiceProfile,
} from "@/lib/voiceIdentity";

type Run = {
  runId: string;
  status:
    | "building"
    | "interrupted"
    | "ready"
    | "active"
    | "superseded"
    | "failed";
  generation: number;
  embeddingSpaceId: string;
  range?: { start: Date; end: Date };
  replacesRunId?: string;
  campaign?: {
    campaignId: string;
    status: string;
    processedChunks?: number;
    totalChunks?: number;
    pendingChunks?: number;
    etaSeconds?: number | null;
    batchNumber?: number;
    estimatedBatches?: number;
    errorCount?: number;
    currentJobId?: string;
  };
};

type IdentityCampaign = {
  campaignId: string;
  status: "counting" | "running" | "completed" | "failed";
  range?: { start?: Date; end?: Date };
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
  updatedAt?: Date;
};

export function VoiceIdentityOperations() {
  const { promptAction } = useActionDialog();
  const queryClient = useQueryClient();
  const [hours, setHours] = useState(24 * 7);
  const [rangeMode, setRangeMode] = useState<"preset" | "custom">("preset");
  const [customStart, setCustomStart] = useState(
    () => new Date(Date.now() - 24 * 3_600_000),
  );
  const [customEnd, setCustomEnd] = useState(() => new Date());
  const [actionResult, setActionResult] = useState<
    {
      title: string;
      value: unknown;
    } | null
  >(null);
  const presetRange = useMemo(
    () => ({
      start: new Date(Date.now() - hours * 3_600_000),
      end: new Date(),
    }),
    [hours],
  );
  const range = rangeMode === "custom"
    ? { start: customStart, end: customEnd }
    : presetRange;
  const rangeError = validateOperationRange(range.start, range.end);

  const { data: runs = [] } = useQuery<Run[]>({
    queryKey: ["speaker-runs"],
    queryFn: () =>
      callResource("speaker-segments", { action: "list-runs" }) as Promise<
        Run[]
      >,
    refetchInterval: (query) => {
      if (document.visibilityState !== "visible") return false;
      return query.state.data?.some((run) =>
          ["building", "interrupted", "ready"].includes(run.status)
        )
        ? 10_000
        : false;
    },
  });
  const { data: profiles = [] } = useQuery<VoiceProfile[]>({
    queryKey: voiceIdentityKeys.profiles,
    queryFn: loadVoiceProfiles,
  });
  const primary = profiles.find((profile) => profile.is_primary);
  const primaryId = primary ? normalizeObjectId(primary._id) : null;
  const { data: identityStatus } = useQuery<VoiceIdentityStatus>({
    queryKey: voiceIdentityKeys.status(primaryId),
    enabled: Boolean(primaryId),
    queryFn: () => loadVoiceIdentityStatus(primaryId!),
  });
  const calibration = identityStatus?.usableCalibration;
  const calibrationPolicy = calibration
    ? calibration.classificationPolicy ??
      (calibration.targetPrecision >= 0.98 ? "full" : "pilot")
    : null;
  const pilotOnly = calibrationPolicy === "pilot";
  const maxClassificationHours = calibration?.maxRangeHours ??
    (pilotOnly ? 24 : null);
  const activeRun = runs.find((run) => run.status === "active");
  const { data: identityCampaigns = [] } = useQuery<IdentityCampaign[]>({
    queryKey: ["speaker-identity-campaigns", primaryId, activeRun?.runId],
    enabled: Boolean(primaryId),
    queryFn: () =>
      callResource("speaker-segments", {
        action: "list-identity-campaigns",
        profileId: primaryId,
        runId: activeRun?.runId,
        limit: 10,
      }) as Promise<IdentityCampaign[]>,
    refetchInterval: (query) => {
      if (document.visibilityState !== "visible") return false;
      return query.state.data?.some((campaign) =>
          ["queued", "counting", "running"].includes(campaign.status)
        )
        ? 5_000
        : false;
    },
  });
  const latestIdentityCampaign = identityCampaigns[0];
  const identityProgress = latestIdentityCampaign
    ? getSpeakerIdentityProgressView({
      processed: latestIdentityCampaign.processedSegments,
      total: latestIdentityCampaign.totalSegments,
      remaining: latestIdentityCampaign.pendingSegments,
      segmentsPerSecond: latestIdentityCampaign.segmentsPerSecond,
      etaSeconds: latestIdentityCampaign.etaSeconds,
    })
    : null;

  useEffect(() => {
    if (pilotOnly && rangeMode === "preset" && hours > 24) setHours(24);
  }, [hours, pilotOnly, rangeMode]);

  const classificationRangeTooLarge = maxClassificationHours != null &&
    range.end.getTime() - range.start.getTime() >
      maxClassificationHours * 3_600_000;

  const operation = useMutation({
    mutationFn: async (kind: "classify" | "missing" | "rediarize") => {
      if (kind === "classify") {
        if (!activeRun || !primaryId || !calibration) {
          throw new Error(
            "Active run, primary profile and validated calibration are required",
          );
        }
        if (classificationRangeTooLarge) {
          throw new Error(
            `This provisional calibration is limited to ${maxClassificationHours} hours`,
          );
        }
        return await callResource("jobs", {
          action: "enqueue",
          data: {
            type: "speakerIdentity",
            runId: activeRun.runId,
            profileId: primaryId,
            profileRevision: primary?.revision ?? 1,
            calibrationId: calibration.calibrationId,
            ...range,
            limit: 1000,
          },
          trigger: {
            type: "manual",
            reason: "Classify existing speaker embeddings",
          },
        });
      }
      if (kind === "missing") {
        return await callResource("jobs", {
          action: "enqueue",
          data: {
            type: "diarization",
            mode: "missing",
            ...range,
            limit: 4,
            batchSize: 4,
          },
          trigger: { type: "manual", reason: "Diarize missing speech chunks" },
          priority: 3,
        });
      }
      const health = await callResource("jobs", {
        action: "services_health",
        force: true,
      }) as any;
      const service = health.services?.find((item: any) =>
        item.id === "diarizator"
      );
      const metadata = service?.metadata;
      if (
        service?.status !== "healthy" || !metadata?.embeddingSpaceId ||
        !metadata?.diarizationFingerprint
      ) {
        throw new Error(
          "Healthy diarizator with runtime fingerprint is required",
        );
      }
      const runId = `diar-${new Date().toISOString().replace(/[:.]/g, "-")}`;
      await callResource("speaker-segments", {
        action: "create-run",
        runId,
        mode: "rediarize",
        generation: Math.max(0, ...runs.map((run) => run.generation)) + 1,
        ...range,
        replacesRunId: activeRun?.runId,
        diarizationFingerprint: metadata.diarizationFingerprint,
        embeddingSpaceId: metadata.embeddingSpaceId,
      });
      return await callResource("jobs", {
        action: "enqueue",
        data: {
          type: "diarization",
          mode: "build_generation",
          runId,
          ...range,
          limit: 4,
          batchSize: 4,
        },
        trigger: {
          type: "manual",
          reason: `Build diarization generation ${runId}`,
        },
        priority: 5,
      });
    },
    onSuccess: () => {
      toast.success("Voice Identity operation queued");
      void queryClient.invalidateQueries({ queryKey: ["speaker-runs"] });
      void queryClient.invalidateQueries({
        queryKey: ["speaker-identity-campaigns"],
      });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Operation failed"),
  });

  const runAction = useMutation({
    mutationFn: async (
      { action, runId }: {
        action:
          | "compare-run"
          | "mark-run-failed"
          | "activate-run"
          | "preview-purge"
          | "purge-superseded";
        runId: string;
      },
    ) => {
      if (action === "purge-superseded") {
        const phrase = `PURGE ${runId}`;
        const confirmation = await promptAction({
          title: `Purge superseded run ${runId}?`,
          description:
            "Only superseded diarization documents and embeddings will be deleted. Raw audio and transcripts are not affected.",
          confirmationPhrase: phrase,
          inputLabel: `Type ${phrase} to confirm`,
          actionLabel: "Purge run",
          destructive: true,
        });
        if (!confirmation) return null;
        const value = await callResource("speaker-segments", {
          action,
          runId,
          confirmation,
        });
        return { kind: action, runId, value };
      }
      if (action === "compare-run") {
        const run = runs.find((item) => item.runId === runId);
        if (!run) throw new Error("Run not found");
        const comparison = getRunComparison(run, runs);
        if (!comparison.enabled || !comparison.baseline) {
          throw new Error(comparison.reason);
        }
        const [selected, baseline] = await Promise.all([
          callResource("speaker-segments", { action, runId }),
          callResource("speaker-segments", {
            action,
            runId: comparison.baseline.runId,
          }),
        ]);
        return {
          kind: "comparison",
          runId,
          baselineRunId: comparison.baseline.runId,
          selected,
          baseline,
        };
      }
      const value = await callResource("speaker-segments", { action, runId });
      return { kind: action, runId, value };
    },
    onSuccess: (result) => {
      if (result) {
        setActionResult({
          title: result.kind === "comparison"
            ? `Comparison: ${result.runId} vs ${result.baselineRunId}`
            : `${result.kind}: ${result.runId}`,
          value: result,
        });
      }
      void queryClient.invalidateQueries({ queryKey: ["speaker-runs"] });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Run action failed"),
  });

  return (
    <Card data-testid="voice-identity-operations">
      <CardHeader>
        <CardTitle>Voice Identity — Sky first</CardTitle>
        <CardDescription>
          Cheap classification uses stored embeddings. Re-diarization creates a
          separate generation and never replaces active data before activation.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <nav
          aria-label="Related voice identity pages"
          className="flex flex-wrap gap-x-4 gap-y-1 border-b pb-3 text-sm font-medium"
        >
          <Link
            className="text-primary hover:underline"
            to="/settings/voice-identity"
          >
            Review & calibration
          </Link>
          <Link
            className="text-primary hover:underline"
            to="/jobs?type=speakerIdentity"
          >
            Identity jobs
          </Link>
          <Link
            className="text-primary hover:underline"
            to="/jobs?type=diarization"
          >
            Diarization jobs
          </Link>
          <Link
            className="text-primary hover:underline"
            to="/settings/diarization"
          >
            Diarization servers
          </Link>
          <Link className="text-primary hover:underline" to="/audio/pipeline">
            Audio Pipeline
          </Link>
        </nav>
        <div className="flex flex-wrap items-center gap-2">
          {[24, 24 * 7, 24 * 14, 24 * 30].map((value) => (
            <Button
              key={value}
              size="sm"
              variant={rangeMode === "preset" && hours === value
                ? "default"
                : "outline"}
              onClick={() => {
                setHours(value);
                setRangeMode("preset");
              }}
              disabled={maxClassificationHours != null &&
                value > maxClassificationHours}
            >
              {value === 24 ? "24 hours" : `${value / 24} days`}
            </Button>
          ))}
          <Button
            size="sm"
            variant={rangeMode === "custom" ? "default" : "outline"}
            onClick={() => setRangeMode("custom")}
          >
            Custom range
          </Button>
          <span className="ml-auto text-xs text-muted-foreground">
            Primary: {primary?.name ?? "none"} · calibration: {calibration
              ? `${calibrationPolicy === "pilot" ? "provisional" : "full"} · ${
                (calibration.targetPrecision * 100).toFixed(0)
              }% target`
              : "not validated"}
          </span>
        </div>
        {pilotOnly && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-muted-foreground">
            This calibration is intentionally provisional. Classification is
            limited to {maxClassificationHours ?? 24}{" "}
            hours so you can review false positives before creating a ≥98% full
            calibration.
          </div>
        )}
        {(identityStatus?.blockers?.length ?? 0) > 0 && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-muted-foreground">
            {identityStatus?.blockers.join(" · ")}
          </div>
        )}
        {rangeMode === "custom" && (
          <div className="grid gap-3 rounded-md border p-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Start</Label>
              <DateTimePicker
                value={customStart}
                onChange={(date) => date && setCustomStart(date)}
              />
            </div>
            <div className="space-y-2">
              <Label>End</Label>
              <DateTimePicker
                value={customEnd}
                onChange={(date) => date && setCustomEnd(date)}
              />
            </div>
          </div>
        )}
        <div className="text-xs text-muted-foreground">
          Selected: {range.start.toLocaleString()} →{" "}
          {range.end.toLocaleString()}
          {rangeError && (
            <span className="ml-2 text-destructive">{rangeError}</span>
          )}
          {classificationRangeTooLarge && (
            <span className="ml-2 text-amber-600">
              Classification is limited to {maxClassificationHours}{" "}
              hours by the provisional calibration.
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => operation.mutate("classify")}
            disabled={operation.isPending || !identityStatus?.canClassify ||
              Boolean(rangeError) || classificationRangeTooLarge}
          >
            Classify existing
          </Button>
          <Button
            variant="outline"
            onClick={() => operation.mutate("missing")}
            disabled={operation.isPending || Boolean(rangeError)}
          >
            Diarize missing
          </Button>
          <Button
            variant="outline"
            onClick={() => operation.mutate("rediarize")}
            disabled={operation.isPending || Boolean(rangeError)}
          >
            Re-diarize range
          </Button>
          <Link
            to={`/transcript?start=${range.start.getTime()}&end=${range.end.getTime()}`}
          >
            <Button variant="ghost">Open transcript</Button>
          </Link>
        </div>
        <div className="rounded-md border bg-muted/20 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-medium">Identity backfill</p>
              <p className="text-xs text-muted-foreground">
                {latestIdentityCampaign
                  ? `${latestIdentityCampaign.status} · batch ${
                    latestIdentityCampaign.batchNumber ?? 0
                  }/${latestIdentityCampaign.estimatedBatches ?? "?"}`
                  : "No classification campaign has run for this active generation."}
              </p>
            </div>
            <div className="flex gap-2">
              {latestIdentityCampaign?.currentJobId && (
                <Link to={`/jobs/${latestIdentityCampaign.currentJobId}`}>
                  <Button size="sm" variant="outline">Job details</Button>
                </Link>
              )}
              {latestIdentityCampaign?.range?.start && (
                <Link
                  to={`/timeline?start=${
                    new Date(latestIdentityCampaign.range.start).getTime()
                  }&end=${
                    latestIdentityCampaign.range.end
                      ? new Date(latestIdentityCampaign.range.end).getTime()
                      : Date.now()
                  }`}
                >
                  <Button size="sm" variant="outline">Timeline</Button>
                </Link>
              )}
            </div>
          </div>
          {latestIdentityCampaign && identityProgress && (
            <div className="mt-3 space-y-2">
              {latestIdentityCampaign.totalSegments != null && (
                <Progress value={identityProgress.percent} className="h-2" />
              )}
              <div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
                <span>{identityProgress.progressLabel}</span>
                <span>{identityProgress.etaLabel}</span>
              </div>
              <div className="flex flex-wrap gap-3 text-xs">
                <span className="text-green-600">
                  {latestIdentityCampaign.matched ?? 0} Sky
                </span>
                <span>{latestIdentityCampaign.rejected ?? 0} not Sky</span>
                <span className="text-amber-600">
                  {latestIdentityCampaign.uncertain ?? 0} uncertain
                </span>
                <span className="text-muted-foreground">
                  {latestIdentityCampaign.incompatibleSkipped ?? 0} incompatible
                </span>
                <span className="text-muted-foreground">
                  {identityProgress.remainingLabel}
                  {identityProgress.rateLabel
                    ? `${
                      identityProgress.remainingLabel ? " · " : ""
                    }${identityProgress.rateLabel}`
                    : ""}
                </span>
              </div>
            </div>
          )}
        </div>
        <div className="space-y-2">
          {runs.slice(0, 8).map((run) => {
            const comparison = getRunComparison(run, runs);
            return (
              <div
                key={run.runId}
                className="flex flex-wrap items-center gap-2 rounded-md border p-2 text-sm"
              >
                <span className="font-mono text-xs">{run.runId}</span>
                <Badge variant="outline">{run.status}</Badge>
                <span className="text-xs text-muted-foreground">
                  gen {run.generation} · {run.embeddingSpaceId}
                </span>
                <div className="ml-auto flex gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      runAction.mutate({
                        action: "compare-run",
                        runId: run.runId,
                      })}
                    disabled={runAction.isPending || !comparison.enabled}
                    title={comparison.reason}
                  >
                    {runAction.isPending &&
                        runAction.variables?.runId === run.runId
                      ? "Working…"
                      : comparison.baseline
                      ? `Compare with ${comparison.baseline.runId}`
                      : "Compare unavailable"}
                  </Button>
                  {run.status === "ready" && (
                    <Button
                      size="sm"
                      onClick={() =>
                        runAction.mutate({
                          action: "activate-run",
                          runId: run.runId,
                        })}
                    >
                      Activate
                    </Button>
                  )}
                  {run.status === "interrupted" && (
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() =>
                        runAction.mutate({
                          action: "mark-run-failed",
                          runId: run.runId,
                        })}
                    >
                      Mark failed
                    </Button>
                  )}
                  {run.status === "superseded" && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        runAction.mutate({
                          action: "activate-run",
                          runId: run.runId,
                        })}
                    >
                      Rollback to
                    </Button>
                  )}
                  {(run.status === "superseded" || run.status === "failed") && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        runAction.mutate({
                          action: "preview-purge",
                          runId: run.runId,
                        })}
                    >
                      Preview purge
                    </Button>
                  )}
                  {run.status === "superseded" && (
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() =>
                        runAction.mutate({
                          action: "purge-superseded",
                          runId: run.runId,
                        })}
                    >
                      Purge
                    </Button>
                  )}
                </div>
                <div className="w-full text-xs text-muted-foreground">
                  {comparison.reason}
                </div>
                {run.campaign && (
                  <div className="w-full space-y-1.5 rounded bg-muted/30 p-2">
                    <div className="flex justify-between gap-3 text-xs">
                      <span>
                        {run.campaign.processedChunks ?? 0} /{" "}
                        {run.campaign.totalChunks ?? "?"} chunks
                      </span>
                      <span>
                        {run.campaign.status}
                        {run.campaign.batchNumber
                          ? ` · batch ${run.campaign.batchNumber}/${
                            run.campaign.estimatedBatches ?? "?"
                          }`
                          : ""}
                        {run.campaign.errorCount
                          ? ` · ${run.campaign.errorCount} errors`
                          : ""}
                      </span>
                    </div>
                    <Progress
                      className="h-1.5"
                      value={run.campaign.totalChunks
                        ? ((run.campaign.processedChunks ?? 0) /
                          run.campaign.totalChunks) * 100
                        : 0}
                    />
                    <div className="flex justify-between gap-3 text-[11px] text-muted-foreground">
                      <span className="font-mono">
                        {run.campaign.campaignId}
                      </span>
                      {run.campaign.currentJobId && (
                        <Link
                          className="text-primary hover:underline"
                          to={`/jobs/${run.campaign.currentJobId}`}
                        >
                          Current job
                        </Link>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {actionResult && (
          <div className="space-y-2 rounded-md border bg-muted/30 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium">{actionResult.title}</span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setActionResult(null)}
              >
                Close
              </Button>
            </div>
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap text-xs">
              {JSON.stringify(actionResult.value, null, 2)}
            </pre>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
