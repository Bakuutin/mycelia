/**
 * Generic job data - type string plus any additional fields.
 * Each job capability defines its own schema for validation.
 */
export interface JobData {
  type: string;
  routingContext?: JobRoutingContext;
  [key: string]: unknown;
}

export interface JobRoutingContext {
  presetId?: string;
  sourceId?: string;
  providerProfileId?: string;
  providerProfileName?: string;
  model?: string;
  /** Actual diarizator runtime contract resolved from /ready. */
  modelId?: string;
  modelVersion?: string;
  embeddingSpaceId?: string;
  runtimeProvenanceSource?: "route_readiness" | "historical_backfill_0069";
  resolvedAt: string;
}

export interface JobProgress {
  processed: number;
  total: number;
  [key: string]: unknown;
}

export interface JobResult {
  success?: boolean;
  [key: string]: unknown;
}

export interface EnqueueJobOptions {
  priority?: number;
  jobId?: string;
  trigger?: {
    type: "manual" | "auto";
    reason?: string;
    principal?: string;
  };
  restartedFromJobId?: string;
  /** Internal hasMore continuation may reuse the route that just succeeded. */
  reuseHealthyRoute?: boolean;
}
