import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Play, UserRoundSearch } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { formatPickerRange } from "@/lib/datePicker";
import { normalizeObjectId } from "@/lib/diarization";
import { resolveDefaultTimeZone } from "@/lib/timeZones";
import {
  buildSpeakerIdentityLaunchData,
  compatibleSpeakerIdentityRuns,
  type SpeakerIdentityLaunchRun,
} from "@/lib/speakerIdentityLaunch";
import {
  loadVoiceIdentityStatus,
  loadVoiceProfiles,
  voiceIdentityKeys,
  type VoiceIdentityStatus,
} from "@/lib/voiceIdentity";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DateRangePicker } from "@/components/DateRangePicker";
import { useSettingsStore } from "@/stores/settingsStore";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type RangeMode = 24 | 168 | 336 | "custom";

type SpeakerIdentityLauncherProps = {
  enabled: boolean;
  onCancel?: () => void;
  onQueued?: (jobId: string) => void;
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Request failed";
}

function SpeakerIdentityLauncher({
  enabled,
  onCancel,
  onQueued,
}: SpeakerIdentityLauncherProps) {
  const queryClient = useQueryClient();
  const defaultTimeZone = useSettingsStore((state) => state.defaultTimeZone);
  const pickerTimeZone = resolveDefaultTimeZone(defaultTimeZone);
  const [rangeMode, setRangeMode] = useState<RangeMode>(24);
  const [rangeAnchor, setRangeAnchor] = useState(() => new Date());
  const [customStart, setCustomStart] = useState(
    () => new Date(Date.now() - 86_400_000),
  );
  const [customEnd, setCustomEnd] = useState(() => new Date());
  const [selectedRunId, setSelectedRunId] = useState("");

  useEffect(() => {
    if (enabled) setRangeAnchor(new Date());
  }, [enabled]);

  const profilesQuery = useQuery({
    queryKey: voiceIdentityKeys.profiles,
    queryFn: loadVoiceProfiles,
    enabled,
    staleTime: 30_000,
  });
  const primary = profilesQuery.data?.find((profile) => profile.is_primary);
  const primaryId = normalizeObjectId(primary?._id);
  const statusQuery = useQuery<VoiceIdentityStatus>({
    queryKey: voiceIdentityKeys.status(primaryId),
    queryFn: () => loadVoiceIdentityStatus(primaryId!),
    enabled: enabled && Boolean(primaryId),
  });
  const runsQuery = useQuery<SpeakerIdentityLaunchRun[]>({
    queryKey: ["speaker-runs"],
    queryFn: () =>
      api.callResource("speaker-segments", {
        action: "list-runs",
      }) as Promise<SpeakerIdentityLaunchRun[]>,
    enabled,
  });

  const status = statusQuery.data;
  const calibration = status?.usableCalibration;
  const calibrationPolicy = calibration
    ? calibration.classificationPolicy ??
      (calibration.targetPrecision >= 0.98 ? "full" : "pilot")
    : null;
  const pilotOnly = Boolean(calibration && calibrationPolicy === "pilot");
  const maxRangeHours = calibration?.maxRangeHours ?? (pilotOnly ? 24 : null);
  const compatibleRuns = useMemo(
    () =>
      compatibleSpeakerIdentityRuns(
        runsQuery.data ?? [],
        calibration?.embeddingSpaceId ?? status?.profile?.embeddingSpaceId,
      ),
    [
      calibration?.embeddingSpaceId,
      runsQuery.data,
      status?.profile?.embeddingSpaceId,
    ],
  );

  useEffect(() => {
    if (!compatibleRuns.some((run) => run.runId === selectedRunId)) {
      setSelectedRunId(compatibleRuns[0]?.runId ?? "");
    }
  }, [compatibleRuns, selectedRunId]);

  useEffect(() => {
    if (pilotOnly && rangeMode !== 24 && rangeMode !== "custom") {
      setRangeMode(24);
    }
  }, [pilotOnly, rangeMode]);

  const selectedRun = compatibleRuns.find((run) => run.runId === selectedRunId);
  const range = rangeMode === "custom"
    ? { start: customStart, end: customEnd }
    : {
      start: new Date(rangeAnchor.getTime() - rangeMode * 3_600_000),
      end: rangeAnchor,
    };
  const activeCampaign = status?.latestCampaign &&
      ["queued", "counting", "running"].includes(status.latestCampaign.status)
    ? status.latestCampaign
    : null;
  const loading = profilesQuery.isLoading || runsQuery.isLoading ||
    (Boolean(primaryId) && statusQuery.isLoading);

  const blockers = useMemo(() => {
    const values: string[] = [];
    if (!loading && profilesQuery.isError) {
      values.push(
        `Could not load voice profiles: ${errorMessage(profilesQuery.error)}`,
      );
    } else if (!loading && !primaryId) {
      values.push("Create or select a primary voice profile first");
    }
    if (!loading && statusQuery.isError) {
      values.push(
        `Could not verify identity readiness: ${
          errorMessage(statusQuery.error)
        }`,
      );
    }
    if (!loading && runsQuery.isError) {
      values.push(
        `Could not load diarization generations: ${
          errorMessage(runsQuery.error)
        }`,
      );
    }
    values.push(...(status?.blockers ?? []));
    if (status && !status.canClassify && values.length === 0) {
      values.push("Voice identity prerequisites are incomplete");
    }
    if (status?.canClassify && !calibration) {
      values.push("No server-validated calibration is available");
    }
    if (
      calibration && status?.profile &&
      calibration.profileRevision !== status.profile.revision
    ) {
      values.push("Calibration does not match the current profile revision");
    }
    if (
      calibration && primaryId && calibration.profileId !== primaryId
    ) {
      values.push("Calibration belongs to another voice profile");
    }
    if (
      calibration && status?.profile?.embeddingSpaceId !==
        calibration.embeddingSpaceId
    ) {
      values.push("Calibration does not match the current embedding space");
    }
    if (
      !loading && !runsQuery.isError &&
      Boolean(status?.profile?.embeddingSpaceId) &&
      compatibleRuns.length === 0
    ) {
      values.push(
        "No active diarization generation uses the current profile embedding space",
      );
    }
    if (activeCampaign) {
      values.push(
        "A speaker identity classification campaign is already running",
      );
    }
    if (range.end <= range.start) {
      values.push("End time must be after start time");
    }
    if (
      maxRangeHours != null &&
      range.end.getTime() - range.start.getTime() >
        maxRangeHours * 3_600_000
    ) {
      values.push(
        `This provisional calibration is limited to ${maxRangeHours} hours per pilot`,
      );
    }
    return [...new Set(values)];
  }, [
    activeCampaign,
    calibration,
    compatibleRuns.length,
    loading,
    maxRangeHours,
    primaryId,
    profilesQuery.error,
    profilesQuery.isError,
    range.end,
    range.start,
    runsQuery.error,
    runsQuery.isError,
    status,
    statusQuery.error,
    statusQuery.isError,
  ]);

  const launch = useMutation({
    mutationFn: async () => {
      if (!primaryId || !status?.profile || !calibration || !selectedRun) {
        throw new Error(blockers[0] ?? "Identity launch context is incomplete");
      }
      return await api.callResource("jobs", {
        action: "enqueue",
        data: buildSpeakerIdentityLaunchData({
          profileId: primaryId,
          profileRevision: status.profile.revision,
          calibrationId: calibration.calibrationId,
          embeddingSpaceId: calibration.embeddingSpaceId,
          runId: selectedRun.runId,
          start: range.start,
          end: range.end,
        }),
        priority: 3,
        trigger: {
          type: "manual",
          reason: pilotOnly
            ? "Provisional Voice Identity pilot from Jobs"
            : rangeMode === 24
            ? "Voice Identity 24-hour pilot from Jobs"
            : "Voice Identity classification from Jobs",
        },
      }) as { jobId: string };
    },
    onSuccess: (result) => {
      toast.success("Speaker identity classification queued");
      void queryClient.invalidateQueries({ queryKey: ["jobs"] });
      void queryClient.invalidateQueries({
        queryKey: voiceIdentityKeys.status(primaryId),
      });
      onQueued?.(result.jobId);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-3">
        <div className="rounded-md border bg-muted/20 p-3">
          <p className="text-xs text-muted-foreground">Voice profile</p>
          <p className="mt-1 text-sm font-medium">
            {loading ? "Loading…" : primary?.name ?? "No primary profile"}
          </p>
          {status?.profile && (
            <p className="text-xs text-muted-foreground">
              Revision {status.profile.revision}
            </p>
          )}
        </div>
        <div className="rounded-md border bg-muted/20 p-3">
          <p className="text-xs text-muted-foreground">Calibration</p>
          <p className="mt-1 text-sm font-medium">
            {loading
              ? "Checking…"
              : calibration
              ? calibrationPolicy === "pilot"
                ? "Provisional pilot"
                : "Full classification"
              : "Not ready"}
          </p>
          {calibration && (
            <Badge
              className={calibrationPolicy === "pilot"
                ? "mt-1 bg-amber-500/10 text-amber-600"
                : "mt-1 bg-green-500/10 text-green-600"}
            >
              {(calibration.targetPrecision * 100).toFixed(0)}% held-out target
            </Badge>
          )}
        </div>
        <div className="rounded-md border bg-muted/20 p-3">
          <p className="text-xs text-muted-foreground">
            Diarization generation
          </p>
          {compatibleRuns.length > 1
            ? (
              <Select value={selectedRunId} onValueChange={setSelectedRunId}>
                <SelectTrigger
                  className="mt-1 h-8"
                  aria-label="Diarization generation"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {compatibleRuns.map((run) => (
                    <SelectItem key={run.runId} value={run.runId}>
                      Generation {run.generation ?? "legacy"} · active
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )
            : (
              <p className="mt-1 text-sm font-medium">
                {loading
                  ? "Checking…"
                  : !calibration
                  ? selectedRun
                    ? `Generation ${
                      selectedRun.generation ?? "legacy"
                    } · active; calibration pending`
                    : "No active generation for the profile embedding space"
                  : selectedRun
                  ? `Generation ${selectedRun.generation ?? "legacy"} · active`
                  : "No compatible active generation"}
              </p>
            )}
        </div>
      </div>

      <div className="space-y-2">
        <Label>Audio range</Label>
        <div className="flex flex-wrap gap-2">
          {([
            [24, "24-hour pilot"],
            [168, "7 days"],
            [336, "14 days"],
          ] as const).map(([hours, label]) => (
            <Button
              key={hours}
              type="button"
              size="sm"
              variant={rangeMode === hours ? "default" : "outline"}
              onClick={() => setRangeMode(hours as 24 | 168 | 336)}
              disabled={maxRangeHours != null && hours > maxRangeHours}
            >
              {label}
            </Button>
          ))}
          <Button
            type="button"
            size="sm"
            variant={rangeMode === "custom" ? "default" : "outline"}
            onClick={() => setRangeMode("custom")}
          >
            Custom
          </Button>
        </div>
      </div>

      {rangeMode === "custom" && (
        <div className="rounded-md border p-3">
          <DateRangePicker
            label="Custom audio range"
            value={{ start: customStart, end: customEnd }}
            onChange={(value) => {
              setCustomStart(value.start);
              if (value.end) setCustomEnd(value.end);
            }}
            maxDurationMs={maxRangeHours == null
              ? undefined
              : maxRangeHours * 3_600_000}
            showAudioTimeline
          />
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Selected: {formatPickerRange(range, pickerTimeZone, "minute")}.{" "}
        Existing diarization embeddings are classified in resumable batches;
        audio is not processed again.
        {pilotOnly && (
          <>
            {" "}This lower-precision calibration is provisional, so each run is
            capped at {maxRangeHours ?? 24}{" "}
            hours. Review false positives before expanding.
          </>
        )}
      </p>

      {activeCampaign?.currentJobId && (
        <div className="rounded-md border border-blue-500/30 bg-blue-500/5 p-3 text-sm">
          Current classification is {activeCampaign.status}.{"  "}
          <Link
            className="font-medium text-primary hover:underline"
            to={`/jobs/${activeCampaign.currentJobId}`}
          >
            Open job details
          </Link>
        </div>
      )}

      {!loading && blockers.length > 0 && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
          <p className="text-sm font-medium text-amber-600">
            Classification is blocked
          </p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
            {blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}
          </ul>
          <div className="mt-2 flex flex-wrap gap-3 text-xs font-medium">
            <Link
              className="text-primary hover:underline"
              to="/settings/voice-identity"
            >
              Review and validate →
            </Link>
            <Link
              className="text-primary hover:underline"
              to="/settings/voice-identity/operations"
            >
              Generations →
            </Link>
          </div>
        </div>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button
          type="button"
          onClick={() => launch.mutate()}
          disabled={loading || blockers.length > 0 || !selectedRun ||
            launch.isPending}
        >
          <Play className="mr-2 h-4 w-4" />
          {launch.isPending
            ? "Queueing…"
            : pilotOnly
            ? "Start provisional pilot"
            : rangeMode === 24
            ? "Start 24-hour pilot"
            : "Start classification"}
        </Button>
      </div>
    </div>
  );
}

export function SpeakerIdentityLaunchPanel({
  onQueued,
}: {
  onQueued?: (jobId: string) => void;
}) {
  return <SpeakerIdentityLauncher enabled onQueued={onQueued} />;
}

export function SpeakerIdentityLaunchDialog() {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          aria-label="Run speaker identity job"
        >
          <Play className="h-3.5 w-3.5 text-muted-foreground hover:text-primary" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserRoundSearch className="h-5 w-5 text-primary" />
            Classify existing voice segments
          </DialogTitle>
          <DialogDescription>
            Profile revision, validated calibration, embedding space and active
            generation are selected automatically. Only choose the time range.
          </DialogDescription>
        </DialogHeader>
        <SpeakerIdentityLauncher
          enabled={open}
          onCancel={() => setOpen(false)}
          onQueued={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
