import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { format, formatDistanceToNow } from "date-fns";
import {
  CalendarRange,
  CheckCircle2,
  Clock3,
  ExternalLink,
  FileText,
  RefreshCw,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Markdown } from "@/components/Markdown";
import {
  buildSummaryHistoryPipeline,
  normalizeSummaryHistoryResult,
  type SummaryHistoryEntry,
} from "@/lib/summaryHistory";

function formatDateTime(value?: string | Date): string {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return format(date, "MMM d, yyyy · HH:mm:ss");
}

function formatCoverage(entry: SummaryHistoryEntry): string {
  if (!entry.coverageStart) return "No source time range";
  const start = new Date(entry.coverageStart);
  const end = entry.coverageEnd ? new Date(entry.coverageEnd) : undefined;
  if (Number.isNaN(start.getTime())) return "No source time range";

  const startText = format(start, "MMM d, yyyy · HH:mm");
  if (!end || Number.isNaN(end.getTime())) return startText;
  const endText = start.toDateString() === end.toDateString()
    ? format(end, "HH:mm")
    : format(end, "MMM d, yyyy · HH:mm");
  return `${startText} – ${endText}`;
}

function formatTokens(value?: number): string {
  return typeof value === "number" ? value.toLocaleString() : "—";
}

function SummaryHistoryCard({ entry }: { entry: SummaryHistoryEntry }) {
  const generatedAt = new Date(entry.generatedAt);
  const requestedDiffers = entry.requestedModel &&
    entry.requestedModel !== entry.executedModel;

  return (
    <Card className="overflow-hidden">
      <div className="space-y-4 p-5">
        <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-start">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <Link
                to={`/objects/${entry.objectId}`}
                className="text-lg font-semibold hover:text-primary hover:underline"
              >
                {entry.objectName}
              </Link>
              <Badge variant="outline" className="gap-1">
                <CheckCircle2 className="h-3 w-3" />
                Summary saved
              </Badge>
              {entry.jobState && entry.jobState !== "completed" && (
                <Badge variant="secondary">Job record: {entry.jobState}</Badge>
              )}
              {entry.fallbackUsed && (
                <Badge variant="destructive">Fallback used</Badge>
              )}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Clock3 className="h-3.5 w-3.5" />
                Generated {formatDateTime(entry.generatedAt)}
              </span>
              {!Number.isNaN(generatedAt.getTime()) && (
                <span>
                  {formatDistanceToNow(generatedAt, { addSuffix: true })}
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link to={`/objects/${entry.objectId}`}>
                Open conversation
                <ExternalLink className="ml-1 h-3.5 w-3.5" />
              </Link>
            </Button>
            {entry.jobId && (
              <Button variant="outline" size="sm" asChild>
                <Link to={`/jobs/${entry.jobId}`}>Open job</Link>
              </Button>
            )}
          </div>
        </div>

        <div className="grid gap-3 rounded-lg bg-muted/40 p-4 md:grid-cols-2 xl:grid-cols-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Executed model
            </p>
            <p className="mt-1 break-all font-mono text-xs">
              {entry.executedModel || "Unknown"}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Requested model
            </p>
            <p className="mt-1 break-all font-mono text-xs">
              {entry.requestedModel || "Unknown"}
            </p>
            {requestedDiffers && !entry.fallbackUsed && (
              <p className="mt-1 text-xs text-muted-foreground">
                Alias or legacy override resolved to the executed model.
              </p>
            )}
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Failure policy
            </p>
            <p className="mt-1 break-all text-xs">
              {entry.fallbackModel
                ? `Retry once with ${entry.fallbackModel}`
                : "Stop with error"}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Source time
            </p>
            <p className="mt-1 text-xs">{formatCoverage(entry)}</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
          <span>Prompt: {entry.promptName || "Default"}</span>
          <span>Prompt tokens: {formatTokens(entry.usage?.promptTokens)}</span>
          <span>
            Completion tokens: {formatTokens(entry.usage?.completionTokens)}
          </span>
          <span>Total tokens: {formatTokens(entry.usage?.totalTokens)}</span>
          {typeof entry.usage?.cost === "number" && (
            <span>Cost: ${entry.usage.cost.toFixed(6)}</span>
          )}
        </div>

        <details className="group rounded-lg border">
          <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium hover:bg-muted/40">
            <span className="group-open:hidden">View summary</span>
            <span className="hidden group-open:inline">Hide summary</span>
          </summary>
          <div className="border-t px-4 py-4">
            <div className="prose prose-sm max-w-none dark:prose-invert">
              <Markdown>{entry.text}</Markdown>
            </div>
          </div>
        </details>
      </div>
    </Card>
  );
}

export default function SummaryHistoryPage() {
  const [model, setModel] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [limit, setLimit] = useState("100");

  const query = useQuery({
    queryKey: ["summary-history", model, from, to, limit],
    queryFn: async () => {
      const result = await api.callResource("mongo", {
        action: "aggregate",
        collection: "objects",
        pipeline: buildSummaryHistoryPipeline({
          model,
          from: from || undefined,
          to: to || undefined,
          limit: Number(limit),
        }),
      });
      return normalizeSummaryHistoryResult(result);
    },
  });

  const data = query.data ?? { entries: [], models: [], total: 0 };
  const latestAt = useMemo(
    () => data.entries[0]?.generatedAt,
    [data.entries],
  );

  const resetFilters = () => {
    setModel("all");
    setFrom("");
    setTo("");
    setLimit("100");
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-3 md:flex-row md:items-start">
        <div>
          <div className="flex items-center gap-2">
            <Sparkles className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-semibold">Summary history</h1>
          </div>
          <p className="mt-1 text-muted-foreground">
            See what was summarized, when it was generated, which model actually
            ran, and whether fallback was used.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => query.refetch()}
          disabled={query.isFetching}
        >
          <RefreshCw
            className={`mr-2 h-4 w-4 ${query.isFetching ? "animate-spin" : ""}`}
          />
          Refresh
        </Button>
      </div>

      <Card className="p-5">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <div className="space-y-2 xl:col-span-2">
            <Label>Executed model</Label>
            <Select value={model} onValueChange={setModel}>
              <SelectTrigger>
                <SelectValue placeholder="All models" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All models</SelectItem>
                {data.models.map((item) => (
                  <SelectItem key={item.model} value={item.model}>
                    {item.model} ({item.count})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="summary-from">Generated from</Label>
            <Input
              id="summary-from"
              type="date"
              value={from}
              max={to || undefined}
              onChange={(event) => setFrom(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="summary-to">Generated to</Label>
            <Input
              id="summary-to"
              type="date"
              value={to}
              min={from || undefined}
              onChange={(event) => setTo(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Results</Label>
            <Select value={limit} onValueChange={setLimit}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="25">Latest 25</SelectItem>
                <SelectItem value="50">Latest 50</SelectItem>
                <SelectItem value="100">Latest 100</SelectItem>
                <SelectItem value="250">Latest 250</SelectItem>
                <SelectItem value="500">Latest 500</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="mt-4 flex justify-end">
          <Button variant="ghost" size="sm" onClick={resetFilters}>
            <RotateCcw className="mr-2 h-4 w-4" />
            Reset filters
          </Button>
        </div>
      </Card>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-sm text-muted-foreground">Matching summaries</p>
          <p className="mt-1 text-2xl font-semibold">
            {data.total.toLocaleString()}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-muted-foreground">
            Executed models in history
          </p>
          <p className="mt-1 text-2xl font-semibold">{data.models.length}</p>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-muted-foreground">Most recent summary</p>
          <p className="mt-1 text-sm font-medium">
            {latestAt ? formatDateTime(latestAt) : "None"}
          </p>
        </Card>
      </div>

      {query.isLoading && (
        <Card className="p-10 text-center text-muted-foreground">
          Loading summary history…
        </Card>
      )}

      {query.isError && (
        <Card className="border-destructive p-6 text-destructive">
          Failed to load summary history:{" "}
          {query.error instanceof Error ? query.error.message : "Unknown error"}
        </Card>
      )}

      {!query.isLoading && !query.isError && data.entries.length === 0 && (
        <Card className="p-10 text-center">
          <FileText className="mx-auto h-10 w-10 text-muted-foreground" />
          <h2 className="mt-3 font-semibold">
            No summaries match these filters
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Change the model or generated-date range.
          </p>
        </Card>
      )}

      <div className="space-y-4">
        {data.entries.map((entry) => (
          <SummaryHistoryCard key={entry.id} entry={entry} />
        ))}
      </div>

      {data.total > data.entries.length && (
        <Card className="flex items-center justify-between gap-3 p-4 text-sm">
          <span className="text-muted-foreground">
            Showing {data.entries.length} of {data.total} matching summaries.
          </span>
          <div className="flex items-center gap-2">
            <CalendarRange className="h-4 w-4 text-muted-foreground" />
            Increase “Results” or narrow the date range.
          </div>
        </Card>
      )}
    </div>
  );
}
