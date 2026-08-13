export type TimelineBookkeepingRepair = {
  checkedAt: string;
  terminalSequences: number;
  eligibleChunks: number;
  modifiedChunks: number;
  applied: boolean;
  durationMs: number;
  backfilled?: boolean;
  note: string;
};

export type TimelineIntegrityReport = {
  checkedAt: string;
  status: "healthy" | "needs_attention";
  sources: Array<{
    collection: "audio_chunks" | "transcriptions" | "diarizations";
    label: string;
    documents: number;
    firstStart: string | null;
    lastStart: string | null;
    lastEnd: string | null;
    histogramDocuments: number;
    difference: number;
  }>;
  histograms: Array<{
    resolution: "5min" | "1hour" | "1day" | "1week";
    buckets: number;
    stale: number;
    firstStart: string | null;
    lastStart: string | null;
    totals: Record<"audio_chunks" | "transcriptions" | "diarizations", number>;
  }>;
  bookkeeping: {
    checked: boolean;
    terminalSequences: number | null;
    eligibleChunks: number | null;
    modifiedChunks: number;
    applied: boolean;
  };
  lastBookkeepingRepair: null | Omit<TimelineBookkeepingRepair, "note">;
  campaign: null | {
    campaignId: string;
    status: "queued" | "running" | "completed" | "completed_with_errors";
    plannedJobs: number;
    queuedJobs: number;
    missingJobs: number;
    active: number;
    waiting: number;
    delayed: number;
    completed: number;
    failed: number;
    cancelled: number;
    start: string | null;
    end: string | null;
    createdAt: string | null;
    finishedAt: string | null;
    failures: Array<{
      jobId?: string;
      batchIndex?: number;
      start: string | null;
      end: string | null;
      reason: string;
    }>;
  };
  issues: Array<{
    severity: "warning" | "error";
    code: string;
    message: string;
  }>;
  scope: {
    verifies: string[];
    note: string;
  };
  performance: {
    totalMs: number;
    stages: Record<string, number>;
    note: string;
  };
};
