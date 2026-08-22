import type { JobData } from "./types.ts";

export const DIARIZATOR_WAITING_FOR_SLOT = "waiting_for_diarizator_slot";

const DIARIZATOR_ROUTED_JOB_TYPES = new Set([
  "diarization",
  "enrollment",
  "profileReenrollment",
]);

const LIVE_QUEUE_STATES = new Set([
  "active",
  "delayed",
  "prioritized",
  "waiting",
  "waiting-children",
]);

export type DiarizatorAdmissionCandidate = {
  jobId: string;
  jobType: string;
  jobData: JobData;
  priority: number;
  createdAt: Date;
  queuedAt?: Date;
};

export type DiarizatorAdmissionDrainMetrics = {
  considered: number;
  admitted: number;
  reconciled: number;
  capacityBlocked: number;
  failed: number;
  oldestWaitMs: number;
};

export type DiarizatorAdmissionDrainDependencies = {
  getQueueState: (
    candidate: DiarizatorAdmissionCandidate,
  ) => Promise<string | undefined>;
  removeTerminalQueueJob: (
    candidate: DiarizatorAdmissionCandidate,
    state: string,
  ) => Promise<void>;
  admit: (candidate: DiarizatorAdmissionCandidate) => Promise<void>;
  markAdmitted: (
    candidate: DiarizatorAdmissionCandidate,
    waitMs: number,
  ) => Promise<void>;
  markDeferred: (
    candidate: DiarizatorAdmissionCandidate,
    reason: string,
  ) => Promise<void>;
  now?: () => number;
};

export function isDiarizatorRoutedJobType(type: string): boolean {
  return DIARIZATOR_ROUTED_JOB_TYPES.has(type);
}

/**
 * Shared ordering for every job type that uses the diarizator pool. BullMQ
 * queues are per job type, so this priority is also persisted for the common
 * admission reconciler.
 */
export function getDiarizatorAdmissionPriority(
  data: JobData,
  explicit?: number,
): number {
  if (data.type === "profileReenrollment" || data.type === "enrollment") {
    return 1;
  }
  if (data.type === "diarization" && data.originalId) return 5;
  if (data.type === "diarization" && data.mode === "build_generation") {
    return 15;
  }
  if (Number.isFinite(explicit)) return Number(explicit);
  return 20;
}

export function isDiarizatorSlotUnavailable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes(
    "All healthy diarizator provider concurrency slots are reserved",
  ) || message.includes("has no free concurrency slots");
}

export function getDiarizatorCapacityBlockScope(
  error: unknown,
): "pool" | "route" | undefined {
  const message = error instanceof Error ? error.message : String(error);
  if (
    message.includes(
      "All healthy diarizator provider concurrency slots are reserved",
    )
  ) {
    return "pool";
  }
  if (message.includes("has no free concurrency slots")) return "route";
  return undefined;
}

function admissionQueuedAt(candidate: DiarizatorAdmissionCandidate): number {
  return (candidate.queuedAt ?? candidate.createdAt).getTime();
}

/**
 * Admit a bounded snapshot in global priority/FIFO order. A pinned job whose
 * route is busy does not block work that can use another GPU. A pool-wide
 * capacity failure ends the pass because every later candidate would fail too.
 */
export async function drainDiarizatorAdmissionCandidates(
  candidates: DiarizatorAdmissionCandidate[],
  dependencies: DiarizatorAdmissionDrainDependencies,
): Promise<DiarizatorAdmissionDrainMetrics> {
  const now = dependencies.now ?? Date.now;
  const ordered = candidates.toSorted((left, right) =>
    left.priority - right.priority ||
    admissionQueuedAt(left) - admissionQueuedAt(right) ||
    left.jobId.localeCompare(right.jobId)
  );
  const metrics: DiarizatorAdmissionDrainMetrics = {
    considered: 0,
    admitted: 0,
    reconciled: 0,
    capacityBlocked: 0,
    failed: 0,
    oldestWaitMs: ordered.reduce(
      (oldest, candidate) =>
        Math.max(oldest, Math.max(0, now() - admissionQueuedAt(candidate))),
      0,
    ),
  };

  for (const candidate of ordered) {
    metrics.considered += 1;
    const waitMs = Math.max(0, now() - admissionQueuedAt(candidate));
    try {
      const queueState = await dependencies.getQueueState(candidate);
      if (queueState && LIVE_QUEUE_STATES.has(queueState)) {
        await dependencies.markAdmitted(candidate, waitMs);
        metrics.reconciled += 1;
        continue;
      }
      if (queueState) {
        await dependencies.removeTerminalQueueJob(candidate, queueState);
      }

      await dependencies.admit(candidate);
      // Deliberately match on queueAdmission.state rather than the top-level
      // job state in production: BullMQ may emit active/completed first.
      await dependencies.markAdmitted(candidate, waitMs);
      metrics.admitted += 1;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const capacityScope = getDiarizatorCapacityBlockScope(error);
      if (capacityScope) {
        metrics.capacityBlocked += 1;
        await dependencies.markDeferred(candidate, reason);
        if (capacityScope === "pool") break;
        continue;
      }

      metrics.failed += 1;
      await dependencies.markDeferred(candidate, reason);
    }
  }

  return metrics;
}
