import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Play, Server, Waves } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { DateTimePicker } from "@/components/ui/datetime-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  buildDiarizationLaunchData,
  type DiarizationCampaign,
  findOverlappingCampaign,
} from "@/lib/diarizationLaunch";

function formatEta(seconds?: number | null) {
  if (seconds == null || !Number.isFinite(seconds)) return "Estimating…";
  if (seconds < 3600) return `about ${Math.ceil(seconds / 60)} min left`;
  return `about ${Math.floor(seconds / 3600)}h ${
    Math.ceil((seconds % 3600) / 60)
  }m left`;
}

export function DiarizationLaunchDialog() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [allHistory, setAllHistory] = useState(true);
  const [presetDays, setPresetDays] = useState(7);
  const [custom, setCustom] = useState(false);
  const [customStart, setCustomStart] = useState(() =>
    new Date(Date.now() - 7 * 86_400_000)
  );
  const [customEnd, setCustomEnd] = useState(() => new Date());
  const [batchSequences, setBatchSequences] = useState(4);
  const range = useMemo(
    () =>
      allHistory
        ? { start: undefined, end: undefined }
        : custom
        ? { start: customStart, end: customEnd }
        : {
          start: new Date(Date.now() - presetDays * 86_400_000),
          end: new Date(),
        },
    [allHistory, custom, customStart, customEnd, presetDays, open],
  );

  const { data: campaigns = [], isLoading: campaignsLoading } = useQuery<
    DiarizationCampaign[]
  >({
    queryKey: ["diarization-campaigns", "launch"],
    enabled: open,
    queryFn: () =>
      api.callResource("speaker-segments", {
        action: "list-campaigns",
        limit: 50,
      }) as Promise<DiarizationCampaign[]>,
    refetchInterval: open ? 5_000 : false,
  });
  const { data: health, isLoading: healthLoading } = useQuery<any>({
    queryKey: ["pipeline-health", "diarization-launch"],
    enabled: open,
    queryFn: () =>
      api.callResource("jobs", {
        action: "services_health",
        force: true,
      }),
  });
  const route = health?.services?.find((item: any) => item.id === "diarizator");
  const overlap = findOverlappingCampaign(campaigns, range.start, range.end);
  const invalidRange = Boolean(
    range.start && range.end && range.end <= range.start,
  );

  const launch = useMutation({
    mutationFn: () =>
      api.callResource("jobs", {
        action: "enqueue",
        data: buildDiarizationLaunchData({
          ...range,
          batchSequences,
        }),
        priority: 3,
        trigger: { type: "manual", reason: "Diarize missing speech chunks" },
      }),
    onSuccess: () => {
      setOpen(false);
      toast.success("Diarization campaign queued");
      void queryClient.invalidateQueries({ queryKey: ["jobs"] });
      void queryClient.invalidateQueries({
        queryKey: ["diarization-campaigns"],
      });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Launch failed"),
  });

  const overlapPercent = overlap?.totalChunks
    ? Math.min(
      100,
      ((overlap.processedChunks ?? 0) / overlap.totalChunks) * 100,
    )
    : 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          setAllHistory(true);
          setCustom(false);
        }
        setOpen(nextOpen);
      }}
    >
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          aria-label="Run diarization job"
        >
          <Play className="h-3.5 w-3.5 text-muted-foreground hover:text-primary" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Waves className="h-5 w-5 text-blue-500" />
            Diarize missing speech
          </DialogTitle>
          <DialogDescription>
            By default, scans every source across the complete history and
            processes missing diarization in small, resumable batches. Existing
            diarization is not recalculated.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant={allHistory ? "default" : "outline"}
              onClick={() => {
                setAllHistory(true);
                setCustom(false);
              }}
            >
              All history
            </Button>
            {[1, 7, 14, 30].map((days) => (
              <Button
                key={days}
                type="button"
                size="sm"
                variant={!allHistory && !custom && presetDays === days
                  ? "default"
                  : "outline"}
                onClick={() => {
                  setAllHistory(false);
                  setCustom(false);
                  setPresetDays(days);
                }}
              >
                {days === 1 ? "24 hours" : `${days} days`}
              </Button>
            ))}
            <Button
              type="button"
              size="sm"
              variant={!allHistory && custom ? "default" : "outline"}
              onClick={() => {
                setAllHistory(false);
                setCustom(true);
              }}
            >
              Custom
            </Button>
          </div>

          {allHistory && (
            <div className="rounded-md border border-blue-500/30 bg-blue-500/5 p-3 text-sm">
              <div className="font-medium">Global missing-work scan</div>
              <div className="mt-1 text-xs text-muted-foreground">
                Includes every source from the oldest recording through now. No
                source ID or date bounds will be sent with the job.
              </div>
            </div>
          )}

          {custom && (
            <div className="grid gap-3 rounded-md border p-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Start</Label>
                <DateTimePicker
                  value={customStart}
                  onChange={(value) => value && setCustomStart(value)}
                />
              </div>
              <div className="space-y-2">
                <Label>End</Label>
                <DateTimePicker
                  value={customEnd}
                  onChange={(value) => value && setCustomEnd(value)}
                />
              </div>
            </div>
          )}

          <div className="rounded-md border bg-muted/20 p-3 text-sm">
            <div className="flex items-center gap-2 font-medium">
              <Server className="h-4 w-4" />
              {healthLoading
                ? "Checking diarizator…"
                : route?.status === "healthy"
                ? `${
                  route.metadata?.providerProfileName ?? route.name ??
                    "Diarizator"
                } is ready`
                : "No healthy diarizator"}
            </div>
            {route?.metadata?.baseUrl && (
              <div className="mt-1 font-mono text-xs text-muted-foreground">
                {route.metadata.baseUrl}
              </div>
            )}
          </div>

          {campaignsLoading
            ? (
              <div className="text-sm text-muted-foreground">
                Checking existing campaigns…
              </div>
            )
            : overlap && (
              <div className="space-y-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
                <div className="text-sm font-medium text-amber-600">
                  This range is already being processed
                </div>
                <Progress value={overlapPercent} className="h-2" />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>
                    {overlap.processedChunks ?? 0} /{" "}
                    {overlap.totalChunks ?? "?"} chunks
                  </span>
                  <span>{formatEta(overlap.etaSeconds)}</span>
                </div>
                <Link
                  to="/jobs?type=diarization"
                  className="text-xs text-primary hover:underline"
                >
                  Open current diarization jobs
                </Link>
              </div>
            )}

          <details className="rounded-md border p-3">
            <summary className="cursor-pointer text-sm font-medium">
              Advanced
            </summary>
            <div className="mt-3 space-y-2">
              <Label htmlFor="diarization-batch-sequences">
                Sequences per job
              </Label>
              <Input
                id="diarization-batch-sequences"
                type="number"
                min={1}
                max={100}
                value={batchSequences}
                onChange={(event) =>
                  setBatchSequences(
                    Math.max(1, Math.min(100, Number(event.target.value) || 1)),
                  )}
              />
              <div className="text-xs text-muted-foreground">
                {batchSequences} sequences/job · up to 6 chunks/request
              </div>
            </div>
          </details>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => launch.mutate()}
            disabled={launch.isPending || Boolean(overlap) || invalidRange ||
              route?.status !== "healthy"}
          >
            {launch.isPending
              ? "Queueing…"
              : allHistory
              ? "Start full-history diarization"
              : "Start diarization"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
