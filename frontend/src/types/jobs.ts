export type JobInfo = {
  id: string;
  name?: string;
  type: string;
  data: any;
  state: string;
  progress: any;
  result?: any;
  trigger?: {
    type: "manual" | "auto";
    reason?: string;
    principal?: string;
  };
  timestamp: number;
  finishedOn?: number;
  processedOn?: number;
  failedReason?: string;
  attemptsMade?: number;
  restarted?: boolean;
  restartedFromJobId?: string;
  restartJobId?: string;
  routingContext?: {
    presetId?: string;
    sourceId?: string;
    providerProfileId?: string;
    providerProfileName?: string;
    model?: string;
    modelId?: string;
    modelVersion?: string;
    embeddingSpaceId?: string;
    runtimeProvenanceSource?: string;
    resolvedAt: string;
  };
  updatedOn?: number;
  queueState?: string | null;
  queuePresent?: boolean;
  queueAdmission?: {
    state?: "waiting_for_diarizator_slot" | "admitted";
    reason?: string;
    priority?: number;
    queuedAt?: string;
    admittedAt?: string;
  };
  diarizationErrorOutcomes?: Array<{
    index: number;
    state:
      | "recovered"
      | "retrying"
      | "needs_attention"
      | "pending"
      | "unknown";
    matchedChunks: number;
    diarizedChunks: number;
    recoveredAt?: string;
    currentFailure?: {
      status?: string;
      category?: string;
      message?: string;
      route?: string;
      attempt?: number;
      retryAt?: string;
    };
  }>;
  modelProvenance?: Array<{
    stage: string;
    requestedModel?: string;
    executedModel?: string;
    responseModel?: string;
    fallbackModel?: string;
    fallbackUsed: boolean;
    providerBaseUrl?: string;
    providerProfileId?: string;
    providerProfileName?: string;
    provenanceQuality: "exact" | "requested_only";
  }>;
};

export interface JobLogEntry {
  _id?: string;
  jobId: string;
  stream: "stdout" | "stderr" | "progress";
  text: string;
  timestamp: string;
}

export interface JobAccessLogEntry {
  _id: string;
  principal: string;
  resource: string;
  actions: Array<{
    path: string[];
    actions: string[];
  }>;
  timestamp: string;
}

export interface WorkerPolicy {
  resource: string;
  action: string;
  effect: "allow" | "deny";
}
