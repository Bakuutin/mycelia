import { useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { useState, useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { useJobsListener } from "@/hooks/useJobsListener";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { RefreshCw, Trash2, Play } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import type { JobInfo } from "@/types/jobs";

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
  const queryClient = useQueryClient();

  const { jobs, isLoading } = useJobsListener();

  const filteredJobs = useMemo(() => {
    let result = jobs;
    if (filterType !== "all") {
      result = result.filter(j => j.type === filterType);
    }
    return result.slice(0, limit);
  }, [jobs, filterType, limit]);

  const refetch = () => {
    queryClient.invalidateQueries({ queryKey: ["jobs", "all"] });
  };

  const createTestJobMutation = useMutation({
    mutationFn: async () => {
      return await api.callResource("jobs", {
        action: "enqueue",
        data: { type: "testPythonIntegration" },
      });
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

  const [currentTime, setCurrentTime] = useState(Date.now());

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(Date.now());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const formatDuration = (start?: number, end?: number) => {
    if (!start) return "-";
    const endTime = end || currentTime;
    const ms = endTime - start;
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return `${minutes}m ${seconds}s`;
  };

  const getProgressPercentage = (progress: any): number | null => {
    if (!progress || typeof progress !== "object") return null;
    if (typeof progress.progress === "number") return progress.progress;
    if (typeof progress.processed === "number" && typeof progress.total === "number") {
      return progress.total > 0 ? (progress.processed / progress.total) * 100 : 0;
    }
    if (typeof progress.iteration === "number" && typeof progress.total === "number") {
      return progress.total > 0 ? (progress.iteration / progress.total) * 100 : 0;
    }
    return null;
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
      await api.callResource("jobs", {
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
            variant="default"
            size="sm"
            asChild
          >
            <Link to="/jobs/new">
              <Play className="h-4 w-4 mr-2" />
              Launch Job
            </Link>
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={() => createTestJobMutation.mutate()}
            disabled={createTestJobMutation.isPending}
          >
            <Play className="h-4 w-4 mr-2" />
            Test Python Integration
          </Button>
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
          >
            <RefreshCw
              className="h-4 w-4 mr-2"
            />
            Refresh
          </Button>
        </div>
      </div>


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
                <SelectItem value="testPythonIntegration">
                  Test Python Integration
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
              ) : filteredJobs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8">
                    No jobs found
                  </TableCell>
                </TableRow>
              ) : (
                filteredJobs.map((job) => (
                  <TableRow key={job.id}>
                    <TableCell>
                      <Link
                        to={`/jobs/${job.id}`}
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
                        to={`/jobs/${job.id}`}
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
                        <div className="space-y-2">
                          {(() => {
                            const percentage = getProgressPercentage(job.progress);
                            return (
                              <>
                                {percentage !== null && (
                                  <Progress value={percentage} className="h-2" />
                                )}
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
                              </>
                            );
                          })()}
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

