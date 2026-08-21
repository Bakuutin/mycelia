export type SnapshotState =
  | "missing"
  | "ready"
  | "refreshing"
  | "stale"
  | "failed";

export interface PersistedSnapshot<T = unknown> {
  state: SnapshotState;
  data?: T;
  asOf?: string;
  lastAttemptAt?: string;
  lastError?: string;
  operationId?: string;
}

export interface WorkerCatalogEntry {
  type: string;
  label: string;
  description: string;
  section: "pipeline" | "maintenance" | "diagnostic";
  order: number;
  executionKind: "backend" | "python-http" | "daemon";
  routingKind: "none" | "stt" | "llm" | "diarizer";
  availability:
    | "starting"
    | "ready"
    | "degraded"
    | "unavailable"
    | "daemon-managed";
  registered: boolean;
  progressKind: string;
  capabilities: {
    manualRun: boolean;
    pause: boolean;
    schedule: boolean;
    concurrency: boolean;
    batchSize: boolean;
  };
}

export interface JobsDashboard {
  checkedAt: string;
  catalog: {
    state: "ready" | "starting" | "stale";
    asOf?: string;
    workers: WorkerCatalogEntry[];
    schemas: Record<string, any>;
  };
  runtime: {
    checkedAt: string;
    workers: Record<string, any>;
  };
  snapshots: {
    runHistory: PersistedSnapshot;
    exactBacklog: PersistedSnapshot;
    timelineIntegrity: PersistedSnapshot;
  };
}
