import { useQuery } from "@tanstack/react-query";
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
      const status = (query.state.data as TimelineIntegrityReport | undefined)
        ?.campaign?.status;
      return status === "queued" || status === "running" ? 10_000 : 60_000;
    },
  });

  const campaign = data?.campaign;
  const campaignBusy = campaign?.status === "queued" ||
    campaign?.status === "running";
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
              : data?.status === "needs_attention"
              ? <AlertTriangle className="h-4 w-4 text-amber-500" />
              : <CheckCircle2 className="h-4 w-4 text-green-500" />}
            <span className="text-sm font-medium">Timeline processing</span>
            <Badge variant="secondary" className="text-[11px]">
              {campaignBusy
                ? "rebuild running"
                : data?.status === "needs_attention"
                ? "action required"
                : data
                ? "audit passed"
                : "checking"}
            </Badge>
          </div>

          {!data && !error && (
            <p className="mt-1 text-xs text-muted-foreground">
              Checking raw data, persisted histograms, and recovery jobs…
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
            variant="ghost"
            size="sm"
            onClick={() => void refetch()}
            disabled={isFetching}
            title="Refresh timeline integrity status"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`}
            />
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
