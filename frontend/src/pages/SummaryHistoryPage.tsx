import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { format, formatDistanceToNow, subDays } from "date-fns";
import {
  AlertTriangle,
  Ban,
  CalendarRange,
  CheckCircle2,
  CircleDashed,
  Clock3,
  Cpu,
  ExternalLink,
  FileText,
  ListChecks,
  RefreshCw,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { DateRangePicker } from "@/components/DateRangePicker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Markdown } from "@/components/Markdown";
import { ModelSelector } from "@/components/ModelSelector";
import {
  buildSummaryHistoryPipeline,
  buildSummaryTaskPipeline,
  normalizeSummaryHistoryResult,
  normalizeSummaryTaskResult,
  type SummaryHistoryEntry,
  type SummaryTaskEntry,
  type SummaryTaskStatus,
} from "@/lib/summaryHistory";
import {
  emptyModelArtifactResult,
  type ModelArtifactEntry,
  modelArtifactLabel,
  type ModelArtifactType,
  normalizeModelArtifactResult,
} from "@/lib/modelArtifacts";
import { useActionDialog } from "@/components/ActionDialogProvider";
import { useSettingsStore } from "@/stores/settingsStore";
import { resolveDefaultTimeZone } from "@/lib/timeZones";
import { zonedDateKey, zonedDateKeyToDate } from "@/lib/datePicker";

type HistoryView = "summaries" | "tasks" | "models";
type DatePreset = "all" | "7d" | "30d" | "custom";

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
  const sourceRefs = entry.sourceRefs;
  const sourceStart = sourceRefs
    ? new Date(sourceRefs.coverageStart).getTime()
    : NaN;
  const sourceEnd = sourceRefs
    ? new Date(sourceRefs.coverageEnd).getTime()
    : NaN;
  const transcriptHref =
    Number.isFinite(sourceStart) && Number.isFinite(sourceEnd)
      ? `/transcript?start=${sourceStart}&end=${sourceEnd}`
      : undefined;

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
                {entry.objectEmoji && (
                  <span className="mr-1">{entry.objectEmoji}</span>
                )}
                {entry.objectName}
              </Link>
              <Badge variant="outline" className="gap-1">
                <CheckCircle2 className="h-3 w-3" />
                Summary saved
              </Badge>
              {entry.jobState === "failed" && (
                <Badge variant="destructive">
                  Batch job failed after this summary was saved
                </Badge>
              )}
              {entry.jobState === "cancelled" && (
                <Badge variant="secondary">
                  Batch job was cancelled after this summary was saved
                </Badge>
              )}
              {entry.jobState && ![
                "completed",
                "failed",
                "cancelled",
              ].includes(entry.jobState) && (
                <Badge variant="secondary">
                  Batch job record: {entry.jobState}
                </Badge>
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

        <div className="rounded-lg border p-3 text-xs">
          {sourceRefs
            ? (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-3">
                  <Badge variant="secondary">Exact summary source</Badge>
                  <span>
                    {sourceRefs.conversationChunkIds.length}{" "}
                    conversation chunk(s)
                  </span>
                  <span>
                    {sourceRefs.transcriptionIds.length} transcription(s)
                  </span>
                  {transcriptHref && (
                    <Link
                      className="font-medium hover:underline"
                      to={transcriptHref}
                    >
                      Open source transcript
                    </Link>
                  )}
                  {sourceRefs.extractorJobId && (
                    <Link
                      className="font-medium hover:underline"
                      to={`/jobs/${sourceRefs.extractorJobId}`}
                    >
                      Open extraction job
                    </Link>
                  )}
                </div>
                {sourceRefs.conversationChunkIds.length > 0 && (
                  <div className="break-all font-mono text-muted-foreground">
                    Chunk: {sourceRefs.conversationChunkIds.join(", ")}
                  </div>
                )}
                <details>
                  <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                    Show transcription IDs
                  </summary>
                  <div className="mt-2 break-all font-mono text-muted-foreground">
                    {sourceRefs.transcriptionIds.join(", ") ||
                      "No transcription IDs recorded"}
                  </div>
                </details>
              </div>
            )
            : (
              <div className="text-muted-foreground">
                Legacy summary: exact source chunk and transcription IDs were
                not recorded when this version was generated.
              </div>
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

function taskStateLabel(state: string): string {
  switch (state) {
    case "completed":
      return "Finished successfully";
    case "active":
      return "Running";
    case "waiting":
      return "Waiting";
    case "delayed":
      return "Delayed";
    case "paused":
      return "Paused";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
    default:
      return state || "Unknown";
  }
}

function taskStateVariant(state: string) {
  if (state === "failed") return "destructive" as const;
  if (state === "completed") return "outline" as const;
  return "secondary" as const;
}

function SummaryTaskCard({ task }: { task: SummaryTaskEntry }) {
  const createdAt = new Date(task.createdAt);
  const progress = task.progress ?? {};
  const result = task.result ?? {};
  const processed = typeof progress.processed === "number"
    ? progress.processed
    : typeof result.processed === "number"
    ? result.processed
    : undefined;
  const total = typeof progress.total === "number"
    ? progress.total
    : typeof result.total === "number"
    ? result.total
    : undefined;

  return (
    <Card className="p-5">
      <div className="flex flex-col justify-between gap-3 md:flex-row md:items-start">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={taskStateVariant(task.state)}>
              {taskStateLabel(task.state)}
            </Badge>
            <span className="font-mono text-xs text-muted-foreground">
              {task.id}
            </span>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>Created {formatDateTime(task.createdAt)}</span>
            {!Number.isNaN(createdAt.getTime()) && (
              <span>{formatDistanceToNow(createdAt, { addSuffix: true })}</span>
            )}
            {task.startedAt && (
              <span>Started {formatDateTime(task.startedAt)}</span>
            )}
            {task.finishedAt && (
              <span>Finished {formatDateTime(task.finishedAt)}</span>
            )}
          </div>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link to={`/jobs/${task.id}`}>Open job</Link>
        </Button>
      </div>

      <div className="mt-4 grid gap-3 rounded-lg bg-muted/40 p-4 md:grid-cols-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Requested model
          </p>
          <p className="mt-1 break-all font-mono text-xs">
            {task.requestedModel}
          </p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Failure policy
          </p>
          <p className="mt-1 break-all text-xs">
            {task.fallbackModel
              ? `Retry once with ${task.fallbackModel}`
              : "Stop with error"}
          </p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Progress
          </p>
          <p className="mt-1 text-xs">
            {processed !== undefined
              ? `${processed}${total !== undefined ? ` / ${total}` : ""}`
              : "No progress reported"}
          </p>
        </div>
      </div>

      {task.failedReason && (
        <details className="mt-4 rounded-lg border border-destructive/40 bg-destructive/5">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-destructive">
            Show failure details
          </summary>
          <pre className="overflow-x-auto whitespace-pre-wrap break-words border-t border-destructive/30 px-4 py-3 text-xs text-destructive">
            {task.failedReason}
          </pre>
        </details>
      )}
    </Card>
  );
}

function ModelArtifactCard({ entry }: { entry: ModelArtifactEntry }) {
  const requestedDiffers = entry.requestedModel && entry.executedModel &&
    entry.requestedModel !== entry.executedModel;
  return (
    <Card className="p-5">
      <div className="flex flex-col justify-between gap-3 md:flex-row md:items-start">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">
              {modelArtifactLabel(entry.artifactType)}
            </Badge>
            <Badge
              variant={entry.provenanceQuality === "exact"
                ? "secondary"
                : "outline"}
            >
              {entry.provenanceQuality === "exact"
                ? "Exact route recorded"
                : "Legacy provenance"}
            </Badge>
            {entry.fallbackUsed && (
              <Badge variant="destructive">Fallback used</Badge>
            )}
            {entry.parseStatus === "parse_error" && (
              <Badge variant="destructive">Output parse failed</Badge>
            )}
          </div>
          <Link
            to={`/objects/${entry.objectId}`}
            className="block truncate font-semibold hover:text-primary hover:underline"
          >
            {entry.objectName}
          </Link>
          <p className="text-xs text-muted-foreground">
            {formatDateTime(entry.generatedAt)}
          </p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link to={`/objects/${entry.objectId}`}>Open object</Link>
        </Button>
      </div>

      <div className="mt-4 grid gap-3 rounded-lg bg-muted/40 p-4 md:grid-cols-3">
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
            Requested route
          </p>
          <p className="mt-1 break-all font-mono text-xs">
            {entry.requestedModel || "Unknown"}
            {requestedDiffers ? " -> resolved above" : ""}
          </p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Provider / result
          </p>
          <p className="mt-1 break-all text-xs">
            {entry.providerProfileName && (
              <span className="font-medium">{entry.providerProfileName} ·</span>
            )}
            {entry.providerBaseUrl ||
              (entry.provenanceQuality === "exact"
                ? "Provider route was not returned"
                : "Unavailable for legacy output")}
          </p>
          {entry.artifactType === "tagging" && (
            <p className="mt-1 text-xs text-muted-foreground">
              {entry.selectedTagCount ?? 0} tag(s) selected; parser{" "}
              {entry.parseStatus || "unknown"}
            </p>
          )}
        </div>
      </div>

      {(entry.jobId || entry.chunkId) && (
        <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
          {entry.jobId && (
            <Link className="hover:underline" to={`/jobs/${entry.jobId}`}>
              Job {entry.jobId}
            </Link>
          )}
          {entry.chunkId && <span>Source chunk {entry.chunkId}</span>}
        </div>
      )}
    </Card>
  );
}

export default function SummaryHistoryPage() {
  const { confirmAction } = useActionDialog();
  const defaultTimeZone = useSettingsStore((state) => state.defaultTimeZone);
  const pickerTimeZone = resolveDefaultTimeZone(defaultTimeZone);
  const [view, setView] = useState<HistoryView>("summaries");
  const [taskStatus, setTaskStatus] = useState<SummaryTaskStatus>("all");
  const [artifactType, setArtifactType] = useState<ModelArtifactType | "all">(
    "all",
  );
  const [model, setModel] = useState("all");
  const [datePreset, setDatePreset] = useState<DatePreset>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [limit, setLimit] = useState("100");
  const [rerunTargetModel, setRerunTargetModel] = useState("");
  // Set when the target model was picked from a specific provider's group;
  // rerun jobs then route to that provider only.
  const [rerunTargetProviderId, setRerunTargetProviderId] = useState<
    string | undefined
  >(undefined);
  const [rerunPending, setRerunPending] = useState(false);
  const [rerunResult, setRerunResult] = useState<string | null>(null);

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
    enabled: view === "summaries",
  });

  const taskQuery = useQuery({
    queryKey: ["summary-task-history", taskStatus, model, from, to, limit],
    queryFn: async () => {
      const result = await api.callResource("mongo", {
        action: "aggregate",
        collection: "jobs",
        pipeline: buildSummaryTaskPipeline({
          status: taskStatus,
          model,
          from: from || undefined,
          to: to || undefined,
          limit: Number(limit),
        }),
      });
      return normalizeSummaryTaskResult(result);
    },
    enabled: view === "tasks",
  });

  const modelArtifactQuery = useQuery({
    queryKey: ["model-artifacts", artifactType, model, from, to, limit],
    queryFn: async () => {
      const result = await api.callResource("jobs", {
        action: "model_artifacts",
        model,
        limit: Number(limit),
        ...(artifactType === "all" ? {} : { artifactTypes: [artifactType] }),
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
      });
      return normalizeModelArtifactResult(result);
    },
    enabled: view === "models",
  });

  const data = query.data ?? { entries: [], models: [], total: 0 };
  const taskData = taskQuery.data ?? {
    entries: [],
    models: [],
    counts: {
      total: 0,
      completed: 0,
      unfinished: 0,
      failed: 0,
      cancelled: 0,
    },
  };
  const artifactData = modelArtifactQuery.data ?? emptyModelArtifactResult;
  const availableModels = view === "summaries"
    ? data.models
    : view === "tasks"
    ? taskData.models
    : artifactData.models;
  const latestAt = useMemo(
    () => data.entries[0]?.generatedAt,
    [data.entries],
  );

  const applyDatePreset = (preset: DatePreset) => {
    setDatePreset(preset);
    if (preset === "all") {
      setFrom("");
      setTo("");
      return;
    }
    if (preset === "custom") {
      if (!from || !to) {
        const today = new Date();
        setFrom(zonedDateKey(subDays(today, 6), pickerTimeZone));
        setTo(zonedDateKey(today, pickerTimeZone));
      }
      return;
    }

    const today = new Date();
    const days = preset === "7d" ? 7 : 30;
    setFrom(format(subDays(today, days - 1), "yyyy-MM-dd"));
    setTo(format(today, "yyyy-MM-dd"));
  };

  const changeView = (nextView: HistoryView) => {
    setView(nextView);
    setModel("all");
    setTaskStatus("all");
    setArtifactType("all");
    setRerunTargetModel("");
    setRerunResult(null);
  };

  const resetFilters = () => {
    setTaskStatus("all");
    setArtifactType("all");
    setModel("all");
    setDatePreset("all");
    setFrom("");
    setTo("");
    setLimit("100");
  };

  const refreshCurrentView = () => {
    if (view === "summaries") return query.refetch();
    if (view === "tasks") return taskQuery.refetch();
    return modelArtifactQuery.refetch();
  };

  const currentViewFetching = view === "summaries"
    ? query.isFetching
    : view === "tasks"
    ? taskQuery.isFetching
    : modelArtifactQuery.isFetching;

  const rerunSummaries = async () => {
    if (model === "all" || !rerunTargetModel) return;
    if (model === rerunTargetModel) {
      setRerunResult("Choose a target model different from the source model.");
      return;
    }
    const accepted = await confirmAction({
      title: "Append new summary versions?",
      description: `Create versions for up to ${
        Math.min(Number(limit), 100)
      } conversations summarized by ${model}, using ${rerunTargetModel}. Existing summaries will be kept.`,
      actionLabel: "Queue reruns",
    });
    if (!accepted) return;

    setRerunPending(true);
    setRerunResult(null);
    try {
      const result = await api.callResource("jobs", {
        action: "reprocess_model_artifacts",
        artifactType: "summary",
        sourceModel: model,
        targetModel: rerunTargetModel,
        // Omit rather than pass undefined: EJSON turns undefined into null.
        ...(rerunTargetProviderId
          ? { targetProviderProfileId: rerunTargetProviderId }
          : {}),
        limit: Math.min(Number(limit), 100),
      }) as {
        queued?: Array<unknown>;
        skippedAlreadyQueued?: number;
      };
      setRerunResult(
        `Queued ${result.queued?.length ?? 0} summary rerun(s); ${
          result.skippedAlreadyQueued ?? 0
        } already queued. Originals remain available for comparison.`,
      );
      await Promise.all([modelArtifactQuery.refetch(), taskQuery.refetch()]);
    } catch (error) {
      setRerunResult(
        error instanceof Error ? error.message : "Failed to queue reruns",
      );
    } finally {
      setRerunPending(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-3 md:flex-row md:items-start">
        <div>
          <div className="flex items-center gap-2">
            <Sparkles className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-semibold">AI output history</h1>
          </div>
          <p className="mt-1 text-muted-foreground">
            Audit summaries, conversation extraction, and tagging by the model
            that actually produced each saved result.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={refreshCurrentView}
          disabled={currentViewFetching}
        >
          <RefreshCw
            className={`mr-2 h-4 w-4 ${
              currentViewFetching ? "animate-spin" : ""
            }`}
          />
          Refresh
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Button
          variant={view === "summaries" ? "default" : "outline"}
          className="h-auto justify-start p-4 text-left"
          onClick={() => changeView("summaries")}
        >
          <FileText className="mr-3 h-5 w-5" />
          <span>
            <span className="block font-medium">Saved summaries</span>
            <span className="block text-xs opacity-75">
              Browse generated text by executed model and generation date.
            </span>
          </span>
        </Button>
        <Button
          variant={view === "tasks" ? "default" : "outline"}
          className="h-auto justify-start p-4 text-left"
          onClick={() => changeView("tasks")}
        >
          <ListChecks className="mr-3 h-5 w-5" />
          <span>
            <span className="block font-medium">Task activity</span>
            <span className="block text-xs opacity-75">
              See successful, unfinished, failed, and cancelled jobs.
            </span>
          </span>
        </Button>
        <Button
          variant={view === "models" ? "default" : "outline"}
          className="h-auto justify-start p-4 text-left"
          onClick={() => changeView("models")}
        >
          <Cpu className="mr-3 h-5 w-5" />
          <span>
            <span className="block font-medium">All model outputs</span>
            <span className="block text-xs opacity-75">
              Find saved results by executed model and provenance quality.
            </span>
          </span>
        </Button>
      </div>

      <Card className="p-5">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
          {view === "tasks" && (
            <div className="space-y-2">
              <Label>Task status</Label>
              <Select
                value={taskStatus}
                onValueChange={(value) =>
                  setTaskStatus(value as SummaryTaskStatus)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All task states</SelectItem>
                  <SelectItem value="completed">
                    Finished successfully
                  </SelectItem>
                  <SelectItem value="unfinished">Unfinished</SelectItem>
                  <SelectItem value="failed">Failed</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          {view === "models" && (
            <div className="space-y-2">
              <Label>Output type</Label>
              <Select
                value={artifactType}
                onValueChange={(value) =>
                  setArtifactType(value as ModelArtifactType | "all")}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All AI outputs</SelectItem>
                  <SelectItem value="summary">Summaries</SelectItem>
                  <SelectItem value="conversation_extraction">
                    Conversation extraction
                  </SelectItem>
                  <SelectItem value="tagging">Tagging</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-2 xl:col-span-2">
            <Label>
              {view === "tasks" ? "Requested model" : "Executed model"}
            </Label>
            <Select value={model} onValueChange={setModel}>
              <SelectTrigger>
                <SelectValue placeholder="All models" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All models</SelectItem>
                {availableModels.map((item) => (
                  <SelectItem key={item.model} value={item.model}>
                    {item.model} ({item.count})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Date range (optional)</Label>
            <Select
              value={datePreset}
              onValueChange={(value) => applyDatePreset(value as DatePreset)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any date</SelectItem>
                <SelectItem value="7d">Last 7 days</SelectItem>
                <SelectItem value="30d">Last 30 days</SelectItem>
                <SelectItem value="custom">Custom range</SelectItem>
              </SelectContent>
            </Select>
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
        {datePreset === "custom" && (
          <div className="mt-4 rounded-lg border bg-muted/20 p-4">
            <DateRangePicker
              label={view === "tasks" ? "Created range" : "Generated range"}
              value={{
                start: zonedDateKeyToDate(from, pickerTimeZone) ??
                  subDays(new Date(), 6),
                end: zonedDateKeyToDate(to, pickerTimeZone) ?? new Date(),
              }}
              onChange={(value) => {
                setFrom(zonedDateKey(value.start, pickerTimeZone));
                if (value.end) setTo(zonedDateKey(value.end, pickerTimeZone));
              }}
              precision="date"
              timeZone={pickerTimeZone}
            />
          </div>
        )}
        <div className="mt-4 flex justify-end">
          <Button variant="ghost" size="sm" onClick={resetFilters}>
            <RotateCcw className="mr-2 h-4 w-4" />
            Reset filters
          </Button>
        </div>
      </Card>

      {view === "summaries"
        ? (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              <Card className="p-4">
                <p className="text-sm text-muted-foreground">Saved summaries</p>
                <p className="mt-1 text-2xl font-semibold">
                  {data.total.toLocaleString()}
                </p>
              </Card>
              <Card className="p-4">
                <p className="text-sm text-muted-foreground">
                  Executed models in history
                </p>
                <p className="mt-1 text-2xl font-semibold">
                  {data.models.length}
                </p>
              </Card>
              <Card className="p-4">
                <p className="text-sm text-muted-foreground">
                  Most recent summary
                </p>
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
                Failed to load summary history: {query.error instanceof Error
                  ? query.error.message
                  : "Unknown error"}
              </Card>
            )}
            {!query.isLoading && !query.isError && data.entries.length === 0 &&
              (
                <Card className="p-10 text-center">
                  <FileText className="mx-auto h-10 w-10 text-muted-foreground" />
                  <h2 className="mt-3 font-semibold">
                    No saved summaries match
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Change the model or optional generation-date range.
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
                  Showing {data.entries.length} of {data.total} saved summaries.
                </span>
                <div className="flex items-center gap-2">
                  <CalendarRange className="h-4 w-4 text-muted-foreground" />
                  Increase “Results” or narrow the optional date range.
                </div>
              </Card>
            )}
          </>
        )
        : view === "tasks"
        ? (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              <Card className="p-4">
                <p className="text-sm text-muted-foreground">All tasks</p>
                <p className="mt-1 text-2xl font-semibold">
                  {taskData.counts.total.toLocaleString()}
                </p>
              </Card>
              <Card className="p-4">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                <p className="mt-2 text-sm text-muted-foreground">Successful</p>
                <p className="mt-1 text-2xl font-semibold">
                  {taskData.counts.completed.toLocaleString()}
                </p>
              </Card>
              <Card className="p-4">
                <CircleDashed className="h-4 w-4 text-amber-500" />
                <p className="mt-2 text-sm text-muted-foreground">Unfinished</p>
                <p className="mt-1 text-2xl font-semibold">
                  {taskData.counts.unfinished.toLocaleString()}
                </p>
              </Card>
              <Card className="p-4">
                <AlertTriangle className="h-4 w-4 text-destructive" />
                <p className="mt-2 text-sm text-muted-foreground">Failed</p>
                <p className="mt-1 text-2xl font-semibold">
                  {taskData.counts.failed.toLocaleString()}
                </p>
              </Card>
              <Card className="p-4">
                <Ban className="h-4 w-4 text-muted-foreground" />
                <p className="mt-2 text-sm text-muted-foreground">Cancelled</p>
                <p className="mt-1 text-2xl font-semibold">
                  {taskData.counts.cancelled.toLocaleString()}
                </p>
              </Card>
            </div>

            {taskQuery.isLoading && (
              <Card className="p-10 text-center text-muted-foreground">
                Loading summarization tasks…
              </Card>
            )}
            {taskQuery.isError && (
              <Card className="border-destructive p-6 text-destructive">
                Failed to load task activity: {taskQuery.error instanceof Error
                  ? taskQuery.error.message
                  : "Unknown error"}
              </Card>
            )}
            {!taskQuery.isLoading && !taskQuery.isError &&
              taskData.entries.length === 0 && (
              <Card className="p-10 text-center">
                <ListChecks className="mx-auto h-10 w-10 text-muted-foreground" />
                <h2 className="mt-3 font-semibold">
                  No tasks match these filters
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Change the task state, model, or optional creation-date range.
                </p>
              </Card>
            )}
            <div className="space-y-4">
              {taskData.entries.map((task) => (
                <SummaryTaskCard key={task.id} task={task} />
              ))}
            </div>
          </>
        )
        : (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Card className="p-4">
                <p className="text-sm text-muted-foreground">
                  Matching AI outputs
                </p>
                <p className="mt-1 text-2xl font-semibold">
                  {artifactData.total.toLocaleString()}
                </p>
              </Card>
              <Card className="p-4">
                <p className="text-sm text-muted-foreground">
                  Executed models
                </p>
                <p className="mt-1 text-2xl font-semibold">
                  {artifactData.models.length}
                </p>
              </Card>
              <Card className="p-4">
                <p className="text-sm text-muted-foreground">
                  Legacy summaries without exact route
                </p>
                <p className="mt-1 text-2xl font-semibold">
                  {artifactData.gaps.legacySummariesWithoutExactRouting
                    .toLocaleString()}
                </p>
              </Card>
              <Card className="p-4">
                <p className="text-sm text-muted-foreground">
                  Legacy extraction / tag gaps
                </p>
                <p className="mt-1 text-2xl font-semibold">
                  {(artifactData.gaps.legacyExtractionsWithRequestedAliasOnly +
                    artifactData.gaps.legacyTagRelationshipsWithoutProvenance)
                    .toLocaleString()}
                </p>
              </Card>
            </div>

            <Card className="border-amber-200 bg-amber-50/50 p-5">
              <div className="flex gap-3">
                <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-700" />
                <div className="space-y-1 text-sm">
                  <p className="font-medium text-amber-900">
                    Historical confidence is explicit
                  </p>
                  <p className="text-amber-800">
                    Older summaries usually retain the provider response model.
                    Older conversation extraction stores aliases such as small
                    or medium, so the exact executed model cannot be
                    reconstructed. Existing tag relationships have no model
                    provenance. New runs record the exact route, provider,
                    fallback, job, and parser result.
                  </p>
                </div>
              </div>
            </Card>

            {(artifactType === "all" || artifactType === "summary") &&
              model !== "all" && (
              <Card className="p-5">
                <div className="grid gap-4 lg:grid-cols-[1fr_1fr_auto] lg:items-end">
                  <div>
                    <p className="font-medium">Quality rerun for summaries</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Source:{" "}
                      <span className="font-mono">{model}</span>. A rerun
                      appends a new summary version; the original is never
                      deleted.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label>Stronger target model</Label>
                    <ModelSelector
                      value={rerunTargetModel}
                      onChange={setRerunTargetModel}
                      providerValue={rerunTargetProviderId}
                      onSelectWithProvider={(_model, providerProfileId) =>
                        setRerunTargetProviderId(providerProfileId)}
                      placeholder="Choose target model"
                      prefetch
                    />
                  </div>
                  <Button
                    onClick={rerunSummaries}
                    disabled={rerunPending || !rerunTargetModel ||
                      rerunTargetModel === model}
                  >
                    {rerunPending ? "Queueing…" : "Append rerun summaries"}
                  </Button>
                </div>
                {rerunResult && (
                  <p className="mt-3 rounded-md bg-muted p-3 text-sm">
                    {rerunResult}
                  </p>
                )}
              </Card>
            )}

            {modelArtifactQuery.isLoading && (
              <Card className="p-10 text-center text-muted-foreground">
                Loading model-produced data…
              </Card>
            )}
            {modelArtifactQuery.isError && (
              <Card className="border-destructive p-6 text-destructive">
                Failed to load model outputs:{" "}
                {modelArtifactQuery.error instanceof Error
                  ? modelArtifactQuery.error.message
                  : "Unknown error"}
              </Card>
            )}
            {!modelArtifactQuery.isLoading && !modelArtifactQuery.isError &&
              artifactData.entries.length === 0 && (
              <Card className="p-10 text-center">
                <Cpu className="mx-auto h-10 w-10 text-muted-foreground" />
                <h2 className="mt-3 font-semibold">
                  No model outputs match these filters
                </h2>
              </Card>
            )}
            <div className="space-y-4">
              {artifactData.entries.map((entry) => (
                <ModelArtifactCard key={entry.id} entry={entry} />
              ))}
            </div>
          </>
        )}
    </div>
  );
}
