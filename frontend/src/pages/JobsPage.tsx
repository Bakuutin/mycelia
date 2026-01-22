import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { RefreshCw, Trash2, Play, Search, ChevronDown, ArrowUpDown, ArrowUp, ArrowDown, Pause, PlayCircle, PauseCircle } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import type { JobInfo } from "@/types/jobs";

type WorkerStatus = {
  workers: Record<string, { paused: boolean }>;
};

type VadJobFormData = {
  limit: number;
  batchSize: number;
  originalId?: string;
  start?: Date;
  end?: Date;
};

export default function JobsPage() {
  const ALL_STATUSES = ["active", "waiting", "completed", "failed", "delayed"];
  const [filterStatuses, setFilterStatuses] = useState<Set<string>>(new Set(ALL_STATUSES));
  const [filterTypes, setFilterTypes] = useState<Set<string>>(new Set());
  const [allTypesSelected, setAllTypesSelected] = useState(true);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [limit, setLimit] = useState<number>(50);
  const [sortColumn, setSortColumn] = useState<string>("timestamp");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const queryClient = useQueryClient();

  const { jobs, isLoading } = useJobsListener();

  const { data: schemas, isLoading: isLoadingSchemas } = useQuery({
    queryKey: ["job-schemas"],
    queryFn: async () => {
      const response = await api.callResource("jobs", {
        action: "schemas",
      });
      return response as Record<string, any>;
    },
  });

  const { data: workerStatus, refetch: refetchWorkerStatus } = useQuery({
    queryKey: ["worker-status"],
    queryFn: async () => {
      const response = await api.callResource("jobs", {
        action: "get_worker_status",
      });
      return response as WorkerStatus;
    },
  });

  const pauseWorkerMutation = useMutation({
    mutationFn: async (workerType: string) => {
      await api.callResource("jobs", {
        action: "pause_worker",
        workerType,
      });
    },
    onSuccess: () => {
      refetchWorkerStatus();
    },
  });

  const resumeWorkerMutation = useMutation({
    mutationFn: async (workerType: string) => {
      await api.callResource("jobs", {
        action: "resume_worker",
        workerType,
      });
    },
    onSuccess: () => {
      refetchWorkerStatus();
    },
  });

  const pauseAllMutation = useMutation({
    mutationFn: async () => {
      await api.callResource("jobs", {
        action: "pause_all",
      });
    },
    onSuccess: () => {
      refetchWorkerStatus();
    },
  });

  const resumeAllMutation = useMutation({
    mutationFn: async () => {
      await api.callResource("jobs", {
        action: "resume_all",
      });
    },
    onSuccess: () => {
      refetchWorkerStatus();
    },
  });

  const allTypes = useMemo(() => Object.keys(schemas || {}), [schemas]);

  const allPaused = useMemo(() => {
    if (!workerStatus?.workers || allTypes.length === 0) return false;
    return allTypes.every(type => workerStatus.workers[type]?.paused);
  }, [workerStatus, allTypes]);

  const somePaused = useMemo(() => {
    if (!workerStatus?.workers) return false;
    return Object.values(workerStatus.workers).some(w => w.paused);
  }, [workerStatus]);

  const handleToggleWorker = (workerType: string, currentlyPaused: boolean) => {
    if (currentlyPaused) {
      resumeWorkerMutation.mutate(workerType);
    } else {
      pauseWorkerMutation.mutate(workerType);
    }
  };

  const handleToggleAll = () => {
    if (allPaused) {
      resumeAllMutation.mutate();
    } else {
      pauseAllMutation.mutate();
    }
  };

  const filteredJobs = useMemo(() => {
    let result = jobs;
    if (!allTypesSelected) {
      if (filterTypes.size === 0) {
        result = [];
      } else {
        result = result.filter(j => filterTypes.has(j.type));
      }
    }
    if (filterStatuses.size > 0 && filterStatuses.size < ALL_STATUSES.length) {
      result = result.filter(j => filterStatuses.has(j.state));
    } else if (filterStatuses.size === 0) {
      result = [];
    }
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(j =>
        j.id.toLowerCase().includes(query) ||
        j.type.toLowerCase().includes(query)
      );
    }

    // Sort the results
    const sortedResult = [...result].sort((a, b) => {
      let aVal: any;
      let bVal: any;

      switch (sortColumn) {
        case "state":
          aVal = a.state;
          bVal = b.state;
          break;
        case "type":
          aVal = a.type;
          bVal = b.type;
          break;
        case "id":
          aVal = a.id;
          bVal = b.id;
          break;
        case "timestamp":
          aVal = a.timestamp || 0;
          bVal = b.timestamp || 0;
          break;
        case "duration":
          aVal = a.processedOn ? ((a.finishedOn || Date.now()) - a.processedOn) : 0;
          bVal = b.processedOn ? ((b.finishedOn || Date.now()) - b.processedOn) : 0;
          break;
        default:
          return 0;
      }

      if (aVal < bVal) return sortDirection === "asc" ? -1 : 1;
      if (aVal > bVal) return sortDirection === "asc" ? 1 : -1;
      return 0;
    });

    return sortedResult.slice(0, limit);
  }, [jobs, allTypesSelected, filterTypes, filterStatuses, searchQuery, limit, sortColumn, sortDirection]);

  const refetch = () => {
    queryClient.invalidateQueries({ queryKey: ["jobs", "all"] });
  };

  const handleSort = (column: string) => {
    if (sortColumn === column) {
      setSortDirection(prev => prev === "asc" ? "desc" : "asc");
    } else {
      setSortColumn(column);
      setSortDirection("desc");
    }
  };

  const SortIcon = ({ column }: { column: string }) => {
    if (sortColumn !== column) {
      return <ArrowUpDown className="ml-1 h-3 w-3 opacity-50" />;
    }
    return sortDirection === "asc"
      ? <ArrowUp className="ml-1 h-3 w-3" />
      : <ArrowDown className="ml-1 h-3 w-3" />;
  };

  const toggleStatus = (status: string) => {
    setFilterStatuses(prev => {
      const next = new Set(prev);
      if (next.has(status)) {
        next.delete(status);
      } else {
        next.add(status);
      }
      return next;
    });
  };

  const selectAllStatuses = () => setFilterStatuses(new Set(ALL_STATUSES));
  const selectNoStatuses = () => setFilterStatuses(new Set());

  const toggleType = (type: string) => {
    if (allTypesSelected) {
      // Deselect this one type, keep all others
      setAllTypesSelected(false);
      const allExceptThis = new Set(allTypes.filter(t => t !== type));
      setFilterTypes(allExceptThis);
    } else {
      setFilterTypes(prev => {
        const next = new Set(prev);
        if (next.has(type)) {
          next.delete(type);
        } else {
          next.add(type);
        }
        // If all are now selected, switch back to allTypesSelected mode
        if (next.size === allTypes.length) {
          setAllTypesSelected(true);
          return new Set();
        }
        return next;
      });
    }
  };

  const selectAllTypes = () => {
    setAllTypesSelected(true);
    setFilterTypes(new Set());
  };

  const selectNoTypes = () => {
    setAllTypesSelected(false);
    setFilterTypes(new Set());
  };

  const selectOnlyType = (type: string) => {
    setAllTypesSelected(false);
    setFilterTypes(new Set([type]));
  };

  const selectOnlyStatus = (status: string) => {
    setFilterStatuses(new Set([status]));
  };

  const getTypesLabel = () => {
    if (allTypesSelected) return "All Types";
    if (filterTypes.size === 0) return "No Types";
    if (filterTypes.size === 1) return Array.from(filterTypes)[0];
    return `${filterTypes.size} types`;
  };

  const getStatusesLabel = () => {
    if (filterStatuses.size === ALL_STATUSES.length) return "All Statuses";
    if (filterStatuses.size === 0) return "No Statuses";
    if (filterStatuses.size === 1) return Array.from(filterStatuses)[0];
    return `${filterStatuses.size} statuses`;
  };

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

  const handleClearCompleted = async () => {
    if (
      !confirm(
        "Are you sure you want to clear all completed, failed, and cancelled jobs? This will permanently delete them."
      )
    ) {
      return;
    }

    try {
      const result = await api.callResource("jobs", {
        action: "clear_completed",
      });
      console.log(`Deleted ${result.deletedCount} jobs`);
      refetch();
    } catch (error) {
      console.error("Failed to clear completed jobs:", error);
      alert("Failed to clear completed jobs");
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
            variant={allPaused ? "default" : "secondary"}
            size="sm"
            onClick={handleToggleAll}
            disabled={pauseAllMutation.isPending || resumeAllMutation.isPending}
          >
            {allPaused ? (
              <>
                <PlayCircle className="h-4 w-4 mr-2" />
                Resume All
              </>
            ) : (
              <>
                <PauseCircle className="h-4 w-4 mr-2" />
                Pause All
              </>
            )}
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
            onClick={handleClearCompleted}
          >
            <Trash2 className="h-4 w-4 mr-2" />
            Clear Completed
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

      {/* Worker Status Card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Worker Status</CardTitle>
          <CardDescription>
            Pause workers to stop them from processing new jobs. Active jobs will complete.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {isLoadingSchemas ? (
              <div className="col-span-full text-muted-foreground text-sm">Loading workers...</div>
            ) : (
              allTypes.map((type) => {
                const isPaused = workerStatus?.workers[type]?.paused ?? false;
                const isMutating = pauseWorkerMutation.isPending || resumeWorkerMutation.isPending;
                return (
                  <div
                    key={type}
                    className={`flex items-center justify-between p-3 rounded-lg border transition-colors ${
                      isPaused
                        ? "bg-amber-500/5 border-amber-500/20"
                        : "bg-green-500/5 border-green-500/20"
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {isPaused ? (
                        <Pause className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                      ) : (
                        <Play className="h-3.5 w-3.5 text-green-500 shrink-0" />
                      )}
                      <span className="text-sm font-medium truncate" title={type}>
                        {type}
                      </span>
                    </div>
                    <Switch
                      checked={!isPaused}
                      onCheckedChange={() => handleToggleWorker(type, isPaused)}
                      disabled={isMutating}
                      className="shrink-0 ml-2"
                    />
                  </div>
                );
              })
            )}
          </div>
          {somePaused && (
            <p className="text-xs text-amber-600 mt-3">
              ⚠️ Some workers are paused. New jobs of those types will queue but not process.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-wrap items-center gap-4 mt-6">
          <div className="relative w-full sm:w-[300px]">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search by ID or type..."
              className="pl-8"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="w-[200px] justify-between">
                {getTypesLabel()}
                <ChevronDown className="ml-2 h-4 w-4 opacity-50" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-[200px]">
              <DropdownMenuItem onSelect={(e) => e.preventDefault()} onClick={selectAllTypes}>
                <Checkbox
                  checked={allTypesSelected}
                  className="mr-2"
                  onClick={(e) => e.stopPropagation()}
                  onCheckedChange={(checked) => checked ? selectAllTypes() : selectNoTypes()}
                />
                All Types
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {isLoadingSchemas ? (
                <DropdownMenuItem disabled>Loading...</DropdownMenuItem>
              ) : (
                allTypes.map((type) => (
                  <DropdownMenuItem
                    key={type}
                    onSelect={(e) => e.preventDefault()}
                    onClick={() => selectOnlyType(type)}
                    className="cursor-pointer"
                  >
                    <Checkbox
                      checked={allTypesSelected || filterTypes.has(type)}
                      className="mr-2"
                      onClick={(e) => e.stopPropagation()}
                      onCheckedChange={() => toggleType(type)}
                    />
                    {type}
                  </DropdownMenuItem>
                ))
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="w-[200px] justify-between capitalize">
                {getStatusesLabel()}
                <ChevronDown className="ml-2 h-4 w-4 opacity-50" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-[200px]">
              <DropdownMenuItem onSelect={(e) => e.preventDefault()} onClick={selectAllStatuses}>
                <Checkbox
                  checked={filterStatuses.size === ALL_STATUSES.length}
                  className="mr-2"
                  onClick={(e) => e.stopPropagation()}
                  onCheckedChange={(checked) => checked ? selectAllStatuses() : selectNoStatuses()}
                />
                All Statuses
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {ALL_STATUSES.map((status) => (
                <DropdownMenuItem
                  key={status}
                  onSelect={(e) => e.preventDefault()}
                  onClick={() => selectOnlyStatus(status)}
                  className="cursor-pointer capitalize"
                >
                  <Checkbox
                    checked={filterStatuses.has(status)}
                    className="mr-2"
                    onClick={(e) => e.stopPropagation()}
                    onCheckedChange={() => toggleStatus(status)}
                  />
                  {status}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <div className="w-[120px]">
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
                <TableHead
                  className="cursor-pointer hover:bg-muted/50 select-none"
                  onClick={() => handleSort("state")}
                >
                  <div className="flex items-center">
                    Status
                    <SortIcon column="state" />
                  </div>
                </TableHead>
                <TableHead
                  className="cursor-pointer hover:bg-muted/50 select-none"
                  onClick={() => handleSort("type")}
                >
                  <div className="flex items-center">
                    Type
                    <SortIcon column="type" />
                  </div>
                </TableHead>
                <TableHead
                  className="cursor-pointer hover:bg-muted/50 select-none"
                  onClick={() => handleSort("id")}
                >
                  <div className="flex items-center">
                    Job ID
                    <SortIcon column="id" />
                  </div>
                </TableHead>
                <TableHead
                  className="cursor-pointer hover:bg-muted/50 select-none"
                  onClick={() => handleSort("timestamp")}
                >
                  <div className="flex items-center">
                    Created
                    <SortIcon column="timestamp" />
                  </div>
                </TableHead>
                <TableHead
                  className="cursor-pointer hover:bg-muted/50 select-none"
                  onClick={() => handleSort("duration")}
                >
                  <div className="flex items-center">
                    Duration
                    <SortIcon column="duration" />
                  </div>
                </TableHead>
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
