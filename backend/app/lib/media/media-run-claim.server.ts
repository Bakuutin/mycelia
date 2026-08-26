import type { Db } from "mongodb";
import { randomUUID } from "node:crypto";

export const MEDIA_RUN_CLAIM_LEASE_MS = 30 * 60 * 1000;

export type MediaRunExecutionClaim = {
  runId: string;
  claimId: string;
  attemptId: string;
  jobId: string;
  leaseExpiresAt: Date;
};

export type MediaRunClaimResult =
  | { kind: "claimed"; claim: MediaRunExecutionClaim; run: Record<string, any> }
  | { kind: "ready"; run: Record<string, any> }
  | {
    kind: "busy";
    reason: "active" | "provider_outcome_unknown";
    run: Record<string, any>;
  };

export class MediaRunClaimLostError extends Error {
  constructor(message = "MEDIA_ANALYSIS_RUN_CLAIM_LOST") {
    super(message);
    this.name = "MediaRunClaimLostError";
  }
}

function claimFilter(claim: MediaRunExecutionClaim) {
  return {
    _id: claim.runId,
    state: "building",
    "executionClaim.id": claim.claimId,
  };
}

/**
 * Claims the deterministic analysis run before any provider budget is
 * reserved. Only an unstarted expired claim is reclaimable. Once the durable
 * provider-start marker exists, a stale observer must not repeat the call.
 */
export async function claimMediaAnalysisRun(
  db: Db,
  input: {
    runId: string;
    jobId: string;
    initial: Record<string, unknown>;
  },
  options: { now?: Date; leaseMs?: number; claimId?: string } = {},
): Promise<MediaRunClaimResult> {
  const collection = db.collection<any>("media_analysis_runs");
  const now = options.now ?? new Date();
  try {
    await collection.updateOne(
      { _id: input.runId },
      {
        $setOnInsert: {
          ...input.initial,
          _id: input.runId,
          runKey: input.runId,
          state: "pending",
          createdAt: now,
          updatedAt: now,
        },
      },
      { upsert: true },
    );
  } catch (error) {
    // Two workers may first observe the deterministic run simultaneously.
    // The unique _id decides the winner; both may continue to the CAS claim.
    if ((error as { code?: number })?.code !== 11000) throw error;
  }

  const claimId = options.claimId ?? randomUUID();
  const attemptId = `${input.runId}:${claimId}`;
  const leaseExpiresAt = new Date(
    now.getTime() +
      Math.max(1_000, options.leaseMs ?? MEDIA_RUN_CLAIM_LEASE_MS),
  );
  const run = await collection.findOneAndUpdate(
    {
      _id: input.runId,
      state: { $ne: "ready" },
      $or: [
        { executionClaim: { $exists: false } },
        { state: "failed" },
        {
          "executionClaim.providerStartedAt": { $exists: false },
          "executionClaim.leaseExpiresAt": { $lte: now },
        },
      ],
    },
    {
      $set: {
        state: "building",
        attemptId,
        jobId: input.jobId,
        safeError: null,
        executionClaim: {
          id: claimId,
          jobId: input.jobId,
          phase: "claimed",
          claimedAt: now,
          leaseExpiresAt,
        },
        updatedAt: now,
      },
    },
    { returnDocument: "after" },
  );
  if (run) {
    return {
      kind: "claimed",
      claim: {
        runId: input.runId,
        claimId,
        attemptId,
        jobId: input.jobId,
        leaseExpiresAt,
      },
      run,
    };
  }

  const existing = await collection.findOne({ _id: input.runId });
  if (!existing) throw new Error("MEDIA_ANALYSIS_RUN_NOT_FOUND");
  if (existing.state === "ready") return { kind: "ready", run: existing };
  if (existing.state === "provider_outcome_unknown") {
    return { kind: "busy", reason: "provider_outcome_unknown", run: existing };
  }
  const startedAt = existing.executionClaim?.providerStartedAt;
  const expiresAt = existing.executionClaim?.leaseExpiresAt;
  const staleStarted = startedAt && expiresAt &&
    new Date(expiresAt).getTime() <= now.getTime();
  return {
    kind: "busy",
    reason: staleStarted ? "provider_outcome_unknown" : "active",
    run: existing,
  };
}

/** Creates the durable fence immediately before the external provider call. */
export async function markMediaRunProviderStarted(
  db: Db,
  claim: MediaRunExecutionClaim,
  now = new Date(),
): Promise<void> {
  const result = await db.collection<any>("media_analysis_runs").updateOne(
    {
      ...claimFilter(claim),
      "executionClaim.phase": "claimed",
      "executionClaim.providerStartedAt": { $exists: false },
      "executionClaim.leaseExpiresAt": { $gt: now },
    },
    {
      $set: {
        "executionClaim.phase": "started",
        "executionClaim.providerStartedAt": now,
        updatedAt: now,
      },
    },
  );
  if (result.modifiedCount !== 1) throw new MediaRunClaimLostError();
}

export async function markMediaRunReady(
  db: Db,
  claim: MediaRunExecutionClaim,
  fields: Record<string, unknown>,
  now = new Date(),
): Promise<void> {
  const result = await db.collection<any>("media_analysis_runs").updateOne(
    { ...claimFilter(claim), "executionClaim.phase": "started" },
    {
      $set: {
        ...fields,
        state: "ready",
        completedAt: fields.completedAt ?? now,
        updatedAt: now,
      },
      $unset: { executionClaim: "" },
    },
  );
  if (result.modifiedCount !== 1) throw new MediaRunClaimLostError();
}

/**
 * Permanently fences a run whose external call may already have been billed.
 * The provider-start marker intentionally remains durable so no retry can
 * inherit this deterministic run as permission for another provider call.
 */
export async function markMediaRunOutcomeUnknown(
  db: Db,
  claim: MediaRunExecutionClaim,
  safeError: string,
  now = new Date(),
): Promise<void> {
  const result = await db.collection<any>("media_analysis_runs").updateOne(
    { ...claimFilter(claim), "executionClaim.phase": "started" },
    {
      $set: {
        state: "provider_outcome_unknown",
        safeError,
        "executionClaim.phase": "outcome_unknown",
        "executionClaim.outcomeUnknownAt": now,
        updatedAt: now,
      },
    },
  );
  if (result.modifiedCount !== 1) throw new MediaRunClaimLostError();
}

export async function markMediaRunFailed(
  db: Db,
  claim: MediaRunExecutionClaim,
  safeError: string,
  now = new Date(),
): Promise<void> {
  const result = await db.collection<any>("media_analysis_runs").updateOne(
    claimFilter(claim),
    {
      $set: { state: "failed", safeError, updatedAt: now },
      $unset: { executionClaim: "" },
    },
  );
  if (result.modifiedCount !== 1) throw new MediaRunClaimLostError();
}
