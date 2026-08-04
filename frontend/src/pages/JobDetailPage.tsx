import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { api } from "@/lib/api";
import { useJobsListener } from "@/hooks/useJobsListener";
import { useWebSocketSubscription } from "@/hooks/useWebSocket";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Ban, FileText, Clock, Hash, MessageSquare, ExternalLink, Users, Layers, AlertTriangle, Volume2, Tag, BarChart3, Play, RefreshCw, Copy, Check, type LucideIcon } from "lucide-react";
import { ObjectAudioPlayer } from "@/components/ObjectAudioPlayer";
import { Skeleton } from "@/components/ui/skeleton";
import type { JobInfo, JobLogEntry, JobAccessLogEntry } from "@/types/jobs";
import { parseJobError } from "@/lib/jobs";
import { getJobErrorCode } from "@/lib/jobErrors";

interface TranscriptionDoc {
    _id: string;
    original: string;
    start: string;
    end: string;
    duration: number;
    text: string;
    segments: Array<{ start: number; end: number; text: string }>;
    metadata?: {
        model?: string;
        processingTimeMs?: number;
        wordCount?: number;
        segmentCount?: number;
        language?: string;
        jobId?: string;
    };
    chunk_id?: string;
    createdAt: string;
}

interface ConversationChunk {
    _id: unknown;
    text?: string;
    state?: string;
    start?: string;
    end?: string;
    transcriptionCount?: number;
    totalTextLength?: number;
    segmentsFound?: number;
    conversationsCreated?: number;
    processedByJobId?: string;
}

const flattenNestedFields = (obj: any, prefix = ""): Array<[string, any]> => {
    const result: Array<[string, any]> = [];

    for (const [key, value] of Object.entries(obj)) {
        const fullPath = prefix ? `${prefix}.${key}` : key;

        if (value !== null && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date)) {
            const nested = flattenNestedFields(value, fullPath);
            result.push(...nested);
        } else {
            result.push([fullPath, value]);
        }
    }

    return result;
};

const getTypeString = (value: any): string => {
    if (value === null || value === undefined) return "unknown";
    if (typeof value === "string") return "string";
    if (typeof value === "number") return "number";
    if (typeof value === "boolean") return "boolean";
    if (Array.isArray(value)) {
        if (value.length === 0) return "array";
        const firstType = getTypeString(value[0]);
        return `${firstType}[]`;
    }
    if (value instanceof Date) return "date";
    return "object";
};

const formatValue = (value: any): string => {
    if (value === null || value === undefined) return "";
    if (typeof value === "string") return value;
    if (typeof value === "number") return value.toString();
    if (typeof value === "boolean") return value.toString();
    if (value instanceof Date) return format(value, "PPpp");
    if (Array.isArray(value)) {
        return value.map((v) => String(v)).join(", ");
    }
    if (typeof value === "object") {
        return JSON.stringify(value);
    }
    return String(value);
};

function MetricCell({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: ReactNode }) {
    return (
        <div className="flex items-center gap-2">
            <Icon className="h-4 w-4 text-muted-foreground" />
            <div>
                <div className="text-xs text-muted-foreground">{label}</div>
                <div className="text-sm font-medium">{value}</div>
            </div>
        </div>
    );
}

function ModelProvenanceDetails({ entries }: { entries: NonNullable<JobInfo["modelProvenance"]> }) {
    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <BarChart3 className="h-5 w-5" />
                    Inference Model
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
                {entries.length === 0 ? (
                    <div className="text-sm text-muted-foreground">
                        Model provenance was not recorded for this job.
                    </div>
                ) : entries.map((entry, index) => (
                    <div key={`${entry.stage}-${entry.requestedModel}-${entry.executedModel}-${index}`} className="rounded-lg border p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                                <div className="text-xs uppercase tracking-wide text-muted-foreground">{entry.stage}</div>
                                <div className="font-mono text-sm font-medium">
                                    {entry.executedModel || "Execution model not recorded"}
                                </div>
                            </div>
                            <Badge variant={entry.provenanceQuality === "exact" ? "secondary" : "outline"}>
                                {entry.provenanceQuality === "exact" ? "executed model" : "requested only"}
                            </Badge>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                            {entry.requestedModel && (
                                <span>Requested: <span className="font-mono text-foreground">{entry.requestedModel}</span></span>
                            )}
                            {(entry.providerProfileName || entry.providerBaseUrl) && (
                                <span>Provider: {entry.providerProfileName || entry.providerBaseUrl}</span>
                            )}
                            {entry.fallbackUsed && (
                                <span className="text-amber-500">Fallback used: {entry.fallbackModel || "configured fallback"}</span>
                            )}
                        </div>
                    </div>
                ))}
            </CardContent>
        </Card>
    );
}

function FieldDisplay({ fields }: { fields: Array<[string, any]> }) {
    if (fields.length === 0) {
        return <div className="text-sm text-muted-foreground">No data</div>;
    }

    return (
        <>
            {fields.map(([key, value]) => {
                return (
                    <div key={key}>
                        <div className="text-sm text-muted-foreground mb-1">{key}</div>
                        <div className="text-sm">
                            {formatValue(value)}
                        </div>
                    </div>
                );
            })}
        </>
    );
}

function JobErrorPanel({ failedReason }: { failedReason: string }) {
    const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
    const parsed = parseJobError(failedReason);
    const errorCode = getJobErrorCode(failedReason);

    const copyError = async () => {
        try {
            try {
                await navigator.clipboard.writeText(failedReason);
            } catch {
                const textarea = document.createElement("textarea");
                textarea.value = failedReason;
                textarea.setAttribute("readonly", "");
                textarea.style.position = "fixed";
                textarea.style.opacity = "0";
                document.body.appendChild(textarea);
                textarea.select();
                const copied = document.execCommand("copy");
                textarea.remove();
                if (!copied) throw new Error("Browser refused clipboard access");
            }
            setCopyState("copied");
        } catch {
            setCopyState("failed");
        }
        globalThis.setTimeout(() => setCopyState("idle"), 2000);
    };

    return (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0">
                    <AlertTriangle className="h-5 w-5 shrink-0 text-red-500 mt-0.5" />
                    <div className="space-y-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold text-red-400">Error</span>
                            {errorCode && (
                                <Badge variant="outline" className="font-mono text-red-400 border-red-500/40 select-all">
                                    {errorCode}
                                </Badge>
                            )}
                            {parsed && (
                                <Badge className="bg-red-500/10 text-red-400">
                                    {parsed.label}
                                </Badge>
                            )}
                        </div>
                        {parsed && (
                            <p className="text-sm text-red-300/90">
                                {parsed.detail}
                            </p>
                        )}
                    </div>
                </div>
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={copyError}
                    className="shrink-0"
                    aria-label="Copy full error"
                >
                    {copyState === "copied"
                        ? <Check className="h-4 w-4 mr-2" />
                        : <Copy className="h-4 w-4 mr-2" />}
                    {copyState === "copied"
                        ? "Copied"
                        : copyState === "failed"
                        ? "Select below"
                        : "Copy error"}
                </Button>
            </div>
            <pre className="max-h-64 overflow-auto rounded-md bg-background/70 p-3 text-xs text-red-300 whitespace-pre-wrap break-words select-text">
                {failedReason}
            </pre>
        </div>
    );
}

export default function JobDetailPage() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const { getJobById, isLoading: isListenerLoading } = useJobsListener();
    const queryClient = useQueryClient();

    const cachedJob = id ? getJobById(id) : null;

    const { data: fetchedJob, isLoading: isFetching, isFetching: isRefreshing, refetch } = useQuery({
        queryKey: ["job", id],
        queryFn: async () => {
            if (!id) {
                throw new Error("Job ID and type are required");
            }
            const response = await api.callResource("jobs", {
                action: "get",
                id: id,
            });
            return response as JobInfo;
        },
        enabled: !!id,
        refetchInterval: (query) => {
            const state = (query.state.data as JobInfo | undefined)?.state;
            return state && ["active", "waiting", "delayed"].includes(state)
                ? 3_000
                : false;
        },
    });

    // Prefer the detail endpoint because it also checks BullMQ and refreshes
    // when list websocket events are missed.
    const job = fetchedJob || cachedJob;
    const isTranscriptionJob = job?.type === "transcription";
    const isConversationExtractorJob = job?.type === "conversation_extractor";
    const isLoading = (isListenerLoading && !cachedJob) || (isFetching && !cachedJob);

    const logDateRange = (() => {
        if (!job) return null;
        const start = job.timestamp ?? job.processedOn;
        if (!start) return null;
        const startDate = new Date(new Date(start).getTime() - 60_000);
        const range: { $gte: Date; $lte?: Date } = { $gte: startDate };
        if (job.finishedOn) {
            const endDate = new Date(new Date(job.finishedOn).getTime() + 60_000);
            range.$lte = endDate;
        }
        return range;
    })();

    const { data: jobLogs = [], isLoading: isLogsLoading } = useQuery({
        queryKey: ["job-logs", id, logDateRange],
        queryFn: async () => {
            if (!id) return [];
            const query: Record<string, unknown> = { jobId: id };
            if (logDateRange) {
                query.timestamp = logDateRange;
            }
            const response = await api.callResource("mongo", {
                action: "find",
                collection: "job_logs",
                query,
                options: {
                    sort: { timestamp: 1 },
                    limit: 500,
                },
            });
            return response as JobLogEntry[];
        },
        enabled: !!id && !!job,
    });

    const { data: accessLogs = [], isLoading: isAccessLogsLoading } = useQuery({
        queryKey: ["job-access-logs", id, logDateRange],
        queryFn: async () => {
            if (!id) return [];
            const query: Record<string, unknown> = { principal: `job:${id}` };
            if (logDateRange) {
                query.timestamp = logDateRange;
            }
            const response = await api.callResource("mongo", {
                action: "find",
                collection: "access_logs",
                query,
                options: {
                    sort: { timestamp: 1 },
                    limit: 500,
                },
            });
            return response as JobAccessLogEntry[];
        },
        enabled: !!id && !!job,
    });

    // Fetch transcriptions created by this job
    const { data: transcriptions = [], isLoading: isTranscriptionsLoading } = useQuery({
        queryKey: ["job-transcriptions", id],
        queryFn: async () => {
            if (!id) return [];
            const response = await api.callResource("mongo", {
                action: "find",
                collection: "transcriptions",
                query: { "metadata.jobId": id },
                options: {
                    sort: { createdAt: -1 },
                    limit: 10,
                },
            });
            return response as TranscriptionDoc[];
        },
        enabled: !!id && isTranscriptionJob,
    });

    // Fetch conversation chunks linked to transcriptions
    const transcriptionChunkIds = transcriptions
        .map(t => t.chunk_id)
        .filter((id): id is string => !!id);

    const { data: conversationChunks = [] } = useQuery({
        queryKey: ["transcription-chunks", transcriptionChunkIds],
        queryFn: async () => {
            if (transcriptionChunkIds.length === 0) return [];
            const response = await api.callResource("mongo", {
                action: "find",
                collection: "conversation_chunks",
                query: { _id: { $in: transcriptionChunkIds } },
                options: { limit: 10 },
            });
            return response as ConversationChunk[];
        },
        enabled: transcriptionChunkIds.length > 0,
    });

    const { data: extractedChunks = [] } = useQuery({
        queryKey: ["extractor-job-chunks", id],
        queryFn: async () => {
            if (!id) return [];
            const response = await api.callResource("mongo", {
                action: "find",
                collection: "conversation_chunks",
                query: { processedByJobId: id },
                options: {
                    sort: { start: 1 },
                    limit: 50,
                    projection: {
                        _id: 1,
                        state: 1,
                        start: 1,
                        end: 1,
                        transcriptionCount: 1,
                        totalTextLength: 1,
                        segmentsFound: 1,
                        conversationsCreated: 1,
                        processedByJobId: 1,
                    },
                },
            });
            return response as ConversationChunk[];
        },
        enabled: !!id && isConversationExtractorJob,
    });

    useWebSocketSubscription(
        `jobs:${id}:logs`,
        (event) => {
            if (event.event !== "job.log" || !event.data) return;
            const data = event.data as Partial<JobLogEntry> & { logId?: string };
            const logId = data.logId ?? data._id;
            queryClient.setQueryData<JobLogEntry[]>(["job-logs", id], (oldLogs = []) => {
                if (logId && oldLogs.some((log) => log._id === logId)) {
                    return oldLogs;
                }
                const nextLog: JobLogEntry = {
                    _id: logId,
                    jobId: data.jobId ?? (id ?? "unknown"),
                    stream: (data.stream as "stdout" | "stderr" | "progress") ?? "stdout",
                    text: data.text ?? "",
                    timestamp: data.timestamp ?? new Date().toISOString(),
                };
                return [...oldLogs, nextLog];
            });
        },
        !!id,
    );

    const cancelJobMutation = useMutation({
        mutationFn: async () => {
            if (!id) return;
            return await api.callResource("jobs", {
                action: "cancel",
                id: id,
            });
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["job", id] });
            queryClient.invalidateQueries({ queryKey: ["jobs", "all"] });
            refetch();
        },
    });

    const rerunJobMutation = useMutation({
        mutationFn: async () => {
            if (!job) throw new Error("Job is not loaded");
            return await api.callResource("jobs", {
                action: "enqueue",
                data: job.data,
                trigger: {
                    type: "manual",
                    reason: `rerun:${job.id}`,
                },
            }) as { jobId: string };
        },
        onSuccess: (result) => {
            queryClient.invalidateQueries({ queryKey: ["jobs"] });
            navigate(`/jobs/${result.jobId}`);
        },
    });

    const handleCancel = async () => {
        if (!confirm("Cancel this job? An active worker process will be stopped.")) return;
        cancelJobMutation.mutate();
    };

    const handleRerun = () => {
        if (!confirm("Run a new job with the same input?")) return;
        rerunJobMutation.mutate();
    };
    const getStatusColor = (status: string) => {
        switch (status) {
            case "completed":
                return "bg-green-500/10 text-green-500";
            case "failed":
                return "bg-red-500/10 text-red-500";
            case "active":
                return "bg-blue-500/10 text-blue-500";
            case "waiting":
                return "bg-yellow-500/10 text-yellow-500";
            case "cancelled":
                return "bg-slate-500/10 text-slate-500";
            default:
                return "bg-gray-500/10 text-gray-500";
        }
    };

    const formatDuration = (start?: number, end?: number) => {
        if (!start || !end) return "-";
        const ms = end - start;
        if (ms < 0) return "-";
        if (ms < 1000) return `${ms}ms`;
        if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
        return `${(ms / 60000).toFixed(1)}m`;
    };

    if (isLoading) {
        return (
            <div className="container mx-auto p-6 space-y-6">
                <Skeleton className="h-10 w-64" />
                <Skeleton className="h-64 w-full" />
            </div>
        );
    }

    if (!job) {
        return (
            <div className="container mx-auto p-6">
                <Card>
                    <CardContent className="p-6">
                        <p className="text-muted-foreground">Job not found</p>
                        <Link to="/jobs">
                            <Button variant="outline" className="mt-4">
                                <ArrowLeft className="h-4 w-4 mr-2" />
                                Back to Jobs
                            </Button>
                        </Link>
                    </CardContent>
                </Card>
            </div>
        );
    }

    return (
        <div className="container mx-auto p-6 space-y-6">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <Link to="/jobs">
                        <Button variant="ghost" size="icon">
                            <ArrowLeft className="h-4 w-4" />
                        </Button>
                    </Link>
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight">Job Details</h1>
                        <p className="text-muted-foreground mt-1">
                            {job.id}
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => refetch()}
                        disabled={isRefreshing}
                    >
                        <RefreshCw className={`h-4 w-4 mr-2 ${isRefreshing ? "animate-spin" : ""}`} />
                        Refresh state
                    </Button>
                    {!["active", "waiting", "delayed"].includes(job.state) && (
                        <Button
                            variant="default"
                            size="sm"
                            onClick={handleRerun}
                            disabled={rerunJobMutation.isPending}
                        >
                            <Play className="h-4 w-4 mr-2" />
                            Run again
                        </Button>
                    )}
                    {["active", "waiting", "delayed"].includes(job.state) && (
                        <Button
                            variant="destructive"
                            size="sm"
                            onClick={handleCancel}
                            disabled={cancelJobMutation.isPending}
                        >
                            <Ban className="h-4 w-4 mr-2" />
                            Cancel Job
                        </Button>
                    )}
                </div>
            </div>

            <div className="grid gap-6 md:grid-cols-2">
                <Card>
                    <CardHeader>
                        <CardTitle>Status</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div>
                            <div className="text-sm text-muted-foreground mb-1">State</div>
                            <Badge className={getStatusColor(job.state)}>
                                {job.state}
                            </Badge>
                        </div>
                        <div>
                            <div className="text-sm text-muted-foreground mb-1">Queue state</div>
                            <div className="flex items-center gap-2">
                                <Badge variant="outline">
                                    {job.queuePresent ? (job.queueState || "unknown") : "not present"}
                                </Badge>
                                {job.state === "active" && job.queueState !== "active" && (
                                    <span className="text-xs text-amber-500">
                                        Database and queue states do not match
                                    </span>
                                )}
                            </div>
                        </div>
                        <div>
                            <div className="text-sm text-muted-foreground mb-1">Type</div>
                            <div className="font-medium">{job.type}</div>
                        </div>
                        {job.trigger && (
                            <div>
                                <div className="text-sm text-muted-foreground mb-1">Trigger</div>
                                <div className="flex flex-col gap-1">
                                    <Badge variant="outline" className="w-fit">
                                        {job.trigger.type}
                                    </Badge>
                                    {job.trigger.reason && (
                                        <div className="text-sm text-muted-foreground italic">
                                            {job.trigger.reason}
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                        {
                            job.result && (
                                <>
                                    {typeof job.result === "object" ? (
                                        <FieldDisplay fields={flattenNestedFields(job.result)} />
                                    ) : (
                                        <div className="font-medium">{String(job.result)}</div>
                                    )}

                                    {job.type === "summarization" && job.result?.objectId && (
                                        <Link to={`/objects/${job.result.objectId}`}>
                                            <Button className="mt-4">
                                                Go to Conversation
                                            </Button>
                                        </Link>
                                    )}
                                </>
                            )}

                        {job.failedReason && (
                            <JobErrorPanel failedReason={job.failedReason} />
                        )}

<div>
                            <div className="text-sm text-muted-foreground mb-1">Created</div>
                            <div className="text-sm">
                                {job.timestamp
                                    ? format(new Date(job.timestamp), "PPpp")
                                    : "-"}
                            </div>
                        </div>
                        {job.processedOn && (
                            <div>
                                <div className="text-sm text-muted-foreground mb-1">
                                    Started Processing
                                </div>
                                <div className="text-sm">
                                    {format(new Date(job.processedOn), "PPpp")}
                                </div>
                            </div>
                        )}
                        {job.finishedOn && (
                            <div>
                                <div className="text-sm text-muted-foreground mb-1">
                                    Finished
                                </div>
                                <div className="text-sm">
                                    {format(new Date(job.finishedOn), "PPpp")}
                                </div>
                            </div>
                        )}
                        {job.updatedOn && (
                            <div>
                                <div className="text-sm text-muted-foreground mb-1">
                                    Last state update
                                </div>
                                <div className="text-sm">
                                    {format(new Date(job.updatedOn), "PPpp")}
                                </div>
                            </div>
                        )}
                        <div>
                            <div className="text-sm text-muted-foreground mb-1">
                                Duration
                            </div>
                            <div className="text-sm">
                                {formatDuration(job.processedOn, job.finishedOn)}
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {job.data && (
                    <Card>
                        <CardHeader>
                            <CardTitle>Job Data</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <FieldDisplay fields={flattenNestedFields(job.data)} />
                        </CardContent>
                    </Card>
                )}
            </div>

            {job.type === "conversation_extractor" && job.modelProvenance && (
                <ModelProvenanceDetails entries={job.modelProvenance} />
            )}

            {/* Transcription Details Section */}
            {isTranscriptionJob && (
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <FileText className="h-5 w-5" />
                            Transcription Details
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        {isTranscriptionsLoading ? (
                            <Skeleton className="h-32 w-full" />
                        ) : transcriptions.length === 0 ? (
                            <div className="text-sm text-muted-foreground">
                                {job.state === "completed"
                                    ? "No transcriptions were created by this job (possibly empty audio or filtered out)"
                                    : "Transcription not yet available"}
                            </div>
                        ) : (
                            <div className="space-y-6">
                                {transcriptions.map((transcription) => {
                                    const linkedChunk = conversationChunks.find(
                                        c => c._id === transcription.chunk_id
                                    );
                                    const meta = transcription.metadata;

                                    return (
                                        <div key={transcription._id} className="space-y-4 border-b border-border/50 pb-6 last:border-b-0 last:pb-0">
                                            {/* Metadata Grid */}
                                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                                <MetricCell icon={Clock} label="Audio Duration" value={transcription.duration ? `${transcription.duration.toFixed(1)}s` : "-"} />
                                                <MetricCell icon={Hash} label="Word Count" value={meta?.wordCount ?? transcription.text.split(/\s+/).filter(w => w.length > 0).length} />
                                                <MetricCell icon={MessageSquare} label="Segments" value={meta?.segmentCount ?? transcription.segments?.length ?? 0} />
                                                <MetricCell icon={Clock} label="Processing Time" value={meta?.processingTimeMs ? `${(meta.processingTimeMs / 1000).toFixed(1)}s` : "-"} />
                                            </div>

                                            {/* Model and Language */}
                                            <div className="flex flex-wrap gap-2">
                                                {meta?.model && (
                                                    <Badge variant="outline">
                                                        Model: {meta.model}
                                                    </Badge>
                                                )}
                                                {meta?.language && (
                                                    <Badge variant="outline">
                                                        Language: {meta.language}
                                                    </Badge>
                                                )}
                                            </div>

                                            {/* Audio Player */}
                                            {transcription.start && (
                                                <ObjectAudioPlayer
                                                    timeRange={{
                                                        start: transcription.start,
                                                        end: transcription.end || new Date(new Date(transcription.start).getTime() + (transcription.duration || 60) * 1000).toISOString()
                                                    }}
                                                />
                                            )}

                                            {/* Linked Conversation Chunk */}
                                            {linkedChunk && (
                                                <div>
                                                    <div className="text-xs text-muted-foreground mb-1">Linked to Conversation Chunk</div>
                                                    <Badge variant="secondary" className="font-mono text-xs">
                                                        {linkedChunk._id}
                                                    </Badge>
                                                </div>
                                            )}

                                            {/* Transcription Text */}
                                            <div>
                                                <div className="text-sm text-muted-foreground mb-2">Transcription Text</div>
                                                <div className="bg-muted/50 rounded-lg p-4 max-h-64 overflow-y-auto">
                                                    <p className="text-sm whitespace-pre-wrap leading-relaxed">
                                                        {transcription.text || "No text available"}
                                                    </p>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </CardContent>
                </Card>
            )}

            {/* Job-type-specific details sections (non-transcription) */}
            {job.state === "completed" && job.result && job.type !== "transcription" && (() => {
                const r = job.result;
                const batchSummaries = job.type === "summarization" && Array.isArray(r.summaries)
                    ? r.summaries.filter((summary: any) => summary?.objectId)
                    : [];
                const processingTime = formatDuration(job.processedOn, job.finishedOn);
                const dateRange = job.data?.start && job.data?.end
                    ? `${format(new Date(job.data.start), "PPp")} — ${format(new Date(job.data.end), "PPp")}`
                    : job.data?.start
                        ? `from ${format(new Date(job.data.start), "PPp")}`
                        : null;

                const configs: Record<string, { icon: LucideIcon; title: string; metrics: Array<{ icon: LucideIcon; label: string; value: React.ReactNode }>; errors?: any[] }> = {
                    vad: {
                        icon: Volume2, title: "VAD Details",
                        metrics: [
                            { icon: Clock, label: "Processing Time", value: processingTime },
                            { icon: Hash, label: "Processed", value: `${r.processed ?? 0} / ${r.total ?? 0}` },
                            { icon: Volume2, label: "With Speech", value: r.hasSpeech ?? 0 },
                            { icon: Clock, label: "Duration", value: r.duration != null ? `${r.duration.toFixed(1)}s` : "-" },
                        ],
                    },
                    conversation_chunk_creator: {
                        icon: Layers, title: "Chunk Creator Details",
                        metrics: [
                            { icon: Clock, label: "Processing Time", value: processingTime },
                            { icon: Layers, label: "Chunks Created", value: r.chunksCreated ?? 0 },
                            { icon: Hash, label: "Finalized", value: r.finalized ?? 0 },
                            { icon: Hash, label: "Streamed", value: r.streamed ?? 0 },
                            ...(r.backfilled ? [{ icon: Hash as LucideIcon, label: "Backfilled", value: r.backfilled }] : []),
                        ],
                    },
                    conversation_extractor: {
                        icon: Users, title: "Conversation Extractor Details",
                        metrics: [
                            { icon: Clock, label: "Processing Time", value: processingTime },
                            { icon: MessageSquare, label: "Conversations Created", value: r.conversationsCreated ?? 0 },
                            { icon: Layers, label: "Chunks Processed", value: r.chunksProcessed ?? 0 },
                            { icon: Hash, label: "Segments Found", value: r.segmentsFound ?? (r.artifacts ? 0 : "Legacy: unavailable") },
                            { icon: MessageSquare, label: "Emoji Extracted", value: r.emojiCount ?? (r.artifacts ? 0 : "Legacy: unavailable") },
                            { icon: Users, label: "Entities Extracted", value: r.entityCount ?? (r.artifacts ? 0 : "Legacy: unavailable") },
                            { icon: ExternalLink, label: "Entity Links", value: r.relationshipsCreated != null ? `${r.relationshipsCreated} / ${r.relationshipsAttempted ?? 0}` : "Legacy: unavailable" },
                            { icon: AlertTriangle, label: "Link Errors", value: r.relationshipErrors ?? (r.artifacts ? 0 : "Legacy: unavailable") },
                            { icon: Check, label: "Agreements Detected", value: r.agreementCount ?? (r.artifacts ? 0 : "Legacy: unavailable") },
                            { icon: Hash, label: "Has More", value: r.hasMore ? "Yes" : "No" },
                        ],
                        errors: r.errors,
                    },
                    transcription_sequence_creator: {
                        icon: Layers, title: "Sequence Creator Details",
                        metrics: [
                            { icon: Clock, label: "Processing Time", value: processingTime },
                            { icon: Hash, label: "Chunks Processed", value: r.processed ?? 0 },
                            { icon: Layers, label: "Has More", value: r.hasMore ? "Yes" : "No" },
                        ],
                    },
                    tagger: {
                        icon: Tag, title: "Tagger Details",
                        metrics: [
                            { icon: Clock, label: "Processing Time", value: processingTime },
                            { icon: MessageSquare, label: "Conversations Processed", value: r.conversationsProcessed ?? 0 },
                            { icon: Tag, label: "Tags Applied", value: r.tagsApplied ?? 0 },
                            { icon: Hash, label: "Has More", value: r.hasMore ? "Yes" : "No" },
                        ],
                        errors: r.errors,
                    },
                    summarization: {
                        icon: FileText, title: batchSummaries.length > 0 ? "Batch Summarization" : "Summarization Details",
                        metrics: [
                            { icon: Clock, label: "Processing Time", value: processingTime },
                            ...(batchSummaries.length > 0 ? [{ icon: FileText as LucideIcon, label: "Summaries Created", value: batchSummaries.length }] : []),
                            ...(r.processed != null ? [{ icon: Check as LucideIcon, label: "Processed", value: r.processed }] : []),
                            ...(r.skipped != null && r.skipped > 0 ? [{ icon: AlertTriangle as LucideIcon, label: "Skipped", value: r.skipped }] : []),
                            ...(r.title ? [{ icon: FileText as LucideIcon, label: "Title", value: r.title }] : []),
                            ...(r.start && r.end ? [{ icon: Clock as LucideIcon, label: "Time Range", value: `${format(new Date(r.start), "PPp")} — ${format(new Date(r.end), "PPp")}` }] : []),
                            ...(r.inference?.mixed && Array.isArray(r.inference?.byProvider)
                                ? [{
                                    icon: BarChart3 as LucideIcon,
                                    label: "LLM routes (per call)",
                                    value: r.inference.byProvider.map((entry: any) =>
                                        `${entry.providerProfileName || entry.providerProfileId} ×${entry.calls}${entry.resolvedModel ? ` (${entry.resolvedModel})` : ""}`
                                    ).join(" + "),
                                }]
                                : r.inference?.providerProfileName
                                ? [{
                                    icon: BarChart3 as LucideIcon,
                                    label: "LLM route",
                                    value: `${r.inference.providerProfileName}${r.inference.resolvedModel ? ` · ${r.inference.resolvedModel}` : ""}`,
                                }]
                                : []),
                        ],
                        errors: r.errors,
                    },
                    diarization: {
                        icon: Users, title: "Diarization Details",
                        metrics: [
                            { icon: Clock, label: "Processing Time", value: processingTime },
                            { icon: Layers, label: "Sequences Processed", value: r.sequences_processed ?? 0 },
                            { icon: Hash, label: "Chunks Processed", value: r.chunks_processed ?? 0 },
                            { icon: Users, label: "Segments Created", value: r.segments_created ?? 0 },
                            ...(r.errors != null && r.errors > 0 ? [{ icon: AlertTriangle as LucideIcon, label: "Errors", value: r.errors }] : []),
                        ],
                    },
                    histRecalculation: {
                        icon: BarChart3, title: "Histogram Recalculation Details",
                        metrics: [
                            { icon: Clock, label: "Processing Time", value: processingTime },
                            { icon: Hash, label: "Processed", value: r.processed ?? 0 },
                            ...(r.marked != null ? [{ icon: BarChart3 as LucideIcon, label: "Marked Stale", value: r.marked }] : []),
                        ],
                    },
                    speakerMatching: {
                        icon: Users, title: "Speaker Matching Details",
                        metrics: [
                            { icon: Clock, label: "Processing Time", value: processingTime },
                            { icon: Hash, label: "Processed", value: r.processed ?? 0 },
                            { icon: Users, label: "Matched", value: r.matched ?? 0 },
                            { icon: Users, label: "Profiles", value: r.profiles_count ?? 0 },
                        ],
                    },
                    enrollment: {
                        icon: Users, title: "Enrollment Details",
                        metrics: [
                            { icon: Clock, label: "Processing Time", value: processingTime },
                            ...(r.profile_name ? [{ icon: Users as LucideIcon, label: "Profile", value: r.profile_name }] : []),
                            { icon: Hash, label: "Samples", value: r.sample_count ?? 0 },
                            { icon: Clock, label: "Total Duration", value: r.total_duration != null ? `${r.total_duration.toFixed(1)}s` : "-" },
                        ],
                    },
                };

                const config = configs[job.type];
                if (!config) return null;
                const IconComponent = config.icon;

                return (
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <IconComponent className="h-5 w-5" />
                                {config.title}
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {dateRange && (
                                <div className="text-sm text-muted-foreground">
                                    <span className="text-xs uppercase tracking-wide">Date Range:</span> {dateRange}
                                </div>
                            )}
                            {job.type === "conversation_extractor" && r.description && (
                                <div className="rounded-lg bg-muted/50 p-3 text-sm">
                                    {r.description}
                                </div>
                            )}
                            {job.type === "conversation_chunk_creator" &&
                                (r.processed ?? 0) === 0 && (
                                <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
                                    <div className="font-medium">Scheduled check — no work due</div>
                                    <div className="mt-1 text-muted-foreground">
                                        No unassigned transcriptions or stale open chunks were found. No chunk was changed and no LLM was called.
                                    </div>
                                </div>
                            )}
                            {job.type === "conversation_extractor" &&
                                (r.chunksProcessed ?? 0) === 0 && (
                                <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
                                    <div className="font-medium">Idle check — no LLM call</div>
                                    <div className="mt-1 text-muted-foreground">
                                        No ready conversation chunks were available, so the worker exited without running extraction.
                                    </div>
                                </div>
                            )}
                            {job.type === "conversation_extractor" &&
                                (r.chunksProcessed ?? 0) > 0 &&
                                (r.conversationsCreated ?? 0) === 0 && (
                                <div className="rounded-lg border border-sky-500/30 bg-sky-500/5 p-3 text-sm">
                                    <div className="font-medium text-sky-500">Useful negative result — decision saved</div>
                                    <div className="mt-1 text-muted-foreground">
                                        Segmentation examined the chunk and found no usable conversation. The chunk is stored as empty with model provenance, so automatic extraction will not retry it. Metadata extraction was skipped; no conversation, emoji, entity, agreement, or link objects were created.
                                    </div>
                                </div>
                            )}
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                {config.metrics.map((m) => (
                                    <MetricCell key={m.label} icon={m.icon} label={m.label} value={m.value} />
                                ))}
                            </div>
                            {job.type === "summarization" &&
                                Array.isArray(r.skips) && r.skips.length > 0 && (
                                <div>
                                    <div className="flex items-center gap-2 text-sm text-amber-500 mb-2">
                                        <AlertTriangle className="h-4 w-4" />
                                        {r.skips.length} skipped (already summarized or claimed)
                                    </div>
                                    <div className="bg-amber-500/5 rounded-lg p-3 space-y-2 max-h-48 overflow-y-auto">
                                        {r.skips.map((skip: string, idx: number) => (
                                            <div key={idx} className="text-xs text-amber-500/90">
                                                {skip}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                            {config.errors && config.errors?.length > 0 && (
                                <div>
                                    <div className="flex items-center gap-2 text-sm text-red-500 mb-2">
                                        <AlertTriangle className="h-4 w-4" />
                                        {config.errors.length} error{config.errors.length !== 1 ? "s" : ""}
                                    </div>
                                    <div className="bg-red-500/5 rounded-lg p-3 space-y-2 max-h-48 overflow-y-auto">
                                        {config.errors.map((err: any, idx: number) => (
                                            <div key={idx} className="text-xs text-red-400">
                                                {typeof err === "string"
                                                    ? err
                                                    : (
                                                        <>
                                                            <span className="font-medium">{err.type}:</span> {err.message}
                                                        </>
                                                    )}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                            {job.type === "conversation_extractor" && Array.isArray(r.artifacts) && (
                                <div>
                                    <div className="text-sm text-muted-foreground mb-2">
                                        Extracted Artifacts ({r.artifacts.length})
                                    </div>
                                    {r.artifacts.length === 0 ? (
                                        <div className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
                                            No conversations or metadata artifacts were extracted.
                                        </div>
                                    ) : (
                                        <div className="space-y-2">
                                            {r.artifacts.map((artifact: any) => (
                                                <div key={artifact.conversationId} className="rounded-lg border p-3 text-sm">
                                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                                        <Link className="font-medium hover:underline" to={`/objects/${artifact.conversationId}`}>
                                                            {artifact.emoji || "◻︎"} {artifact.title || artifact.conversationId}
                                                        </Link>
                                                        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                                                            <span>{artifact.entities?.length ?? 0} entities</span>
                                                            <span>{artifact.relationshipsCreated ?? 0}/{artifact.relationshipsAttempted ?? 0} links</span>
                                                            <span>{artifact.relationshipErrors ?? 0} link errors</span>
                                                            <span>{artifact.agreementDetected ? "agreement: yes" : "agreement: no"}</span>
                                                        </div>
                                                    </div>
                                                    <div className="mt-2 flex flex-wrap gap-1.5">
                                                        {(artifact.entities ?? []).length === 0 ? (
                                                            <Badge variant="outline">0 entities</Badge>
                                                        ) : artifact.entities.map((entity: string) => (
                                                            <Badge key={entity} variant="secondary">{entity}</Badge>
                                                        ))}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}
                            {job.type === "conversation_extractor" && extractedChunks.length > 0 && (
                                <div>
                                    <div className="text-sm text-muted-foreground mb-2">
                                        Processed Chunks ({extractedChunks.length})
                                    </div>
                                    <div className="space-y-2">
                                        {extractedChunks.map((chunk) => {
                                            const chunkId = formatValue(chunk._id).replace(/^"(.*)"$/, "$1");
                                            return (
                                                <div key={chunkId} className="rounded-lg border p-3 text-sm">
                                                <div className="flex flex-wrap items-center justify-between gap-2">
                                                    <code className="text-xs">{chunkId}</code>
                                                    <Badge variant={chunk.state === "empty" ? "secondary" : "outline"}>
                                                        {chunk.state ?? "unknown"}
                                                    </Badge>
                                                </div>
                                                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                                                    <span>{chunk.transcriptionCount ?? 0} transcriptions</span>
                                                    <span>{chunk.totalTextLength ?? 0} characters</span>
                                                    <span>{chunk.segmentsFound ?? 0} segments</span>
                                                    <span>{chunk.conversationsCreated ?? 0} conversations</span>
                                                    {chunk.start && chunk.end && (
                                                        <Link
                                                            className="text-primary hover:underline"
                                                            to={`/timeline?start=${new Date(chunk.start).getTime()}&end=${new Date(chunk.end).getTime()}`}
                                                        >
                                                            Open time range
                                                        </Link>
                                                    )}
                                                </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}
                            {job.type === "summarization" && batchSummaries.length > 0 && (
                                <div>
                                    <div className="text-sm text-muted-foreground mb-2">
                                        Created summaries ({batchSummaries.length})
                                    </div>
                                    <div className="space-y-2 max-h-[32rem] overflow-y-auto pr-1">
                                        {batchSummaries.map((summary: any) => (
                                            <div key={summary.objectId} className="rounded-lg border p-3 text-sm">
                                                <div className="flex flex-wrap items-center justify-between gap-2">
                                                    <Link className="font-medium hover:underline" to={`/objects/${summary.objectId}`}>
                                                        {summary.title || summary.objectId}
                                                    </Link>
                                                    <Link to={`/objects/${summary.objectId}`}>
                                                        <Button size="sm" variant="outline">
                                                            <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                                                            View Conversation
                                                        </Button>
                                                    </Link>
                                                </div>
                                                {summary.sourceRefs?.coverageStart && summary.sourceRefs?.coverageEnd && (
                                                    <div className="mt-1 text-xs text-muted-foreground">
                                                        {format(new Date(summary.sourceRefs.coverageStart), "PPp")} — {format(new Date(summary.sourceRefs.coverageEnd), "p")}
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                            {job.type === "summarization" && r.objectId && (
                                <Link to={`/objects/${r.objectId}`}>
                                    <Button size="sm" variant="outline" className="mt-2">
                                        <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                                        View Conversation
                                    </Button>
                                </Link>
                            )}
                            {job.type === "summarization" && r.description && (
                                <div>
                                    <div className="text-sm text-muted-foreground mb-2">Description</div>
                                    <div className="bg-muted/50 rounded-lg p-4 max-h-48 overflow-y-auto">
                                        <p className="text-sm whitespace-pre-wrap leading-relaxed">{r.description}</p>
                                    </div>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                );
            })()}

            <Card>
                <CardHeader>
                    <CardTitle>Logs</CardTitle>
                </CardHeader>
                <CardContent>
                    {isLogsLoading ? (
                        <Skeleton className="h-48 w-full" />
                    ) : jobLogs.length === 0 ? (
                        <div className="text-sm text-muted-foreground">No logs yet</div>
                    ) : (
                        <div className="max-h-96 overflow-auto space-y-2 font-mono text-xs">
                            {jobLogs.map((log, index) => {
                                const timestampDate = log.timestamp ? new Date(log.timestamp) : null;
                                const timestamp = timestampDate && !isNaN(timestampDate.getTime())
                                    ? format(timestampDate, "PPpp")
                                    : "-";
                                const isLegacyProgress = log.text.startsWith("__PROGRESS__:");
                                const displayStream = isLegacyProgress ? "progress" : log.stream;
                                const streamStyle = displayStream === "stderr"
                                    ? "text-red-500"
                                    : displayStream === "progress"
                                    ? "text-blue-500"
                                    : "text-muted-foreground";
                                return (
                                    <div
                                        key={log._id ?? `${log.timestamp}-${index}`}
                                        className="flex flex-col gap-1 border-b border-border/50 pb-2 last:border-b-0"
                                    >
                                        <div className="flex items-center gap-2">
                                            <Badge variant="outline">{displayStream}</Badge>
                                            <span className="text-xs text-muted-foreground">{timestamp}</span>
                                        </div>
                                        <div className={`whitespace-pre-wrap break-words ${streamStyle}`}>
                                            {log.text}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Access Logs</CardTitle>
                </CardHeader>
                <CardContent>
                    {isAccessLogsLoading ? (
                        <Skeleton className="h-48 w-full" />
                    ) : accessLogs.length === 0 ? (
                        <div className="text-sm text-muted-foreground">No access logs yet</div>
                    ) : (
                        <div className="max-h-96 overflow-auto space-y-3">
                            {accessLogs.map((log) => {
                                const timestampDate = log.timestamp ? new Date(log.timestamp) : null;
                                const timestamp = timestampDate && !isNaN(timestampDate.getTime())
                                    ? format(timestampDate, "PPpp")
                                    : "-";
                                return (
                                    <div
                                        key={log._id}
                                        className="border-b border-border/50 pb-3 last:border-b-0"
                                    >
                                        <div className="flex items-center justify-between mb-2">
                                            <div className="flex items-center gap-2">
                                                <Badge variant="outline">{log.resource}</Badge>
                                            </div>
                                            <span className="text-xs text-muted-foreground">{timestamp}</span>
                                        </div>
                                        <div className="flex flex-wrap gap-2">
                                            {log.actions.map((action, idx) => (
                                                <div
                                                    key={idx}
                                                    className="text-xs bg-muted rounded px-2 py-1"
                                                >
                                                    <span className="font-mono">
                                                        {action.path.join(".")}
                                                    </span>
                                                    <span className="mx-1">:</span>
                                                    <span>{action.actions.join(", ")}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
