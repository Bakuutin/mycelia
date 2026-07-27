import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
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
import {
  Activity,
  AlertCircle,
  AudioWaveform,
  ChevronRight,
  Clock,
  FileText,
  Gauge,
  Layers,
  MessageSquare,
  Mic,
  RefreshCw,
  Timer,
} from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

interface AudioSession {
  _id: string;
  start: Date;
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
  };
  sequencesReady: number;
  sequencesProcessing: number;
  sequencesError: number;
  convChunksReady: number;
  convChunksProcessing: number;
  totalConversations: number;
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

export default function AudioPipelinePage() {
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [expandedSessions, setExpandedSessions] = useState<Set<string>>(
    new Set(),
  );
  const [sessionLimit, setSessionLimit] = useState(DEFAULT_SESSION_LIMIT);

  const { data: sessionsData, isLoading, refetch } = useQuery({
    queryKey: ["audio-pipeline-sessions", sessionLimit],
    queryFn: async () => {
      // Use the new aggregated pipeline endpoint
      const response = await fetch(
        `${api.baseURL}/api/audio/pipeline?limit=${sessionLimit}`,
        {
          headers: {
            "Authorization": `Bearer ${await api.getJWT()}`,
          },
        },
      );

      if (!response.ok) {
        throw new Error("Failed to fetch pipeline data");
      }

      const data = await response.json();

      // Deserialize EJSON (handles BSON date format { $date: "..." })
      const deserialized = EJSON.deserialize(data);

      // Convert any remaining date strings to Date objects
      const sessions: AudioSession[] = deserialized.sessions.map((s: any) => ({
        ...s,
        start: s.start instanceof Date ? s.start : new Date(s.start),
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

      return {
        sessions,
        hasMore: deserialized.hasMore,
        stats: deserialized.stats as PipelineStats,
      };
    },
    refetchInterval: autoRefresh ? 5000 : false,
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
        return "bg-blue-500/10 text-blue-500";
      case "processing":
        return "bg-yellow-500/10 text-yellow-500";
      case "error":
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
            Track audio sessions through VAD and transcription
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
            data-testid="refresh-btn"
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>
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
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
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
                <Timer className="h-3 w-3" /> Estimated time left
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
                {stats?.vadJobs.failed.toLocaleString()}{" "}
                failed VAD job(s) — show latest error
              </summary>
              <pre className="overflow-x-auto whitespace-pre-wrap break-words border-t border-destructive/30 px-4 py-3 text-xs text-destructive">
                {stats?.vadJobs.latestFailure || "No error message was stored."}
              </pre>
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
          <CardTitle>Recent Audio Sessions</CardTitle>
          <CardDescription>
            Click a session to see detailed pipeline status
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
                No audio sessions found
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
                        className="flex items-center justify-between p-4 hover:bg-muted/50 cursor-pointer"
                        data-testid={`session-row-${session._id}`}
                      >
                        <div className="flex items-center gap-4">
                          <Mic className="h-5 w-5 text-muted-foreground" />
                          <div>
                            <div className="font-medium flex items-center gap-2">
                              {format(session.start, "MMM d, HH:mm:ss")}
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
                              {formatDistanceToNow(session.start, {
                                addSuffix: true,
                              })} &middot;{" "}
                              <span className="font-mono text-xs">
                                {session._id.substring(0, 8)}
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-6">
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
