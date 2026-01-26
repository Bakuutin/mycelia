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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { RefreshCw, Trash2, Play, Search, ChevronDown, ArrowUpDown, ArrowUp, ArrowDown, PlayCircle, PauseCircle, Activity, Clock, AlertCircle, CheckCircle, WifiOff, Server } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
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

/**
 * Worker pipeline configuration with display order and descriptions.
 * Used for displaying workers in logical pipeline order in the UI.
 */
const WORKER_PIPELINE = [
  { type: "ingestion", order: 1, description: "Processes audio files into chunks" },
  { type: "vad", order: 2, description: "Voice Activity Detection on audio chunks" },
  { type: "transcription_sequence_creator", order: 3, description: "Groups speech chunks into sequences" },
  { type: "transcription", order: 4, description: "Transcribes sequences to text using LLM" },
  { type: "conversation_chunk_creator", order: 5, description: "Groups transcriptions into conversation chunks" },
  { type: "conversation_extractor", order: 6, description: "Extracts conversations and entities using LLM" },
  { type: "summarization", order: 7, description: "Generates summaries for conversations" },
  { type: "diarization", order: 8, description: "Speaker identification/diarization" },
  { type: "histRecalculation", order: 9, description: "Recalculates timeline histograms" },
] as const;

/** Status priority for sorting - lower number = higher priority (shown first) */
const STATUS_PRIORITY: Record<string, number> = {
  active: 0,
  waiting: 1,
  failed: 2,
  delayed: 3,
  completed: 4,
};

export default function JobsPage() {
  const ALL_STATUSES = ["active", "waiting", "completed", "failed", "delayed"];
  const [quickFilter, setQuickFilter] = useState<string>("all");
  const [filterStatuses, setFilterStatuses] = useState<Set<string>>(new Set(ALL_STATUSES));
  const [filterTypes, setFilterTypes] = useState<Set<string>>(new Set());
  const [allTypesSelected, setAllTypesSelected] = useState(true);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [limit, setLimit] = useState<number>(50);
  const [sortColumn, setSortColumn] = useState<string>("priority");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
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

  const retryAllOfflineMutation = useMutation({
    mutationFn: async () => {
      return await api.callResource("jobs", {
        action: "retry_all_offline",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["jobs", "all"] });
    },
  });

  const retryJobMutation = useMutation({
    mutationFn: async (jobId: string) => {
      return await api.callResource("jobs", {
        action: "retry",
        id: jobId,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["jobs", "all"] });
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

  // Job counts by status
  const jobCounts = useMemo(() => {
    const counts = { active: 0, waiting: 0, failed: 0, completed: 0, delayed: 0, total: 0, offlineFailures: 0 };
    for (const job of jobs) {
      counts.total++;
      if (job.state in counts) {
        counts[job.state as keyof typeof counts]++;
      }
      if (job.state === "failed" && job.failedType === "offline") {
        counts.offlineFailures++;
      }
    }
    return counts;
  }, [jobs]);

  // Job counts per worker type
  const workerJobCounts = useMemo(() => {
    const counts: Record<string, { active: number; waiting: number; failed: number }> = {};
    for (const job of jobs) {
      if (!counts[job.type]) {
        counts[job.type] = { active: 0, waiting: 0, failed: 0 };
      }
      if (job.state === "active") counts[job.type].active++;
      else if (job.state === "waiting") counts[job.type].waiting++;
      else if (job.state === "failed") counts[job.type].failed++;
    }
    return counts;
  }, [jobs]);

  // Get workers sorted by pipeline order, with unknown workers at the end
  const sortedWorkers = useMemo(() => {
    const pipelineOrder = new Map(WORKER_PIPELINE.map((w, i) => [w.type, i]));
    const pipelineDescriptions = new Map(WORKER_PIPELINE.map(w => [w.type, w.description]));
    
    return [...allTypes].sort((a, b) => {
      const orderA = pipelineOrder.get(a) ?? 999;
      const orderB = pipelineOrder.get(b) ?? 999;
      return orderA - orderB;
    }).map(type => ({
      type,
      description: pipelineDescriptions.get(type) || "Worker process",
      order: pipelineOrder.get(type) ?? 999,
    }));
  }, [allTypes]);

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
    
    // Apply quick filter first
    if (quickFilter !== "all") {
      result = result.filter(j => j.state === quickFilter);
    } else {
      // Apply multi-select status filter only when quick filter is "all"
      if (filterStatuses.size > 0 && filterStatuses.size < ALL_STATUSES.length) {
        result = result.filter(j => filterStatuses.has(j.state));
      } else if (filterStatuses.size === 0) {
        result = [];
      }
    }
    
    // Apply type filter
    if (!allTypesSelected) {
      if (filterTypes.size === 0) {
        result = [];
      } else {
        result = result.filter(j => filterTypes.has(j.type));
      }
    }
    
    // Apply search filter
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
        case "priority":
          // Primary: status priority, Secondary: timestamp (desc)
          const priorityA = STATUS_PRIORITY[a.state] ?? 999;
          const priorityB = STATUS_PRIORITY[b.state] ?? 999;
          if (priorityA !== priorityB) {
            return sortDirection === "asc" ? priorityA - priorityB : priorityB - priorityA;
          }
          // Secondary sort by timestamp (most recent first)
          return (b.timestamp || 0) - (a.timestamp || 0);
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
  }, [jobs, quickFilter, allTypesSelected, filterTypes, filterStatuses, searchQuery, limit, sortColumn, sortDirection]);

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
    const confirmText = "DELETE";
    const userInput = prompt(
      `⚠️ DEV ONLY - DESTRUCTIVE ACTION ⚠️\n\n` +
      `This will permanently delete ALL completed, failed, and cancelled jobs from the database.\n\n` +
      `This action cannot be undone and the data cannot be recovered.\n\n` +
      `Type "${confirmText}" to confirm:`
    );

    if (userInput !== confirmText) {
      if (userInput !== null) {
        alert("Deletion cancelled - confirmation text did not match.");
      }
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
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-bold tracking-tight">System Jobs</h1>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
            </span>
            Live
          </div>
        </div>
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
          {import.meta.env.DEV && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleClearCompleted}
              title="Dev only: Permanently delete completed jobs from database"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Clear Completed (Dev)
            </Button>
          )}
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

      {/* Worker Console */}
      <Card>
        <CardHeader className="py-3 px-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Workers</CardTitle>
            {somePaused && (
              <Badge variant="secondary" className="bg-amber-500/10 text-amber-500 text-xs">
                {sortedWorkers.filter(w => workerStatus?.workers[w.type]?.paused).length} paused
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoadingSchemas ? (
            <div className="p-4 text-muted-foreground text-sm">Loading workers...</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="h-8">
                  <TableHead className="w-[40px] pl-4">On</TableHead>
                  <TableHead>Worker</TableHead>
                  <TableHead className="hidden lg:table-cell">Description</TableHead>
                  <TableHead className="text-center w-[60px]">Run</TableHead>
                  <TableHead className="text-center w-[60px]">Queue</TableHead>
                  <TableHead className="text-center w-[60px]">Err</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedWorkers.map((worker) => {
                  const isPaused = workerStatus?.workers[worker.type]?.paused ?? false;
                  const isMutating = pauseWorkerMutation.isPending || resumeWorkerMutation.isPending;
                  const counts = workerJobCounts[worker.type] || { active: 0, waiting: 0, failed: 0 };
                  return (
                    <TableRow 
                      key={worker.type}
                      className={`h-9 ${isPaused ? "bg-amber-500/5" : ""}`}
                    >
                      <TableCell className="pl-4 py-1">
                        <Checkbox
                          checked={!isPaused}
                          onCheckedChange={() => handleToggleWorker(worker.type, isPaused)}
                          disabled={isMutating}
                          className="cursor-pointer"
                        />
                      </TableCell>
                      <TableCell className="py-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs text-muted-foreground w-4">{worker.order < 999 ? worker.order : ""}</span>
                          <span className={`text-sm ${isPaused ? "text-muted-foreground" : ""}`}>{worker.type}</span>
                        </div>
                      </TableCell>
                      <TableCell className="hidden lg:table-cell text-muted-foreground text-xs py-1">
                        {worker.description}
                      </TableCell>
                      <TableCell className="text-center py-1">
                        {counts.active > 0 ? (
                          <span className="text-blue-500 text-sm font-medium">{counts.active}</span>
                        ) : (
                          <span className="text-muted-foreground/50">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center py-1">
                        {counts.waiting > 0 ? (
                          <span className="text-yellow-500 text-sm font-medium">{counts.waiting}</span>
                        ) : (
                          <span className="text-muted-foreground/50">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center py-1">
                        {counts.failed > 0 ? (
                          <span className="text-red-500 text-sm font-medium">{counts.failed}</span>
                        ) : (
                          <span className="text-muted-foreground/50">-</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Quick Filter Tabs */}
      <div className="flex flex-wrap gap-2">
        <Button
          variant={quickFilter === "all" ? "default" : "outline"}
          size="sm"
          onClick={() => setQuickFilter("all")}
        >
          All ({jobCounts.total})
        </Button>
        <Button
          variant={quickFilter === "active" ? "default" : "outline"}
          size="sm"
          onClick={() => setQuickFilter("active")}
          className={quickFilter !== "active" ? "text-blue-500 hover:text-blue-600" : ""}
        >
          <Activity className="h-3.5 w-3.5 mr-1" />
          Active ({jobCounts.active})
        </Button>
        <Button
          variant={quickFilter === "waiting" ? "default" : "outline"}
          size="sm"
          onClick={() => setQuickFilter("waiting")}
          className={quickFilter !== "waiting" ? "text-yellow-500 hover:text-yellow-600" : ""}
        >
          <Clock className="h-3.5 w-3.5 mr-1" />
          Waiting ({jobCounts.waiting})
        </Button>
        <Button
          variant={quickFilter === "failed" ? "default" : "outline"}
          size="sm"
          onClick={() => setQuickFilter("failed")}
          className={quickFilter !== "failed" ? "text-red-500 hover:text-red-600 border-red-500/30" : ""}
        >
          <AlertCircle className="h-3.5 w-3.5 mr-1" />
          Errors ({jobCounts.failed})
        </Button>
        {jobCounts.offlineFailures > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => retryAllOfflineMutation.mutate()}
            disabled={retryAllOfflineMutation.isPending}
            className="text-yellow-600 hover:text-yellow-700 border-yellow-500/30"
          >
            <WifiOff className="h-3.5 w-3.5 mr-1" />
            Retry {jobCounts.offlineFailures} Offline
            {retryAllOfflineMutation.isPending && (
              <RefreshCw className="h-3 w-3 ml-1 animate-spin" />
            )}
          </Button>
        )}
        <Button
          variant={quickFilter === "completed" ? "default" : "outline"}
          size="sm"
          onClick={() => setQuickFilter("completed")}
          className={quickFilter !== "completed" ? "text-green-500 hover:text-green-600" : ""}
        >
          <CheckCircle className="h-3.5 w-3.5 mr-1" />
          Completed ({jobCounts.completed})
        </Button>
      </div>

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
                <TableHead className="w-[80px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8">
                    Loading jobs...
                  </TableCell>
                </TableRow>
              ) : filteredJobs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8">
                    No jobs found
                  </TableCell>
                </TableRow>
              ) : (
                filteredJobs.map((job) => (
                  <TableRow 
                    key={job.id}
                    className={job.state === "failed" ? "bg-red-500/5 border-l-2 border-l-red-500" : ""}
                  >
                    <TableCell>
                      <Link
                        to={`/jobs/${job.id}`}
                        className="flex items-center gap-1.5"
                      >
                        <Badge
                          variant="secondary"
                          className={getStatusColor(job.state)}
                        >
                          {job.state}
                        </Badge>
                        {job.failedType === "offline" && (
                          <span title="Network/Offline Error">
                            <WifiOff className="h-3.5 w-3.5 text-yellow-500" />
                          </span>
                        )}
                        {job.failedType === "internal" && (
                          <span title="Internal Service Error">
                            <Server className="h-3.5 w-3.5 text-orange-500" />
                          </span>
                        )}
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
                    <TableCell>
                      {["failed", "cancelled"].includes(job.state) && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => retryJobMutation.mutate(job.id)}
                          disabled={retryJobMutation.isPending}
                          className="h-7 px-2"
                        >
                          <RefreshCw className={`h-3.5 w-3.5 ${retryJobMutation.isPending ? 'animate-spin' : ''}`} />
                        </Button>
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
