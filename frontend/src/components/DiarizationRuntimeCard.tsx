import { Activity, AlertCircle, Clock3, Server } from "lucide-react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { JobInfo } from "@/types/jobs";
import {
  buildDiarizationRuntime,
  type DiarizationRuntimeRoute,
  type DiarizationSlotState,
} from "@/lib/diarizationRuntime";

const SLOT_LABELS: Record<DiarizationSlotState, string> = {
  processing: "processing",
  queued: "queued",
  stale: "stale record",
  idle: "idle",
  disabled: "off",
};

const SLOT_CLASSES: Record<DiarizationSlotState, string> = {
  processing: "bg-blue-500/10 text-blue-500",
  queued: "bg-amber-500/10 text-amber-500",
  stale: "bg-red-500/10 text-red-500",
  idle: "bg-muted text-muted-foreground",
  disabled: "bg-muted text-muted-foreground/60",
};

function shortId(id: string) {
  return id.slice(-6);
}

function lastUpdateLabel(job: JobInfo): string | null {
  const updatedOn = job.updatedOn ?? job.processedOn;
  if (!updatedOn) return null;
  const elapsedSeconds = Math.max(
    0,
    Math.floor((Date.now() - updatedOn) / 1000),
  );
  if (elapsedSeconds < 10) return "updated just now";
  if (elapsedSeconds < 60) return `updated ${elapsedSeconds}s ago`;
  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  if (elapsedMinutes < 60) return `updated ${elapsedMinutes}m ago`;
  return `updated ${Math.floor(elapsedMinutes / 60)}h ago`;
}

export function DiarizationRuntimeCard({
  routes,
  jobs,
  workerConcurrency,
  onSyncConcurrency,
  syncing,
}: {
  routes: DiarizationRuntimeRoute[];
  jobs: JobInfo[];
  workerConcurrency: number;
  onSyncConcurrency?: (concurrency: number) => void;
  syncing?: boolean;
}) {
  const runtime = buildDiarizationRuntime(routes, workerConcurrency, jobs);

  return (
    <Card data-testid="diarization-runtime" className="border-blue-500/20">
      <CardHeader className="px-3 py-2.5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Server className="h-4 w-4" />
              Live diarization slots
            </CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Slots stay in place; individual job IDs rotate after each bounded
              batch, so rows in the Active filter are expected to appear and
              disappear.
            </p>
          </div>
          <div className="flex gap-1.5">
            <Badge variant="secondary" className="bg-blue-500/10 text-blue-500">
              <Activity className="mr-1 h-3 w-3" />
              {runtime.activeJobs} processing
            </Badge>
            {runtime.queuedJobs > 0 && (
              <Badge
                variant="secondary"
                className="bg-amber-500/10 text-amber-500"
              >
                <Clock3 className="mr-1 h-3 w-3" />
                {runtime.queuedJobs} queued
              </Badge>
            )}
            {runtime.staleJobs > 0 && (
              <Badge
                variant="secondary"
                className="bg-red-500/10 text-red-500"
              >
                <AlertCircle className="mr-1 h-3 w-3" />
                {runtime.staleJobs} stale
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 px-3 pb-3 pt-0">
        {runtime.concurrencyMismatch && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-xs">
            <div className="flex min-w-0 gap-2">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
              <span>
                Worker limit is{" "}
                {runtime.workerConcurrency}, but enabled routes expose{" "}
                {runtime.configuredCapacity} slots. Only{" "}
                {runtime.workerConcurrency}{" "}
                jobs can process at once; another route must wait.
              </span>
            </div>
            {onSyncConcurrency && runtime.configuredCapacity > 0 && (
              <Button
                size="sm"
                variant="outline"
                disabled={syncing}
                onClick={() => onSyncConcurrency(runtime.configuredCapacity)}
              >
                {syncing
                  ? "Syncing…"
                  : `Use all ${runtime.configuredCapacity} slots`}
              </Button>
            )}
          </div>
        )}

        <div className="grid gap-2 lg:grid-cols-2">
          {runtime.routes.map((route) => {
            const processing = route.slots.filter((slot) =>
              slot.state === "processing"
            ).length;
            return (
              <div key={route.id} className="rounded-md border bg-muted/10 p-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-xs font-medium">
                      {route.name}
                    </div>
                    {route.baseUrl && (
                      <div className="truncate font-mono text-[10px] text-muted-foreground">
                        {route.baseUrl}
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Badge
                      variant="secondary"
                      className={`text-[10px] ${
                        route.enabled
                          ? route.health === "healthy"
                            ? "bg-green-500/10 text-green-600"
                            : "bg-muted text-muted-foreground"
                          : "bg-amber-500/10 text-amber-600"
                      }`}
                    >
                      {route.enabled
                        ? route.health ?? "enabled"
                        : "off for new jobs"}
                    </Badge>
                    <Badge variant="outline" className="text-[10px]">
                      {processing}/{route.concurrency} active
                    </Badge>
                  </div>
                </div>
                <div className="mt-2 space-y-1">
                  {route.slots.map((slot) => (
                    <div
                      key={`${route.id}-${slot.index}`}
                      className="flex min-w-0 items-center gap-2 rounded bg-background/70 px-2 py-1.5 text-[11px]"
                    >
                      <span className="w-12 shrink-0 font-medium">
                        Slot {slot.index}
                      </span>
                      <Badge
                        variant="secondary"
                        className={`${
                          SLOT_CLASSES[slot.state]
                        } shrink-0 px-1.5 py-0 text-[10px]`}
                      >
                        {SLOT_LABELS[slot.state]}
                      </Badge>
                      {slot.job
                        ? (
                          <>
                            <Link
                              to={`/jobs/${slot.job.id}`}
                              className="shrink-0 font-mono text-primary hover:underline"
                            >
                              {shortId(slot.job.id)}
                            </Link>
                            <span className="min-w-0 truncate text-muted-foreground">
                              {slot.state === "stale"
                                ? "not present in the live queue"
                                : slot.job.progress?.message ||
                                  (slot.state === "queued"
                                    ? "waiting for a worker slot"
                                    : "starting")}
                              {lastUpdateLabel(slot.job)
                                ? ` · ${lastUpdateLabel(slot.job)}`
                                : ""}
                            </span>
                          </>
                        )
                        : (
                          <span className="text-muted-foreground">
                            {slot.state === "disabled"
                              ? "disabled for new jobs"
                              : "no job assigned"}
                          </span>
                        )}
                    </div>
                  ))}
                </div>
                {!route.enabled && processing > 0 && (
                  <p className="mt-1.5 text-[10px] text-amber-600">
                    The current request may finish; this batch stops before its
                    next request, and no continuation will use this server while
                    it is off.
                  </p>
                )}
              </div>
            );
          })}
        </div>

        {runtime.unmatchedJobs.length > 0 && (
          <div className="text-xs text-amber-500">
            {runtime.unmatchedJobs.length}{" "}
            live legacy job(s) have no matching current route snapshot.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
