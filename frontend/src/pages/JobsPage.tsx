import { useQuery, useMutation } from "@tanstack/react-query";
import { format } from "date-fns";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { useWebSocketSubscription } from "@/hooks/useWebSocket";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { RefreshCw, Trash2, Play } from "lucide-react";
import { DateTimePicker } from "@/components/ui/datetime-picker";
import { FormField } from "@/components/forms/FormField";

type JobInfo = {
  id: string;
  type: string;
  data: any;
  state: string;
  progress: any;
  result?: any;
  timestamp: number;
  finishedOn?: number;
  processedOn?: number;
  failedReason?: string;
};

type VadJobFormData = {
  limit: number;
  batchSize: number;
  originalId?: string;
  start?: Date;
  end?: Date;
};

export default function JobsPage() {
  const [filterType, setFilterType] = useState<string>("all");
  const [limit, setLimit] = useState<number>(50);

  const [vadFormData, setVadFormData] = useState<VadJobFormData>({
    limit: 1000,
    batchSize: 100,
  });

  const launchVadMutation = useMutation({
    mutationFn: async (data: VadJobFormData) => {
      const jobData: any = {
        type: "vad",
        limit: data.limit,
        batchSize: data.batchSize,
      };

      if (data.originalId) {
        jobData.originalId = data.originalId;
      }
      if (data.start) {
        jobData.start = data.start.toISOString();
      }
      if (data.end) {
        jobData.end = data.end.toISOString();
      }

      const response = await api.post("/api/jobs", jobData);
      return response.data;
    },
    onSuccess: () => {
      setVadFormData({
        limit: 1000,
        batchSize: 100,
      });
      refetch();
    },
  });

  const handleLaunchVad = (e: React.FormEvent) => {
    e.preventDefault();

    if (vadFormData.limit < 1 || vadFormData.limit > 10000) {
      alert("Limit must be between 1 and 10000");
      return;
    }

    if (vadFormData.batchSize < 1 || vadFormData.batchSize > 1000) {
      alert("Batch size must be between 1 and 1000");
      return;
    }

    launchVadMutation.mutate(vadFormData);
  };

  const { data: jobs, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ["jobs", filterType, limit],
    queryFn: async () => {
      const response = await api.callResource("worker_progress", {
        action: "list",
        limit,
        types: filterType === "all" ? undefined : [filterType],
      });
      return response as JobInfo[];
    },
  });

  useWebSocketSubscription("jobs:*", (event) => {
    if (event.event && event.event.startsWith("job.")) {
      refetch();
    }
  });

  const getStatusColor = (status: string) => {
    switch (status) {
      case "completed":
        return "bg-green-500/10 text-green-500 hover:bg-green-500/20";
      case "failed":
        return "bg-red-500/10 text-red-500 hover:bg-red-500/20";
      case "active":
        return "bg-blue-500/10 text-blue-500 hover:bg-blue-500/20";
      case "waiting":
        return "bg-yellow-500/10 text-yellow-500 hover:bg-yellow-500/20";
      default:
        return "bg-gray-500/10 text-gray-500 hover:bg-gray-500/20";
    }
  };

  const formatDuration = (start?: number, end?: number) => {
    if (!start || !end) return "-";
    const ms = end - start;
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  const handleCancelAll = async () => {
    if (
      !confirm(
        "Are you sure you want to cancel all running jobs and clear queues? This action cannot be undone."
      )
    ) {
      return;
    }

    try {
      await api.callResource("worker_progress", {
        action: "cancel_all",
      });
      refetch();
    } catch (error) {
      console.error("Failed to cancel jobs:", error);
      alert("Failed to cancel jobs");
    }
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">System Jobs</h1>
        <div className="flex items-center gap-2">
          <Button
            variant="destructive"
            size="sm"
            onClick={handleCancelAll}
          >
            <Trash2 className="h-4 w-4 mr-2" />
            Cancel All
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isRefetching}
          >
            <RefreshCw
              className={`h-4 w-4 mr-2 ${isRefetching ? "animate-spin" : ""}`}
            />
            Refresh
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Launch VAD Job</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLaunchVad} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField
                label="Limit"
                htmlFor="vad-limit"
                error={
                  vadFormData.limit < 1 || vadFormData.limit > 10000
                    ? "Must be between 1 and 10000"
                    : undefined
                }
              >
                <Input
                  id="vad-limit"
                  type="number"
                  value={vadFormData.limit}
                  onChange={(e) =>
                    setVadFormData({
                      ...vadFormData,
                      limit: parseInt(e.target.value) || 0,
                    })
                  }
                  placeholder="1000"
                />
              </FormField>

              <FormField
                label="Batch Size"
                htmlFor="vad-batch-size"
                error={
                  vadFormData.batchSize < 1 || vadFormData.batchSize > 1000
                    ? "Must be between 1 and 1000"
                    : undefined
                }
              >
                <Input
                  id="vad-batch-size"
                  type="number"
                  value={vadFormData.batchSize}
                  onChange={(e) =>
                    setVadFormData({
                      ...vadFormData,
                      batchSize: parseInt(e.target.value) || 0,
                    })
                  }
                  placeholder="100"
                />
              </FormField>
            </div>

            <FormField
              label="Original ID (Optional)"
              htmlFor="vad-original-id"
            >
              <Input
                id="vad-original-id"
                value={vadFormData.originalId || ""}
                onChange={(e) =>
                  setVadFormData({
                    ...vadFormData,
                    originalId: e.target.value || undefined,
                  })
                }
                placeholder="Filter by specific audio file"
              />
            </FormField>

            <div className="grid grid-cols-2 gap-4">
              <FormField
                label="Start Date (Optional)"
                htmlFor="vad-start"
              >
                <DateTimePicker
                  value={vadFormData.start}
                  onChange={(date) =>
                    setVadFormData({
                      ...vadFormData,
                      start: date,
                    })
                  }
                  placeholder="No start date filter"
                />
              </FormField>

              <FormField
                label="End Date (Optional)"
                htmlFor="vad-end"
              >
                <DateTimePicker
                  value={vadFormData.end}
                  onChange={(date) =>
                    setVadFormData({
                      ...vadFormData,
                      end: date,
                    })
                  }
                  placeholder="No end date filter"
                />
              </FormField>
            </div>

            <Button
              type="submit"
              disabled={launchVadMutation.isPending}
              className="w-full"
            >
              {launchVadMutation.isPending ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  Launching...
                </>
              ) : (
                <>
                  <Play className="h-4 w-4 mr-2" />
                  Launch VAD Job
                </>
              )}
            </Button>

            {launchVadMutation.isError && (
              <div className="text-sm text-red-500">
                Failed to launch job:{" "}
                {launchVadMutation.error instanceof Error
                  ? launchVadMutation.error.message
                  : "Unknown error"}
              </div>
            )}

            {launchVadMutation.isSuccess && (
              <div className="text-sm text-green-500">
                Job launched successfully! Job ID:{" "}
                {launchVadMutation.data?.jobId}
              </div>
            )}
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Filters</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center gap-4">
          <div className="w-[200px]">
            <Select value={filterType} onValueChange={setFilterType}>
              <SelectTrigger>
                <SelectValue placeholder="Job Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="vad">VAD</SelectItem>
                <SelectItem value="transcription">Transcription</SelectItem>
                <SelectItem value="diarization">Diarization</SelectItem>
                <SelectItem value="ingestion">Ingestion</SelectItem>
                <SelectItem value="histRecalculation">
                  Pipeline Recalculation
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="w-[100px]">
            <Select value={limit.toString()} onValueChange={(v) => setLimit(parseInt(v))}>
              <SelectTrigger>
                <SelectValue placeholder="Limit" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="20">20</SelectItem>
                <SelectItem value="50">50</SelectItem>
                <SelectItem value="100">100</SelectItem>
                <SelectItem value="500">500</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Status</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Job ID</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Progress</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8">
                    Loading jobs...
                  </TableCell>
                </TableRow>
              ) : jobs?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8">
                    No jobs found
                  </TableCell>
                </TableRow>
              ) : (
                jobs?.map((job) => (
                  <TableRow key={job.id}>
                    <TableCell>
                      <Link
                        to={`/jobs/${job.id}?type=${job.type}`}
                      >
                        <Badge
                          variant="secondary"
                          className={getStatusColor(job.state)}
                        >
                          {job.state}
                        </Badge>
                      </Link>
                    </TableCell>
                    <TableCell className="font-medium">{job.type}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      <Link
                        to={`/jobs/${job.id}?type=${job.type}`}
                      >
                        {job.id}
                      </Link>
                    </TableCell>
                    <TableCell className="text-sm">
                      {job.timestamp
                        ? format(new Date(job.timestamp), "MMM d, HH:mm:ss")
                        : "-"}
                    </TableCell>
                    <TableCell className="text-sm">
                      {formatDuration(job.processedOn, job.finishedOn)}
                    </TableCell>
                    <TableCell>
                      {job.progress ? (
                        <div className="text-xs space-y-1">
                          {typeof job.progress === "object" ? (
                            Object.entries(job.progress)
                              .slice(0, 3)
                              .map(([k, v]) => (
                                <div key={k}>
                                  <span className="opacity-70">{k}:</span>{" "}
                                  {String(v)}
                                </div>
                              ))
                          ) : (
                            <span>{String(job.progress)}</span>
                          )}
                        </div>
                      ) : (
                        "-"
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

