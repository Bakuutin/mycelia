import { useMutation, useQuery } from "@tanstack/react-query";
import { Activity, AlertTriangle, CheckCircle2, RefreshCw } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import type { TimelineIntegrityReport } from "@/types/timelineRecovery";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

function formatCount(value: number): string {
  return new Intl.NumberFormat().format(value);
}

export function TimelineRecoveryStatus() {
  const { data, error, isFetching, refetch } = useQuery({
    queryKey: ["timeline-integrity-report"],
    queryFn: async () =>
      await api.callResource("jobs", {
        action: "timeline_integrity_report",
      }) as TimelineIntegrityReport,
    staleTime: 30_000,
    refetchInterval: (query) => {
      const report = query.state.data as TimelineIntegrityReport | undefined;
      if (report?.snapshot?.state === "refreshing") return 2_000;
      const status = report?.campaign?.status;
      return status === "queued" || status === "running" ||
          status === "recovering"
        ? 10_000
        : 60_000;
    },
  });

  const refreshMutation = useMutation({
    mutationFn: async () =>
      await api.callResource("jobs", { action: "refresh_timeline_integrity" }),
    onSuccess: () => void refetch(),
  });

  const campaign = data?.campaign;
  const campaignBusy = campaign?.status === "queued" ||
    campaign?.status === "running" || campaign?.status === "recovering";
  const verificationRequired = campaign?.status === "verifying";
  const completedPercent = campaign && campaign.plannedJobs > 0
    ? Math.round(campaign.completed / campaign.plannedJobs * 100)
    : 0;
  const histogramIssues =
    data?.issues.filter((issue) =>
      issue.code.startsWith("histogram_count_") ||
      issue.code === "stale_histogram_buckets"
    ) ?? [];

  return (
    <div
      className={`rounded-lg border p-3 ${
        campaignBusy
          ? "border-blue-500/30 bg-blue-500/5"
          : data?.status === "needs_attention"
          ? "border-amber-500/30 bg-amber-500/5"
          : "bg-muted/20"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {campaignBusy
              ? <Activity className="h-4 w-4 text-blue-500" />
              : verificationRequired || data?.status === "needs_attention"
              ? <AlertTriangle className="h-4 w-4 text-amber-500" />
              : <CheckCircle2 className="h-4 w-4 text-green-500" />}
            <span className="text-sm font-medium">Timeline processing</span>
            <Badge variant="secondary" className="text-[11px]">
              {campaignBusy
                ? "rebuild running"
                : verificationRequired
                ? "verification required"
                : data?.status === "needs_attention"
                ? "action required"
                : data
                ? "audit passed"
                : "checking"}
            </Badge>
          </div>

          {(!data || data.status === "not_checked") && !error && (
            <p className="mt-1 text-xs text-muted-foreground">
              Timeline integrity has not been checked yet. The audit runs only
              when requested.
            </p>
          )}
          {error && (
            <p className="mt-1 text-xs text-red-500">
              Timeline integrity check failed:{" "}
              {error instanceof Error ? error.message : String(error)}
            </p>
          )}
          {data && histogramIssues.length > 0 && !campaignBusy && (
            <div className="mt-1 text-xs text-muted-foreground">
              Full histogram rebuild is recommended. Persisted totals differ
              from raw sources: {data.sources.filter((source) =>
                source.difference !== 0
              ).map((source) =>
                `${source.label} ${source.difference > 0 ? "+" : ""}${
                  formatCount(source.difference)
                }`
              ).join(" · ")}.
            </div>
          )}
          {verificationRequired && campaign && (
            <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
              All {campaign.plannedJobs}{" "}
              rebuild batches finished. Run exact verification to compare the
              rebuilt totals with the current raw sources and release the
              campaign.
            </p>
          )}
          {data && histogramIssues.length === 0 && !campaignBusy && (
            <p className="mt-1 text-xs text-muted-foreground">
              Raw source totals match the persisted daily histogram and no stale
              buckets were found.
            </p>
          )}

          {campaignBusy && campaign && (
            <div className="mt-3 max-w-2xl space-y-1.5">
              <Progress value={completedPercent} className="h-2" />
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                <span>{completedPercent}% complete</span>
                <span>{campaign.completed}/{campaign.plannedJobs} batches</span>
                <span>{campaign.active} active</span>
                <span>{campaign.waiting + campaign.delayed} queued</span>
                {campaign.failed > 0 && (
                  <span className="text-red-500">{campaign.failed} failed</span>
                )}
                {campaign.missingJobs > 0 && (
                  <span>{campaign.missingJobs} not queued yet</span>
                )}
              </div>
            </div>
          )}

          {data?.lastBookkeepingRepair && (
            <p className="mt-2 text-[11px] text-muted-foreground">
              Last marker repair applied {formatCount(
                data.lastBookkeepingRepair.modifiedChunks,
              )} change(s); verified {formatCount(
                data.lastBookkeepingRepair.terminalSequences,
              )} terminal sequences.
            </p>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap gap-2">
          <Button
            variant={verificationRequired ? "outline" : "ghost"}
            size="sm"
            onClick={() => refreshMutation.mutate()}
            disabled={isFetching || refreshMutation.isPending ||
              data?.snapshot?.state === "refreshing"}
            title={verificationRequired
              ? "Run exact Timeline verification"
              : "Refresh timeline integrity status"}
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${
                isFetching || refreshMutation.isPending ||
                  data?.snapshot?.state === "refreshing"
                  ? "animate-spin"
                  : ""
              }`}
            />
            {verificationRequired && (
              <span className="ml-2">Run exact verification</span>
            )}
          </Button>
          <Button
            asChild
            variant={data?.status === "needs_attention" ? "default" : "outline"}
            size="sm"
          >
            <Link to="/jobs?timelineAudit=1#timeline-integrity">
              {campaignBusy ? "Open progress" : "Recovery controls"}
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
