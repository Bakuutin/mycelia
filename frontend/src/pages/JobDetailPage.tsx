import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "react-router-dom";
import { format } from "date-fns";
import { api } from "@/lib/api";
import { useWebSocketSubscription } from "@/hooks/useWebSocket";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

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

type JobInfo = {
    id: string;
    name?: string;
    type: string;
    data: any;
    state: string;
    progress: any;
    result?: any;
    timestamp: number;
    processedOn?: number;
    finishedOn?: number;
    failedReason?: string;
    attemptsMade?: number;
};

export default function JobDetailPage() {
    const { id } = useParams<{ id: string }>();
    const jobType = new URLSearchParams(window.location.search).get("type");

    const { data: job, isLoading, refetch, isRefetching } = useQuery({
        queryKey: ["job", id, jobType],
        queryFn: async () => {
            if (!id || !jobType) {
                throw new Error("Job ID and type are required");
            }
            const response = await api.get<JobInfo>(
                `/api/jobs/${id}?type=${jobType}`
            );
            return response;
        },
        enabled: !!id && !!jobType,
    });

    useWebSocketSubscription(`jobs:${id}`, (event) => {
        if (event.event && event.event.startsWith("job.")) {
            refetch();
        }
    });

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
                            <div className="text-sm text-red-500">{job.failedReason}</div>

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
        </div>
    );
}

