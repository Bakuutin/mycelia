import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { format, formatDistanceToNow } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  RefreshCw,
  Mic,
  AudioWaveform,
  FileText,
  Clock,
  AlertCircle,
  ChevronRight,
  Activity,
  MessageSquare,
  Layers,
} from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

interface AudioSession {
  _id: string;
  start: Date;
  metadata?: {
    format?: string;
    rate?: number;
    width?: number;
    channels?: number;
    source?: string;
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
  chunksAwaitingVad: number;
  sequencesReady: number;
  sequencesProcessing: number;
  sequencesError: number;
  convChunksReady: number;
  convChunksProcessing: number;
  totalConversations: number;
}

const DEFAULT_SESSION_LIMIT = 10;
const LOAD_MORE_INCREMENT = 10;

export default function AudioPipelinePage() {
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [expandedSessions, setExpandedSessions] = useState<Set<string>>(new Set());
  const [sessionLimit, setSessionLimit] = useState(DEFAULT_SESSION_LIMIT);

  const { data: sessionsData, isLoading, refetch } = useQuery({
    queryKey: ["audio-pipeline-sessions", sessionLimit],
    queryFn: async () => {
      // Fetch recent source files with aggregated pipeline data
      const sourceFiles = await api.callResource("mongo", {
        action: "find",
        collection: "source_files",
        query: { "metadata.source": "websocket" },
        options: { sort: { start: -1 }, limit: sessionLimit + 1 }, // +1 to check if there's more
      }) as any[];

      const hasMore = sourceFiles.length > sessionLimit;
      const filesToProcess = sourceFiles.slice(0, sessionLimit);

      // For each source file, get pipeline status
      const sessionsWithStatus = await Promise.all(
        filesToProcess.map(async (sf) => {
          const sourceFileId = sf._id;

          // Get chunk stats
          const [totalChunks, vadProcessed, withSpeech] = await Promise.all([
            api.callResource("mongo", {
              action: "count",
              collection: "audio_chunks",
              query: { original_id: sourceFileId },
            }),
            api.callResource("mongo", {
              action: "count",
              collection: "audio_chunks",
              query: { original_id: sourceFileId, "vad.ran_at": { $exists: true } },
            }),
            api.callResource("mongo", {
              action: "count",
              collection: "audio_chunks",
              query: { original_id: sourceFileId, "vad.has_speech": true },
            }),
          ]);

          // Get sequences
          const sequences = await api.callResource("mongo", {
            action: "find",
            collection: "transcription_sequences",
            query: { original_id: sourceFileId },
            options: { sort: { start: -1 } },
          }) as any[];

          // Get transcription count and details (oldest first)
          const transcriptionDocs = await api.callResource("mongo", {
            action: "find",
            collection: "transcriptions",
            query: { original: sourceFileId },
            options: { sort: { start: 1 }, limit: 20 },
          }) as any[];
          const transcriptions = transcriptionDocs.length;

          // Get conversation chunks for this session (try both ObjectId and string)
          const conversationChunks = await api.callResource("mongo", {
            action: "find",
            collection: "conversation_chunks",
            query: { original_id: { $oid: sf._id.toString() } },
            options: { sort: { createdAt: -1 } },
          }) as any[];

          // Get conversations for this session
          const conversationsData = await api.callResource("mongo", {
            action: "find",
            collection: "objects",
            query: {
              isConversation: true,
            },
            options: { sort: { createdAt: -1 }, limit: 50 },
          }) as any[];

          return {
            _id: sf._id.toString(),
            start: new Date(sf.start),
            metadata: sf.metadata,
            processing_status: sf.processing_status,
            chunks: {
              total: totalChunks as number,
              vadProcessed: vadProcessed as number,
              withSpeech: withSpeech as number,
            },
            sequences: sequences.map((s: any) => ({
              _id: s._id.toString(),
              state: s.state,
              chunk_count: s.chunk_count,
              fromIndex: s.fromIndex,
              toIndex: s.toIndex,
              updatedAt: s.updatedAt ? new Date(s.updatedAt) : undefined,
              error: s.error,
            })),
            transcriptions: transcriptions as number,
            conversationChunks: conversationChunks.map((c: any) => ({
              _id: c._id.toString(),
              state: c.state,
              mode: c.mode,
              transcriptionCount: c.transcriptionCount || 0,
              totalTextLength: c.totalTextLength || 0,
              start: c.start ? new Date(c.start) : undefined,
              end: c.end ? new Date(c.end) : undefined,
              updatedAt: c.updatedAt ? new Date(c.updatedAt) : undefined,
              error: c.error,
              emptyReason: c.emptyReason,
              segmentsFound: c.segmentsFound,
              conversationsCreated: c.conversationsCreated,
            })),
            transcriptionDetails: transcriptionDocs.map((t: any) => ({
              _id: t._id.toString(),
              start: new Date(t.start),
              end: new Date(t.end),
              text: t.segments?.map((s: any) => s.text).join("") || t.text || "",
            })),
            conversations: conversationsData.map((c: any) => ({
              _id: c._id.toString(),
              name: c.name,
              icon: c.icon,
              timeRanges: c.timeRanges,
              createdAt: c.createdAt ? new Date(c.createdAt) : undefined,
            })),
          } as AudioSession;
        })
      );

      return { sessions: sessionsWithStatus, hasMore };
    },
    refetchInterval: autoRefresh ? 5000 : false,
  });

  const sessions = sessionsData?.sessions;
  const hasMoreSessions = sessionsData?.hasMore ?? false;

  const loadMoreSessions = () => {
    setSessionLimit((prev) => prev + LOAD_MORE_INCREMENT);
  };

  const { data: stats } = useQuery({
    queryKey: ["audio-pipeline-stats"],
    queryFn: async () => {
      const [
        chunksAwaitingVad,
        sequencesReady,
        sequencesProcessing,
        sequencesError,
        convChunksReady,
        convChunksProcessing,
        totalConversations,
      ] = await Promise.all([
        api.callResource("mongo", {
          action: "count",
          collection: "audio_chunks",
          query: { vad: null },
        }),
        api.callResource("mongo", {
          action: "count",
          collection: "transcription_sequences",
          query: { state: "ready" },
        }),
        api.callResource("mongo", {
          action: "count",
          collection: "transcription_sequences",
          query: { state: "processing" },
        }),
        api.callResource("mongo", {
          action: "count",
          collection: "transcription_sequences",
          query: { state: "error" },
        }),
        api.callResource("mongo", {
          action: "count",
          collection: "conversation_chunks",
          query: { state: "ready" },
        }),
        api.callResource("mongo", {
          action: "count",
          collection: "conversation_chunks",
          query: { state: "processing" },
        }),
        api.callResource("mongo", {
          action: "count",
          collection: "objects",
          query: { isConversation: true },
        }),
      ]);

      return {
        totalSessions: sessions?.length || 0,
        chunksAwaitingVad: chunksAwaitingVad as number,
        sequencesReady: sequencesReady as number,
        sequencesProcessing: sequencesProcessing as number,
        sequencesError: sequencesError as number,
        convChunksReady: convChunksReady as number,
        convChunksProcessing: convChunksProcessing as number,
        totalConversations: totalConversations as number,
      } as PipelineStats;
    },
    refetchInterval: autoRefresh ? 5000 : false,
  });

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
      { name: "Chunks", done: session.chunks.total > 0, count: session.chunks.total },
      { name: "VAD", done: session.chunks.vadProcessed === session.chunks.total && session.chunks.total > 0, count: session.chunks.vadProcessed },
      { name: "Sequences", done: session.sequences.length > 0, count: session.sequences.length },
      { name: "Transcribed", done: session.transcriptions > 0, count: session.transcriptions },
      { name: "Conv Chunks", done: session.conversationChunks.length > 0, count: session.conversationChunks.length },
      { name: "Conversations", done: session.conversations.length > 0, count: session.conversations.length },
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
    <div className="container mx-auto p-6 space-y-6" data-testid="audio-pipeline-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Audio Pipeline</h1>
          <p className="text-muted-foreground">Track audio sessions through VAD and transcription</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={autoRefresh ? "default" : "outline"}
            size="sm"
            onClick={() => setAutoRefresh(!autoRefresh)}
            data-testid="auto-refresh-toggle"
          >
            <Activity className={`h-4 w-4 mr-2 ${autoRefresh ? "animate-pulse" : ""}`} />
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
      <div className="grid gap-4 md:grid-cols-4 lg:grid-cols-7">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Awaiting VAD</CardTitle>
            <AudioWaveform className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.chunksAwaitingVad ?? "-"}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Seq Ready</CardTitle>
            <Clock className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.sequencesReady ?? "-"}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Seq Processing</CardTitle>
            <RefreshCw className="h-4 w-4 text-yellow-500 animate-spin" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.sequencesProcessing ?? "-"}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Seq Errors</CardTitle>
            <AlertCircle className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.sequencesError ?? "-"}</div>
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
                <span className="text-sm font-normal text-yellow-500 ml-1">+{stats?.convChunksProcessing}</span>
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
            <div className="text-2xl font-bold">{stats?.totalConversations ?? "-"}</div>
          </CardContent>
        </Card>
      </div>

      {/* Sessions List */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Audio Sessions</CardTitle>
          <CardDescription>Click a session to see detailed pipeline status</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">Loading sessions...</div>
          ) : !sessions?.length ? (
            <div className="p-8 text-center text-muted-foreground">No audio sessions found</div>
          ) : (
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
                          <div className="font-medium">
                            {format(session.start, "MMM d, HH:mm:ss")}
                          </div>
                          <div className="text-sm text-muted-foreground">
                            {session.metadata?.format} {session.metadata?.rate}Hz
                            {" "}&middot;{" "}
                            {formatDistanceToNow(session.start, { addSuffix: true })}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-6">
                        {/* Pipeline stages mini-view */}
                        <div className="flex items-center gap-2">
                          {getStageProgress(session).map((stage, i) => (
                            <div key={stage.name} className="flex items-center gap-1">
                              {i > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
                              <div className={`text-xs px-2 py-0.5 rounded ${stage.done ? "bg-green-500/10 text-green-600" : "bg-muted text-muted-foreground"}`}>
                                {stage.name}: {stage.count}
                              </div>
                            </div>
                          ))}
                        </div>
                        <ChevronRight
                          className={`h-5 w-5 text-muted-foreground transition-transform ${expandedSessions.has(session._id) ? "rotate-90" : ""}`}
                        />
                      </div>
                    </div>
                  </CollapsibleTrigger>

                  <CollapsibleContent>
                    <div className="px-4 pb-3 pt-2 bg-muted/30 space-y-3">
                      {/* Compact stats row */}
                      <div className="flex items-center gap-4 text-xs">
                        <span className="text-muted-foreground">
                          Chunks: <span className="font-medium text-foreground">{session.chunks.total}</span>
                        </span>
                        <span className="text-muted-foreground">
                          VAD: <span className="font-medium text-foreground">{session.chunks.vadProcessed}</span>
                          {session.chunks.total > 0 && (
                            <span className="text-muted-foreground ml-1">
                              ({Math.round((session.chunks.vadProcessed / session.chunks.total) * 100)}%)
                            </span>
                          )}
                        </span>
                        <span className="text-muted-foreground">
                          Speech: <span className="font-medium text-foreground">{session.chunks.withSpeech}</span>
                        </span>
                        {session.chunks.total > 0 && (
                          <Progress
                            value={(session.chunks.vadProcessed / session.chunks.total) * 100}
                            className="h-1 w-24"
                          />
                        )}
                      </div>

                      {/* Sequences - compact inline */}
                      {session.sequences.length > 0 && (
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="text-muted-foreground font-medium">Sequences:</span>
                          {session.sequences.map((seq) => (
                            <div key={seq._id} className="flex items-center gap-1">
                              <Badge className={`${getStateColor(seq.state)} text-xs py-0 px-1.5`}>
                                {seq.state}
                              </Badge>
                              <span className="font-mono text-muted-foreground">[{seq.fromIndex}-{seq.toIndex}]</span>
                              {(seq.state === "error" || seq.state === "processing") && (
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
                              Error: {session.sequences.find((s) => s.error)?.error?.slice(0, 50)}...
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
                              <div key={t._id} className="flex gap-2 text-xs bg-background rounded px-2 py-1">
                                <Link
                                  to={`/timeline?start=${t.start.getTime()}&end=${t.end.getTime()}`}
                                  className="text-muted-foreground hover:underline whitespace-nowrap shrink-0"
                                >
                                  {format(t.start, "HH:mm:ss")}
                                </Link>
                                <span className="text-foreground truncate">
                                  {t.text || <span className="italic text-muted-foreground">(no text)</span>}
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
                              <div key={chunk._id} className="flex items-center gap-1 bg-background rounded px-2 py-0.5 text-xs">
                                <Badge className={`${getStateColor(chunk.state)} text-xs py-0 px-1`}>
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
                                {chunk.conversationsCreated !== undefined && chunk.conversationsCreated > 0 && (
                                  <span className="text-green-500">→{chunk.conversationsCreated}</span>
                                )}
                                {chunk.error && <span className="text-red-500" title={chunk.error}>⚠</span>}
                                {chunk.emptyReason && <span className="text-yellow-500" title={chunk.emptyReason}>∅</span>}
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
                              const start = conv.timeRanges?.[0]?.start ? new Date(conv.timeRanges[0].start) : null;
                              const end = conv.timeRanges?.[0]?.end ? new Date(conv.timeRanges[0].end) : null;
                              const durationMs = start && end ? end.getTime() - start.getTime() : 0;
                              const durationMins = Math.round(durationMs / 60000);
                              
                              return (
                                <div
                                  key={conv._id}
                                  className="flex items-start gap-2 bg-background rounded-lg p-2 hover:bg-muted transition-colors"
                                >
                                  {conv.icon?.text && (
                                    <span className="text-lg shrink-0">{conv.icon.text}</span>
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
                                        to={`/timeline?start=${start.getTime()}&end=${end?.getTime() || start.getTime()}`}
                                        className="text-xs text-muted-foreground hover:underline flex items-center gap-1"
                                      >
                                        <span>{format(start, "MMM d, HH:mm")}</span>
                                        {durationMins > 0 && (
                                          <span className="text-muted-foreground">• {durationMins}m</span>
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
                          <span>No sequences{session.chunks.withSpeech === 0 && session.chunks.vadProcessed > 0 && " (no speech)"}</span>
                        )}
                        {session.transcriptionDetails.length === 0 && session.sequences.length > 0 && (
                          <span>No transcriptions</span>
                        )}
                        {session.conversations.length === 0 && session.transcriptions > 0 && (
                          <span>No conversations{session.conversationChunks.some(c => c.state === "empty") && " (empty chunks)"}</span>
                        )}
                        <span className="font-mono text-[10px] ml-auto">{session._id}</span>
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
