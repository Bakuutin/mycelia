import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import {
  getMaximumAudioHours,
  MAX_AUDIO_CHUNK_SECONDS,
  normalizeAudioSourceFileStats,
} from "@/lib/audioPipelineStats";
import { format, formatDistanceToNow } from "date-fns";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { EJSON } from "bson";
import { toast } from "sonner";
import {
  Activity,
  AlertCircle,
  AudioWaveform,
  CheckCircle2,
  ChevronRight,
  Clock,
  FileText,
  Gauge,
  Layers,
  MessageSquare,
  Mic,
  PauseCircle,
  RefreshCw,
  Timer,
  Trash2,
} from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

interface AudioSession {
  _id: string;
  start?: Date;
  lastActivityAt?: Date;
  path?: string;
  sourceKind: string;
  ingested: boolean;
  ingestionError?: string;
  client_id?: string;
  device?: string;
  metadata?: {
    format?: string;
    rate?: number;
    width?: number;
    channels?: number;
    source?: string;
    codec?: string;
  };
  processing_status?: string;
  chunks: {
    total: number;
    vadProcessed: number;
    withSpeech: number;
  };
  sequences: Array<{
    _id: string;
    state: string;
    chunk_count: number;
    fromIndex: number;
    toIndex: number;
    updatedAt?: Date;
    error?: string;
  }>;
  transcriptions: number;
  conversationChunks: Array<{
    _id: string;
    state: string;
    mode?: string;
    transcriptionCount: number;
    totalTextLength: number;
    start?: Date;
    end?: Date;
    updatedAt?: Date;
    error?: string;
    emptyReason?: string;
    segmentsFound?: number;
    conversationsCreated?: number;
  }>;
  transcriptionDetails: Array<{
    _id: string;
    start: Date;
    end: Date;
    text: string;
  }>;
  conversations: Array<{
    _id: string;
    name: string;
    icon?: { text?: string };
    timeRanges?: Array<{ start: string; end: string }>;
    createdAt?: Date;
  }>;
}

interface PipelineStats {
  totalSessions: number;
  totalChunks: number;
  chunksVadProcessed: number;
  chunksAwaitingVad: number;
  vadProcessedLast15Minutes: number;
  vadRatePerMinute: number;
  vadEtaSeconds?: number;
  vadLastProcessedAt?: Date;
  vadJobs: {
    active: number;
    waiting: number;
    delayed: number;
    completed: number;
    failed: number;
    cancelled: number;
    latestFailure?: string;
    latestFailureAt?: Date;
    recentFailures: Array<{
      id: string;
      failedAt?: Date;
      reason?: string;
    }>;
  };
  sequencesReady: number;
  sequencesProcessing: number;
  sequencesError: number;
  convChunksReady: number;
  convChunksProcessing: number;
  convChunksError: number;
  totalConversations: number;
  sourceFiles: {
    total: number;
    ingested: number;
    pending: number;
    errors: number;
    byKind: Array<{ kind: string; count: number }>;
  };
  stages: PipelineStage[];
  recentJobs: PipelineJob[];
}

interface PipelineStage {
  type: string;
  label: string;
  backlog: number;
  errors: number;
  paused: boolean;
  active: number;
  waiting: number;
  delayed: number;
  failed: number;
  latestJob?: {
    id: string;
    state: string;
    updatedAt?: Date;
    failedReason?: string;
  };
}

interface PipelineJob {
  id: string;
  type: string;
  state: string;
  createdAt?: Date;
  updatedAt?: Date;
  startedAt?: Date;
  finishedAt?: Date;
  failedReason?: string;
}

const DEFAULT_SESSION_LIMIT = 10;
const LOAD_MORE_INCREMENT = 10;

function formatEta(seconds?: number): string {
  if (!seconds || seconds <= 0) return "Unavailable";
  if (seconds < 60) return "Less than a minute";
  if (seconds < 3600) return `About ${Math.ceil(seconds / 60)} min`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.ceil((seconds % 3600) / 60);
  return `About ${hours}h${minutes ? ` ${minutes}m` : ""}`;
}

function stageState(stage: PipelineStage): {
  label: string;
  className: string;
} {
  if (stage.paused && stage.backlog > 0) {
    return { label: "Blocked · paused", className: "text-red-600" };
  }
  if (stage.active > 0) {
    return { label: `${stage.active} running`, className: "text-blue-600" };
  }
  const queued = stage.waiting + stage.delayed;
  if (queued > 0) {
    return { label: `${queued} queued`, className: "text-amber-600" };
  }
  if (stage.errors > 0) {
    return { label: `${stage.errors} errors`, className: "text-red-600" };
  }
  if (stage.backlog > 0) {
    return { label: "Waiting for worker", className: "text-amber-600" };
  }
  return { label: "Caught up", className: "text-green-600" };
}

function formatWorkerType(type: string): string {
  return type.replaceAll("_", " ");
}

export default function AudioPipelinePage() {
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [expandedSessions, setExpandedSessions] = useState<Set<string>>(
    new Set(),
  );
  const [sessionLimit, setSessionLimit] = useState(DEFAULT_SESSION_LIMIT);

  const {
    data: sessionsData,
    error: pipelineError,
    isError,
    isFetching,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ["audio-pipeline-sessions", sessionLimit],
    queryFn: async ({ signal }) => {
      // Use the new aggregated pipeline endpoint
      const requestController = new AbortController();
      const cancelRequest = () => requestController.abort(signal.reason);
      signal.addEventListener("abort", cancelRequest, { once: true });
      const timeoutId = setTimeout(
        () => requestController.abort(),
        20_000,
      );

      let response: Response;
      try {
        response = await fetch(
          `${api.baseURL}/api/audio/pipeline?limit=${sessionLimit}`,
          {
            headers: {
              "Authorization": `Bearer ${await api.getJWT()}`,
            },
            signal: requestController.signal,
          },
        );
      } catch (error) {
        if (requestController.signal.aborted && !signal.aborted) {
          throw new Error(
            "Pipeline statistics took longer than 20 seconds. Retry after the database finishes its current work.",
          );
        }
        throw error;
      } finally {
        clearTimeout(timeoutId);
        signal.removeEventListener("abort", cancelRequest);
      }

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(
          `Failed to fetch pipeline data (${response.status})${
            detail ? `: ${detail}` : ""
          }`,
        );
      }

      const data = await response.json();

      // Deserialize EJSON (handles BSON date format { $date: "..." })
      const deserialized = EJSON.deserialize(data);

      // Convert any remaining date strings to Date objects
      const sessions: AudioSession[] = deserialized.sessions.map((s: any) => ({
        ...s,
        start: s.start
          ? (s.start instanceof Date ? s.start : new Date(s.start))
          : undefined,
        lastActivityAt: s.lastActivityAt
          ? (s.lastActivityAt instanceof Date
            ? s.lastActivityAt
            : new Date(s.lastActivityAt))
          : undefined,
        sequences: s.sequences.map((seq: any) => ({
          ...seq,
          updatedAt: seq.updatedAt
            ? (seq.updatedAt instanceof Date
              ? seq.updatedAt
              : new Date(seq.updatedAt))
            : undefined,
        })),
        conversationChunks: s.conversationChunks.map((c: any) => ({
          ...c,
          start: c.start
            ? (c.start instanceof Date ? c.start : new Date(c.start))
            : undefined,
          end: c.end
            ? (c.end instanceof Date ? c.end : new Date(c.end))
            : undefined,
          updatedAt: c.updatedAt
            ? (c.updatedAt instanceof Date
              ? c.updatedAt
              : new Date(c.updatedAt))
            : undefined,
        })),
        transcriptionDetails: s.transcriptionDetails.map((t: any) => ({
          ...t,
          start: t.start instanceof Date ? t.start : new Date(t.start),
          end: t.end instanceof Date ? t.end : new Date(t.end),
        })),
        conversations: s.conversations.map((c: any) => ({
          ...c,
          createdAt: c.createdAt
            ? (c.createdAt instanceof Date
              ? c.createdAt
              : new Date(c.createdAt))
            : undefined,
        })),
      }));

      const rawStats = deserialized.stats as PipelineStats;
      const stats: PipelineStats = {
        ...rawStats,
        sourceFiles: normalizeAudioSourceFileStats(
          rawStats.sourceFiles,
          rawStats.totalSessions,
        ),
        vadLastProcessedAt: rawStats.vadLastProcessedAt
          ? new Date(rawStats.vadLastProcessedAt)
          : undefined,
        vadJobs: {
          ...rawStats.vadJobs,
          latestFailureAt: rawStats.vadJobs.latestFailureAt
            ? new Date(rawStats.vadJobs.latestFailureAt)
            : undefined,
          recentFailures: (rawStats.vadJobs.recentFailures ?? []).map(
            (failure) => ({
              ...failure,
              failedAt: failure.failedAt
                ? new Date(failure.failedAt)
                : undefined,
            }),
          ),
        },
        stages: (rawStats.stages ?? []).map((stage) => ({
          ...stage,
          latestJob: stage.latestJob
            ? {
              ...stage.latestJob,
              updatedAt: stage.latestJob.updatedAt
                ? new Date(stage.latestJob.updatedAt)
                : undefined,
            }
            : undefined,
        })),
        recentJobs: (rawStats.recentJobs ?? []).map((job) => ({
          ...job,
          createdAt: job.createdAt ? new Date(job.createdAt) : undefined,
          updatedAt: job.updatedAt ? new Date(job.updatedAt) : undefined,
          startedAt: job.startedAt ? new Date(job.startedAt) : undefined,
          finishedAt: job.finishedAt ? new Date(job.finishedAt) : undefined,
        })),
      };

      return {
        sessions,
        hasMore: deserialized.hasMore,
        stats,
      };
    },
    retry: 1,
    refetchInterval: autoRefresh ? 30_000 : false,
  });

  const sessions = sessionsData?.sessions;
  const hasMoreSessions = sessionsData?.hasMore ?? false;

  const loadMoreSessions = () => {
    setSessionLimit((prev) => prev + LOAD_MORE_INCREMENT);
  };

  // Stats are now included in the sessions data
  const stats = sessionsData?.stats;
  const vadCompletion = stats?.totalChunks
    ? Math.min((stats.chunksVadProcessed / stats.totalChunks) * 100, 100)
    : 0;
  const queuedVadJobs = (stats?.vadJobs?.waiting ?? 0) +
    (stats?.vadJobs?.delayed ?? 0);
  const vadMaximumAudioHours = getMaximumAudioHours(
    stats?.chunksAwaitingVad ?? 0,
  );
  const activeStages = stats?.stages?.filter((stage) => stage.active > 0) ?? [];
  const blockedStages = stats?.stages?.filter(
    (stage) => stage.paused && stage.backlog > 0,
  ) ?? [];
  const stagesWithErrors = stats?.stages?.filter((stage) => stage.errors > 0) ??
    [];
  const pipelineHealth = isError && !stats
    ? "error"
    : !stats
    ? "loading"
    : blockedStages.length > 0
    ? "blocked"
    : activeStages.length > 0
    ? "processing"
    : stagesWithErrors.length > 0
    ? "attention"
    : "idle";

  const clearFailedVadMutation = useMutation({
    mutationFn: async () => {
      return await api.callResource("jobs", {
        action: "clear_failed",
        workerType: "vad",
      }) as { deletedCount?: number };
    },
    onSuccess: async (result) => {
      await refetch();
      toast.success(
        `Cleared ${result.deletedCount ?? 0} failed VAD job record(s).`,
      );
    },
    onError: (error) => {
      console.error("Failed to clear VAD error history:", error);
      toast.error("Failed to clear VAD error history.");
    },
  });

  const handleClearFailedVad = () => {
    const failedCount = stats?.vadJobs.failed ?? 0;
    if (failedCount === 0) return;

    if (
      window.confirm(
        `Clear ${failedCount} failed VAD job record(s)?\n\n` +
          "This permanently removes only failed VAD history. Active, waiting, delayed, completed, and other worker jobs are not changed. New VAD failures will appear here normally.",
      )
    ) {
      clearFailedVadMutation.mutate();
    }
  };

  const toggleSession = (id: string) => {
    setExpandedSessions((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const getStateColor = (state: string) => {
    switch (state) {
      case "completed":
        return "bg-green-500/10 text-green-500";
      case "ready":
      case "waiting":
        return "bg-blue-500/10 text-blue-500";
      case "processing":
      case "active":
      case "delayed":
        return "bg-yellow-500/10 text-yellow-500";
      case "error":
      case "failed":
        return "bg-red-500/10 text-red-500";
      case "empty":
        return "bg-gray-500/10 text-gray-500";
      default:
        return "bg-gray-500/10 text-gray-500";
    }
  };

  const getStageProgress = (session: AudioSession) => {
    const stages = [
      {
        name: "Chunks",
        done: session.chunks.total > 0,
        count: session.chunks.total,
      },
      {
        name: "VAD",
        done: session.chunks.vadProcessed === session.chunks.total &&
          session.chunks.total > 0,
        count: session.chunks.vadProcessed,
      },
      {
        name: "Sequences",
        done: session.sequences.length > 0,
        count: session.sequences.length,
      },
      {
        name: "Transcribed",
        done: session.transcriptions > 0,
        count: session.transcriptions,
      },
      {
        name: "Conv Chunks",
        done: session.conversationChunks.length > 0,
        count: session.conversationChunks.length,
      },
      {
        name: "Conversations",
        done: session.conversations.length > 0,
        count: session.conversations.length,
      },
    ];
    return stages;
  };

  const resetSequence = async (sequenceId: string) => {
    await api.callResource("mongo", {
      action: "updateOne",
      collection: "transcription_sequences",
      query: { _id: { $oid: sequenceId } },
      update: { $set: { state: "ready", updatedAt: new Date() } },
    });
    refetch();
  };

  return (
    <div
      className="container mx-auto p-6 space-y-6"
      data-testid="audio-pipeline-page"
    >
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Audio Pipeline</h1>
          <p className="text-muted-foreground">
            Live state from source ingestion through conversations and summaries
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={autoRefresh ? "default" : "outline"}
            size="sm"
            onClick={() => setAutoRefresh(!autoRefresh)}
            data-testid="auto-refresh-toggle"
          >
            <Activity
              className={`h-4 w-4 mr-2 ${autoRefresh ? "animate-pulse" : ""}`}
            />
            {autoRefresh ? "Live" : "Paused"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            data-testid="refresh-btn"
          >
            <RefreshCw
              className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`}
            />
            Refresh
          </Button>
        </div>
      </div>

      <Card
        className={pipelineHealth === "loading"
          ? "border-muted bg-muted/10"
          : pipelineHealth === "error"
          ? "border-red-500/50 bg-red-500/5"
          : pipelineHealth === "blocked"
          ? "border-red-500/50 bg-red-500/5"
          : pipelineHealth === "processing"
          ? "border-blue-500/40 bg-blue-500/5"
          : pipelineHealth === "attention"
          ? "border-amber-500/40 bg-amber-500/5"
          : "border-green-500/30 bg-green-500/5"}
        data-testid="pipeline-health"
      >
        <CardContent className="flex flex-col justify-between gap-4 pt-6 md:flex-row md:items-center">
          <div className="flex items-start gap-3">
            {pipelineHealth === "loading"
              ? <RefreshCw className="mt-0.5 h-5 w-5 animate-spin" />
              : pipelineHealth === "error"
              ? <AlertCircle className="mt-0.5 h-5 w-5 text-red-600" />
              : pipelineHealth === "blocked"
              ? <PauseCircle className="mt-0.5 h-5 w-5 text-red-600" />
              : pipelineHealth === "processing"
              ? (
                <Activity className="mt-0.5 h-5 w-5 animate-pulse text-blue-600" />
              )
              : pipelineHealth === "attention"
              ? <AlertCircle className="mt-0.5 h-5 w-5 text-amber-600" />
              : <CheckCircle2 className="mt-0.5 h-5 w-5 text-green-600" />}
            <div>
              <p className="font-semibold capitalize">
                Pipeline {pipelineHealth}
              </p>
              <p className="text-sm text-muted-foreground">
                {pipelineHealth === "loading"
                  ? "Loading source, backlog, worker, and job state."
                  : pipelineHealth === "error"
                  ? pipelineError instanceof Error
                    ? pipelineError.message
                    : "Pipeline statistics could not be loaded."
                  : blockedStages.length > 0
                  ? `${blockedStages.map((stage) => stage.label).join(", ")} ${
                    blockedStages.length === 1 ? "is" : "are"
                  } paused with work waiting.`
                  : activeStages.length > 0
                  ? `${activeStages.map((stage) => stage.label).join(", ")} ${
                    activeStages.length === 1 ? "is" : "are"
                  } processing now.`
                  : stagesWithErrors.length > 0
                  ? "No worker is active and some stages need attention."
                  : "No stage has queued work or a current error."}
              </p>
            </div>
          </div>
          <Link
            to="/jobs"
            className="text-sm font-medium text-primary hover:underline"
          >
            Open all jobs →
          </Link>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>End-to-end stage status</CardTitle>
          <CardDescription>
            Backlog comes from pipeline collections; running and queued state
            comes from jobs. Paused workers are called out explicitly.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-7">
            {(stats?.stages ?? []).map((stage, index) => {
              const state = stageState(stage);
              return (
                <div
                  key={stage.type}
                  className="relative rounded-lg border bg-muted/20 p-3"
                  data-testid={`pipeline-stage-${stage.type}`}
                >
                  {index > 0 && (
                    <ChevronRight className="absolute -left-3 top-1/2 hidden h-5 w-5 -translate-y-1/2 rounded-full bg-background text-muted-foreground xl:block" />
                  )}
                  <p className="text-xs font-medium text-muted-foreground">
                    {index + 1}. {stage.label}
                  </p>
                  <p className="mt-2 text-2xl font-semibold">
                    {stage.backlog.toLocaleString()}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    items waiting
                  </p>
                  <p className={`mt-2 text-xs font-medium ${state.className}`}>
                    {state.label}
                  </p>
                  {stage.latestJob && (
                    <Link
                      to={`/jobs/${stage.latestJob.id}`}
                      className="mt-2 block truncate text-[11px] text-primary hover:underline"
                    >
                      Latest: {stage.latestJob.state}
                    </Link>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
        <Card>
          <CardHeader>
            <CardTitle>Audio sources</CardTitle>
            <CardDescription>
              Every source type, not only legacy websocket recordings.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
              {[
                ["Total", stats?.sourceFiles?.total ?? 0],
                ["Ingested", stats?.sourceFiles?.ingested ?? 0],
                ["Pending", stats?.sourceFiles?.pending ?? 0],
                ["Errors", stats?.sourceFiles?.errors ?? 0],
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg bg-muted/40 p-3">
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="mt-1 text-xl font-semibold">
                    {(value as number).toLocaleString()}
                  </p>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              {(stats?.sourceFiles?.byKind ?? []).map((source) => (
                <Badge key={source.kind} variant="outline">
                  {source.kind}: {source.count.toLocaleString()}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Latest pipeline jobs</CardTitle>
            <CardDescription>
              This activity can belong to older recordings, so it is shown
              separately from recently added sources.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {(stats?.recentJobs ?? []).slice(0, 6).map((job) => (
              <Link
                key={job.id}
                to={`/jobs/${job.id}`}
                className="flex items-center justify-between gap-4 rounded-md border p-2.5 hover:bg-muted/40"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium capitalize">
                    {formatWorkerType(job.type)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {job.updatedAt
                      ? formatDistanceToNow(job.updatedAt, { addSuffix: true })
                      : "time unavailable"}
                  </p>
                </div>
                <Badge className={getStateColor(job.state)}>{job.state}</Badge>
              </Link>
            ))}
            {(stats?.recentJobs?.length ?? 0) === 0 && (
              <p className="py-5 text-center text-sm text-muted-foreground">
                No pipeline jobs recorded yet.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Pipeline Stats */}
      <Card>
        <CardHeader>
          <div className="flex flex-col justify-between gap-3 md:flex-row md:items-start">
            <div>
              <CardTitle className="flex items-center gap-2">
                <AudioWaveform className="h-5 w-5 text-primary" />
                VAD processing
              </CardTitle>
              <CardDescription className="mt-1">
                Coverage of every audio chunk currently stored in Mycelia. The
                total can increase while ingestion is still creating chunks.
              </CardDescription>
            </div>
            <Badge
              variant={(stats?.chunksAwaitingVad ?? 0) > 0
                ? "secondary"
                : "outline"}
            >
              {(stats?.chunksAwaitingVad ?? 0) > 0
                ? `${stats?.chunksAwaitingVad.toLocaleString()} remaining`
                : "Up to date"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span>
                {(stats?.chunksVadProcessed ?? 0).toLocaleString()} of{" "}
                {(stats?.totalChunks ?? 0).toLocaleString()} chunks processed
              </span>
              <span className="font-medium">{vadCompletion.toFixed(1)}%</span>
            </div>
            <Progress value={vadCompletion} className="h-3" />
            <p className="text-xs text-muted-foreground">
              Remaining upper bound: {(stats?.chunksAwaitingVad ?? 0)
                .toLocaleString()} chunks × {MAX_AUDIO_CHUNK_SECONDS} sec ={" "}
              {vadMaximumAudioHours.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })} hours of audio
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg bg-muted/40 p-3">
              <p className="text-xs text-muted-foreground">Total chunks</p>
              <p className="mt-1 text-xl font-semibold">
                {(stats?.totalChunks ?? 0).toLocaleString()}
              </p>
            </div>
            <div className="rounded-lg bg-muted/40 p-3">
              <p className="text-xs text-muted-foreground">VAD completed</p>
              <p className="mt-1 text-xl font-semibold text-green-600">
                {(stats?.chunksVadProcessed ?? 0).toLocaleString()}
              </p>
            </div>
            <div className="rounded-lg bg-muted/40 p-3">
              <p className="text-xs text-muted-foreground">
                Still awaiting VAD
              </p>
              <p className="mt-1 text-xl font-semibold text-amber-600">
                {(stats?.chunksAwaitingVad ?? 0).toLocaleString()}
              </p>
            </div>
            <div className="rounded-lg bg-muted/40 p-3">
              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                <Activity className="h-3 w-3" /> Active / queued jobs
              </p>
              <p className="mt-1 text-xl font-semibold">
                {stats?.vadJobs?.active ?? 0} / {queuedVadJobs}
              </p>
            </div>
            <div className="rounded-lg bg-muted/40 p-3">
              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                <Gauge className="h-3 w-3" /> Recent speed
              </p>
              <p className="mt-1 text-xl font-semibold">
                {(stats?.vadRatePerMinute ?? 0).toFixed(1)}/min
              </p>
              <p className="text-[11px] text-muted-foreground">
                last 15 minutes
              </p>
            </div>
            <div className="rounded-lg bg-muted/40 p-3">
              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                <Clock className="h-3 w-3" /> Audio left (maximum)
              </p>
              <p className="mt-1 text-xl font-semibold">
                {vadMaximumAudioHours.toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}h
              </p>
              <p className="text-[11px] text-muted-foreground">
                assumes {MAX_AUDIO_CHUNK_SECONDS}s per chunk
              </p>
            </div>
            <div className="rounded-lg bg-muted/40 p-3">
              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                <Timer className="h-3 w-3" /> Estimated wall time
              </p>
              <p className="mt-1 text-sm font-semibold">
                {(stats?.chunksAwaitingVad ?? 0) === 0
                  ? "Complete"
                  : formatEta(stats?.vadEtaSeconds)}
              </p>
            </div>
          </div>

          {(stats?.vadJobs?.failed ?? 0) > 0 && (
            <details className="rounded-lg border border-destructive/40 bg-destructive/5">
              <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-destructive">
                {stats?.vadJobs.failed.toLocaleString()} failed VAD job(s)
                {stats?.vadJobs.latestFailureAt
                  ? ` — latest ${
                    format(
                      stats.vadJobs.latestFailureAt,
                      "MMM d, yyyy · HH:mm:ss",
                    )
                  }`
                  : ""}
              </summary>
              <div className="space-y-3 border-t border-destructive/30 px-4 py-3">
                <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
                  <p className="text-xs text-muted-foreground">
                    Showing the five most recent failures. Clearing removes only
                    failed VAD history.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                    disabled={clearFailedVadMutation.isPending}
                    onClick={handleClearFailedVad}
                  >
                    <Trash2 className="mr-2 h-3.5 w-3.5" />
                    {clearFailedVadMutation.isPending
                      ? "Clearing…"
                      : "Clear failed VAD history"}
                  </Button>
                </div>

                <div className="space-y-2">
                  {(stats?.vadJobs.recentFailures ?? []).map((failure) => (
                    <div
                      key={failure.id}
                      className="rounded-md border border-destructive/20 bg-background/60 p-3"
                    >
                      <div className="mb-1 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
                        <span>
                          {failure.failedAt
                            ? format(failure.failedAt, "MMM d, yyyy · HH:mm:ss")
                            : "Failure time unavailable"}
                        </span>
                        {failure.failedAt && (
                          <span>
                            ({formatDistanceToNow(failure.failedAt, {
                              addSuffix: true,
                            })})
                          </span>
                        )}
                      </div>
                      <pre className="overflow-x-auto whitespace-pre-wrap break-words text-xs text-destructive">
                        {failure.reason || "No error message was stored."}
                      </pre>
                    </div>
                  ))}
                </div>
              </div>
            </details>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-5">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Seq Ready</CardTitle>
            <Clock className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {stats?.sequencesReady ?? "-"}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Seq Processing
            </CardTitle>
            <RefreshCw className="h-4 w-4 text-yellow-500 animate-spin" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {stats?.sequencesProcessing ?? "-"}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Seq Errors</CardTitle>
            <AlertCircle className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {stats?.sequencesError ?? "-"}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Conv Chunks</CardTitle>
            <Layers className="h-4 w-4 text-purple-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {stats?.convChunksReady ?? "-"}
              {(stats?.convChunksProcessing ?? 0) > 0 && (
                <span className="text-sm font-normal text-yellow-500 ml-1">
                  +{stats?.convChunksProcessing}
                </span>
              )}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Conversations</CardTitle>
            <MessageSquare className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {stats?.totalConversations ?? "-"}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Sessions List */}
      <Card>
        <CardHeader>
          <CardTitle>Recently active audio sources</CardTitle>
          <CardDescription>
            Ordered by ingestion or processing activity, not only by recording
            time. Click a source to see its downstream records.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading
            ? (
              <div className="p-8 text-center text-muted-foreground">
                Loading sessions...
              </div>
            )
            : !sessions?.length
            ? (
              <div className="p-8 text-center text-muted-foreground">
                No audio sources found
              </div>
            )
            : (
              <div className="divide-y">
                {sessions?.map((session) => (
                  <Collapsible
                    key={session._id}
                    open={expandedSessions.has(session._id)}
                    onOpenChange={() => toggleSession(session._id)}
                  >
                    <CollapsibleTrigger asChild>
                      <div
                        className="flex cursor-pointer flex-col gap-4 p-4 hover:bg-muted/50 xl:flex-row xl:items-center xl:justify-between"
                        data-testid={`session-row-${session._id}`}
                      >
                        <div className="flex items-center gap-4">
                          <Mic className="h-5 w-5 text-muted-foreground" />
                          <div>
                            <div className="font-medium flex items-center gap-2">
                              {session.start
                                ? format(session.start, "MMM d, HH:mm:ss")
                                : session.path?.split("/").pop() ||
                                  "Recording time unavailable"}
                              <Badge variant="outline" className="font-normal">
                                {session.sourceKind}
                              </Badge>
                              <Badge
                                className={session.ingestionError
                                  ? "bg-red-500/10 text-red-600"
                                  : session.ingested
                                  ? "bg-green-500/10 text-green-600"
                                  : "bg-amber-500/10 text-amber-600"}
                              >
                                {session.ingestionError
                                  ? "ingestion error"
                                  : session.ingested
                                  ? "ingested"
                                  : "pending"}
                              </Badge>
                              {session.client_id && (
                                <span className="text-xs px-2 py-0.5 bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 rounded">
                                  {session.device || session.client_id}
                                </span>
                              )}
                            </div>
                            <div className="text-sm text-muted-foreground">
                              {session.metadata?.codec ||
                                session.metadata?.format || "unknown"}{" "}
                              {session.metadata?.rate}Hz &middot;{" "}
                              {session.lastActivityAt
                                ? `active ${
                                  formatDistanceToNow(session.lastActivityAt, {
                                    addSuffix: true,
                                  })
                                } · `
                                : ""}
                              <span className="font-mono text-xs">
                                {session._id.substring(0, 8)}
                              </span>
                            </div>
                            {session.path && (
                              <div
                                className="max-w-xl truncate text-xs text-muted-foreground"
                                title={session.path}
                              >
                                {session.path}
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="flex w-full items-center gap-6 overflow-x-auto pb-1 xl:w-auto xl:pb-0">
                          {/* Pipeline stages mini-view */}
                          <div className="flex items-center gap-2">
                            {getStageProgress(session).map((stage, i) => (
                              <div
                                key={stage.name}
                                className="flex items-center gap-1"
                              >
                                {i > 0 && (
                                  <ChevronRight className="h-3 w-3 text-muted-foreground" />
                                )}
                                <div
                                  className={`text-xs px-2 py-0.5 rounded ${
                                    stage.done
                                      ? "bg-green-500/10 text-green-600"
                                      : "bg-muted text-muted-foreground"
                                  }`}
                                >
                                  {stage.name}: {stage.count}
                                </div>
                              </div>
                            ))}
                          </div>
                          <ChevronRight
                            className={`h-5 w-5 text-muted-foreground transition-transform ${
                              expandedSessions.has(session._id)
                                ? "rotate-90"
                                : ""
                            }`}
                          />
                        </div>
                      </div>
                    </CollapsibleTrigger>

                    <CollapsibleContent>
                      <div className="px-4 pb-3 pt-2 bg-muted/30 space-y-3">
                        {session.ingestionError && (
                          <div className="rounded-md border border-red-500/30 bg-red-500/5 p-3 text-xs text-red-600">
                            {session.ingestionError}
                          </div>
                        )}
                        {/* Compact stats row */}
                        <div className="flex items-center gap-4 text-xs">
                          <span className="text-muted-foreground">
                            Chunks:{" "}
                            <span className="font-medium text-foreground">
                              {session.chunks.total}
                            </span>
                          </span>
                          <span className="text-muted-foreground">
                            VAD:{" "}
                            <span className="font-medium text-foreground">
                              {session.chunks.vadProcessed}
                            </span>
                            {session.chunks.total > 0 && (
                              <span className="text-muted-foreground ml-1">
                                ({Math.round(
                                  (session.chunks.vadProcessed /
                                    session.chunks.total) * 100,
                                )}%)
                              </span>
                            )}
                          </span>
                          <span className="text-muted-foreground">
                            Speech:{" "}
                            <span className="font-medium text-foreground">
                              {session.chunks.withSpeech}
                            </span>
                          </span>
                          {session.chunks.total > 0 && (
                            <Progress
                              value={(session.chunks.vadProcessed /
                                session.chunks.total) * 100}
                              className="h-1 w-24"
                            />
                          )}
                        </div>

                        {/* Sequences - compact inline */}
                        {session.sequences.length > 0 && (
                          <div className="flex flex-wrap items-center gap-2 text-xs">
                            <span className="text-muted-foreground font-medium">
                              Sequences:
                            </span>
                            {session.sequences.map((seq) => (
                              <div
                                key={seq._id}
                                className="flex items-center gap-1"
                              >
                                <Badge
                                  className={`${
                                    getStateColor(seq.state)
                                  } text-xs py-0 px-1.5`}
                                >
                                  {seq.state}
                                </Badge>
                                <span className="font-mono text-muted-foreground">
                                  [{seq.fromIndex}-{seq.toIndex}]
                                </span>
                                {(seq.state === "error" ||
                                  seq.state === "processing") && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-5 px-1 text-xs"
                                    onClick={() => resetSequence(seq._id)}
                                  >
                                    ↻
                                  </Button>
                                )}
                              </div>
                            ))}
                            {session.sequences.some((s) => s.error) && (
                              <span className="text-red-500 text-xs">
                                Error: {session.sequences.find((s) =>
                                  s.error
                                )?.error?.slice(0, 50)}...
                              </span>
                            )}
                          </div>
                        )}

                        {/* Transcriptions - compact list */}
                        {session.transcriptionDetails.length > 0 && (
                          <div className="space-y-1">
                            <div className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                              <FileText className="h-3 w-3" />
                              Transcriptions ({session.transcriptions})
                            </div>
                            <div className="space-y-1 max-h-32 overflow-y-auto">
                              {session.transcriptionDetails.map((t) => (
                                <div
                                  key={t._id}
                                  className="flex gap-2 text-xs bg-background rounded px-2 py-1"
                                >
                                  <Link
                                    to={`/timeline?start=${t.start.getTime()}&end=${t.end.getTime()}`}
                                    className="text-muted-foreground hover:underline whitespace-nowrap shrink-0"
                                  >
                                    {format(t.start, "HH:mm:ss")}
                                  </Link>
                                  <span className="text-foreground truncate">
                                    {t.text || (
                                      <span className="italic text-muted-foreground">
                                        (no text)
                                      </span>
                                    )}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Conversation Chunks - compact inline */}
                        {session.conversationChunks.length > 0 && (
                          <div className="space-y-1">
                            <div className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                              <Layers className="h-3 w-3 text-purple-500" />
                              Conv Chunks ({session.conversationChunks.length})
                            </div>
                            <div className="flex flex-wrap gap-1">
                              {session.conversationChunks.map((chunk) => (
                                <div
                                  key={chunk._id}
                                  className="flex items-center gap-1 bg-background rounded px-2 py-0.5 text-xs"
                                >
                                  <Badge
                                    className={`${
                                      getStateColor(chunk.state)
                                    } text-xs py-0 px-1`}
                                  >
                                    {chunk.state}
                                  </Badge>
                                  {chunk.start && chunk.end && (
                                    <Link
                                      to={`/timeline?start=${chunk.start.getTime()}&end=${chunk.end.getTime()}`}
                                      className="hover:underline text-primary"
                                    >
                                      {format(chunk.start, "HH:mm")}
                                    </Link>
                                  )}
                                  {chunk.conversationsCreated !== undefined &&
                                    chunk.conversationsCreated > 0 && (
                                    <span className="text-green-500">
                                      →{chunk.conversationsCreated}
                                    </span>
                                  )}
                                  {chunk.error && (
                                    <span
                                      className="text-red-500"
                                      title={chunk.error}
                                    >
                                      ⚠
                                    </span>
                                  )}
                                  {chunk.emptyReason && (
                                    <span
                                      className="text-yellow-500"
                                      title={chunk.emptyReason}
                                    >
                                      ∅
                                    </span>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Conversations - 2 column grid */}
                        {session.conversations.length > 0 && (
                          <div className="space-y-2">
                            <div className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                              <MessageSquare className="h-3 w-3 text-green-500" />
                              Conversations ({session.conversations.length})
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              {session.conversations.map((conv) => {
                                const start = conv.timeRanges?.[0]?.start
                                  ? new Date(conv.timeRanges[0].start)
                                  : null;
                                const end = conv.timeRanges?.[0]?.end
                                  ? new Date(conv.timeRanges[0].end)
                                  : null;
                                const durationMs = start && end
                                  ? end.getTime() - start.getTime()
                                  : 0;
                                const durationMins = Math.round(
                                  durationMs / 60000,
                                );

                                return (
                                  <div
                                    key={conv._id}
                                    className="flex items-start gap-2 bg-background rounded-lg p-2 hover:bg-muted transition-colors"
                                  >
                                    {conv.icon?.text && (
                                      <span className="text-lg shrink-0">
                                        {conv.icon.text}
                                      </span>
                                    )}
                                    <div className="flex-1 min-w-0">
                                      <Link
                                        to={`/objects/${conv._id}`}
                                        className="text-sm font-medium text-primary hover:underline block truncate"
                                      >
                                        {conv.name}
                                      </Link>
                                      {start && (
                                        <Link
                                          to={`/timeline?start=${start.getTime()}&end=${
                                            end?.getTime() || start.getTime()
                                          }`}
                                          className="text-xs text-muted-foreground hover:underline flex items-center gap-1"
                                        >
                                          <span>
                                            {format(start, "MMM d, HH:mm")}
                                          </span>
                                          {durationMins > 0 && (
                                            <span className="text-muted-foreground">
                                              • {durationMins}m
                                            </span>
                                          )}
                                        </Link>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {/* Empty states - inline */}
                        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                          {session.sequences.length === 0 && (
                            <span>
                              No sequences{session.chunks.withSpeech === 0 &&
                                session.chunks.vadProcessed > 0 &&
                                " (no speech)"}
                            </span>
                          )}
                          {session.transcriptionDetails.length === 0 &&
                            session.sequences.length > 0 && (
                            <span>No transcriptions</span>
                          )}
                          {session.conversations.length === 0 &&
                            session.transcriptions > 0 && (
                            <span>
                              No conversations{session.conversationChunks.some(
                                (c) => c.state === "empty",
                              ) && " (empty chunks)"}
                            </span>
                          )}
                          <span className="font-mono text-[10px] ml-auto">
                            {session._id}
                          </span>
                        </div>
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                ))}
                {hasMoreSessions && (
                  <div className="p-4 border-t">
                    <Button
                      variant="outline"
                      className="w-full"
                      onClick={loadMoreSessions}
                      data-testid="load-more-sessions"
                    >
                      Load More Sessions
                    </Button>
                  </div>
                )}
              </div>
            )}
        </CardContent>
      </Card>
    </div>
  );
}
