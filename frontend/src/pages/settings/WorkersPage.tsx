import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { callResource } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Cog,
  CheckCircle2,
  XCircle,
  Clock,
  Pause,
  Play,
  Settings,
  RefreshCw,
  Shield,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

interface Policy {
  resource: string;
  action: string;
  effect: "allow" | "deny";
}

interface WorkerEntry {
  _id: string;
  name: string;
  discovered: boolean;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  policies?: Policy[];
  defaultOverrides?: Record<string, unknown>;
  lastSeen: string;
  createdAt: string;
  updatedAt: string;
}

interface WorkerStatus {
  paused: boolean;
}

const WorkersPage = () => {
  const [workers, setWorkers] = useState<WorkerEntry[]>([]);
  const [workerStatuses, setWorkerStatuses] = useState<Record<string, WorkerStatus>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [togglingWorker, setTogglingWorker] = useState<string | null>(null);
  const [expandedPolicies, setExpandedPolicies] = useState<Set<string>>(new Set());

  const fetchData = async () => {
    try {
      setLoading(true);
      const [workersResult, statusResult] = await Promise.all([
        callResource("jobs", { action: "list_workers" }),
        callResource("jobs", { action: "get_worker_status" }),
      ]);

      setWorkers(workersResult.workers || []);
      setWorkerStatuses(statusResult.workers || {});
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch workers");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const toggleWorkerPause = async (workerType: string, currentlyPaused: boolean) => {
    setTogglingWorker(workerType);
    try {
      await callResource("jobs", {
        action: currentlyPaused ? "resume_worker" : "pause_worker",
        workerType,
      });
      setWorkerStatuses((prev) => ({
        ...prev,
        [workerType]: { paused: !currentlyPaused },
      }));
    } catch (err) {
      console.error("Failed to toggle worker pause state:", err);
    } finally {
      setTogglingWorker(null);
    }
  };

  const getSchemaFieldCount = (schema: Record<string, unknown>): number => {
    const properties = schema?.properties as Record<string, unknown> | undefined;
    if (!properties) return 0;
    return Object.keys(properties).filter((key) => key !== "type").length;
  };

  const getOverrideCount = (worker: WorkerEntry): number => {
    return Object.keys(worker.defaultOverrides || {}).length;
  };

  const togglePoliciesExpanded = (workerName: string) => {
    setExpandedPolicies((prev) => {
      const next = new Set(prev);
      if (next.has(workerName)) {
        next.delete(workerName);
      } else {
        next.add(workerName);
      }
      return next;
    });
  };

  const formatLastSeen = (lastSeen: string): string => {
    const date = new Date(lastSeen);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;

    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;

    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-semibold mb-2">Workers</h2>
          <p className="text-muted-foreground">
            Configure background job workers and their default settings.
          </p>
        </div>
        <div className="border rounded-lg p-8 text-center">
          <p className="text-muted-foreground">Loading workers...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-semibold mb-2">Workers</h2>
          <p className="text-muted-foreground">
            Configure background job workers and their default settings.
          </p>
        </div>
        <div className="border rounded-lg p-8 text-center">
          <p className="text-red-500">Error: {error}</p>
          <Button variant="outline" className="mt-4" onClick={fetchData}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Retry
          </Button>
        </div>
      </div>
    );
  }

  const discoveredWorkers = workers.filter((w) => w.discovered);
  const unavailableWorkers = workers.filter((w) => !w.discovered);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold mb-2">Workers</h2>
          <p className="text-muted-foreground">
            Configure background job workers and their default settings.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchData}>
          <RefreshCw className="w-4 h-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Active Workers */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Cog className="w-5 h-5 text-primary" />
          <h3 className="text-lg font-semibold">Active Workers</h3>
          <Badge variant="secondary">{discoveredWorkers.length}</Badge>
        </div>

        {discoveredWorkers.length === 0 ? (
          <Card className="p-6 text-center text-muted-foreground">
            No workers are currently active. Start the backend worker process to
            see available workers.
          </Card>
        ) : (
          <div className="grid gap-4">
            {discoveredWorkers.map((worker) => {
              const status = workerStatuses[worker.name];
              const isPaused = status?.paused ?? false;
              const fieldCount = getSchemaFieldCount(worker.inputSchema);
              const overrideCount = getOverrideCount(worker);
              const isToggling = togglingWorker === worker.name;

              const policies = worker.policies || [];
              const isPoliciesExpanded = expandedPolicies.has(worker.name);

              return (
                <Card
                  key={worker._id}
                  className={`p-4 transition-colors ${
                    isPaused
                      ? "border-amber-500/50 bg-amber-500/5"
                      : "border-green-500/30 bg-green-500/5"
                  }`}
                >
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      {isPaused ? (
                        <Pause className="w-5 h-5 text-amber-500 shrink-0" />
                      ) : (
                        <CheckCircle2 className="w-5 h-5 text-green-500 shrink-0" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <h4 className="font-medium">{worker.name}</h4>
                          {isPaused && (
                            <Badge
                              variant="outline"
                              className="text-xs text-amber-600 border-amber-500/50"
                            >
                              Paused
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-4 text-xs text-muted-foreground mt-1">
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {formatLastSeen(worker.lastSeen)}
                          </span>
                          <span>{fieldCount} configurable fields</span>
                          {overrideCount > 0 && (
                            <Badge
                              variant="secondary"
                              className="text-xs bg-blue-500/10 text-blue-700 dark:text-blue-400"
                            >
                              {overrideCount} override{overrideCount !== 1 ? "s" : ""}
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {policies.length > 0 && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => togglePoliciesExpanded(worker.name)}
                          title="View permissions"
                        >
                          <Shield className="w-4 h-4 mr-1" />
                          <span className="text-xs">{policies.length}</span>
                          {isPoliciesExpanded ? (
                            <ChevronUp className="w-3 h-3 ml-1" />
                          ) : (
                            <ChevronDown className="w-3 h-3 ml-1" />
                          )}
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => toggleWorkerPause(worker.name, isPaused)}
                        disabled={isToggling}
                        title={isPaused ? "Resume worker" : "Pause worker"}
                      >
                        {isToggling ? (
                          <RefreshCw className="w-4 h-4 animate-spin" />
                        ) : isPaused ? (
                          <Play className="w-4 h-4" />
                        ) : (
                          <Pause className="w-4 h-4" />
                        )}
                      </Button>
                      <Link to={`/settings/workers/${worker.name}`}>
                        <Button variant="outline" size="sm">
                          <Settings className="w-4 h-4 mr-2" />
                          Configure
                        </Button>
                      </Link>
                    </div>
                  </div>
                  
                  {/* Policies Section */}
                  {isPoliciesExpanded && policies.length > 0 && (
                    <div className="mt-4 pt-4 border-t border-border/50">
                      <div className="flex items-center gap-2 mb-2 text-xs font-medium text-muted-foreground">
                        <Shield className="w-3 h-3" />
                        Permissions
                      </div>
                      <div className="grid gap-1">
                        {policies.map((policy, idx) => (
                          <div
                            key={idx}
                            className="flex items-center gap-2 text-xs font-mono bg-muted/30 px-2 py-1 rounded"
                          >
                            <span className={policy.effect === "allow" ? "text-green-600" : "text-red-600"}>
                              {policy.effect === "allow" ? "✓" : "✗"}
                            </span>
                            <span className="text-muted-foreground">{policy.resource}</span>
                            <span className="text-foreground">{policy.action}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Unavailable Workers */}
      {unavailableWorkers.length > 0 && (
        <>
          <Separator />
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <XCircle className="w-5 h-5 text-muted-foreground" />
              <h3 className="text-lg font-semibold text-muted-foreground">
                Previously Seen Workers
              </h3>
              <Badge variant="outline">{unavailableWorkers.length}</Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              These workers were registered but are not currently running.
            </p>
            <div className="grid gap-3">
              {unavailableWorkers.map((worker) => (
                <Card
                  key={worker._id}
                  className="p-4 opacity-60"
                >
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <XCircle className="w-5 h-5 text-muted-foreground shrink-0" />
                      <div className="min-w-0 flex-1">
                        <h4 className="font-medium">{worker.name}</h4>
                        <div className="flex items-center gap-4 text-xs text-muted-foreground mt-1">
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            Last seen {formatLastSeen(worker.lastSeen)}
                          </span>
                        </div>
                      </div>
                    </div>
                    <Link to={`/settings/workers/${worker.name}`}>
                      <Button variant="ghost" size="sm">
                        <Settings className="w-4 h-4" />
                      </Button>
                    </Link>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default WorkersPage;
