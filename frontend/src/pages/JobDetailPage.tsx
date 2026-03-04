import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, Link } from "react-router-dom";
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
import { ArrowLeft, Ban, FileText, Clock, Hash, MessageSquare, ExternalLink, Users, Layers, AlertTriangle, Volume2, Tag, BarChart3, type LucideIcon } from "lucide-react";
import { ObjectAudioPlayer } from "@/components/ObjectAudioPlayer";
import { Skeleton } from "@/components/ui/skeleton";
import type { JobInfo, JobLogEntry, JobAccessLogEntry } from "@/types/jobs";
import { parseJobError } from "@/lib/jobs";

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
    _id: string;
    text?: string;
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

function MetricCell({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string | number | boolean | null | undefined }) {
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

export default function JobDetailPage() {
    const { id } = useParams<{ id: string }>();
    const { getJobById, isLoading: isListenerLoading } = useJobsListener();
    const queryClient = useQueryClient();
    
    const cachedJob = id ? getJobById(id) : null;

    const { data: fetchedJob, isLoading: isFetching, refetch } = useQuery({
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
        enabled: !!id && !cachedJob,
    });

    const job = cachedJob || fetchedJob;
    const isTranscriptionJob = job?.type === "transcription";
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
                    stream: (data.stream as "stdout" | "stderr") ?? "stdout",
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
        },
    });

    const handleCancel = async () => {
        if (!confirm("Are you sure you want to cancel this job?")) return;
        cancelJobMutation.mutate();
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

                        {job.failedReason && (() => {
                            const parsed = parseJobError(job.failedReason);
                            return (
                                <div className="space-y-2">
                                    {parsed && (
                                        <div className="flex items-center gap-2">
                                            <Badge className="bg-red-500/10 text-red-500">
                                                {parsed.label}
                                            </Badge>
                                            <span className="text-sm text-red-400">{parsed.detail}</span>
                                        </div>
                                    )}
                                    <details className="group">
                                        <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                                            Full error message
                                        </summary>
                                        <div className="mt-2 bg-red-500/5 rounded-lg p-3 max-h-48 overflow-y-auto">
                                            <pre className="text-xs text-red-400 whitespace-pre-wrap break-words">{job.failedReason}</pre>
                                        </div>
                                    </details>
                                </div>
                            );
                        })()}

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
                        icon: FileText, title: "Summarization Details",
                        metrics: [
                            { icon: Clock, label: "Processing Time", value: processingTime },
                            ...(r.title ? [{ icon: FileText as LucideIcon, label: "Title", value: r.title }] : []),
                            ...(r.start && r.end ? [{ icon: Clock as LucideIcon, label: "Time Range", value: `${format(new Date(r.start), "PPp")} — ${format(new Date(r.end), "PPp")}` }] : []),
                        ],
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
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                {config.metrics.map((m) => (
                                    <MetricCell key={m.label} icon={m.icon} label={m.label} value={m.value} />
                                ))}
                            </div>
                            {config.errors?.length > 0 && (
                                <div>
                                    <div className="flex items-center gap-2 text-sm text-red-500 mb-2">
                                        <AlertTriangle className="h-4 w-4" />
                                        {config.errors.length} error{config.errors.length !== 1 ? "s" : ""}
                                    </div>
                                    <div className="bg-red-500/5 rounded-lg p-3 space-y-2 max-h-48 overflow-y-auto">
                                        {config.errors.map((err: any, idx: number) => (
                                            <div key={idx} className="text-xs text-red-400">
                                                <span className="font-medium">{err.type}:</span> {err.message}
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
                                const streamStyle = log.stream === "stderr"
                                    ? "text-red-500"
                                    : "text-muted-foreground";
                                return (
                                    <div
                                        key={log._id ?? `${log.timestamp}-${index}`}
                                        className="flex flex-col gap-1 border-b border-border/50 pb-2 last:border-b-0"
                                    >
                                        <div className="flex items-center gap-2">
                                            <Badge variant="outline">{log.stream}</Badge>
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

