import type { Db } from "mongodb";
import { randomUUID } from "node:crypto";

export const MEDIA_EVENT_RUN_CLAIM_LEASE_MS = 30 * 60 * 1000;

export type MediaEventRunExecutionClaim = {
  runId: string;
  claimId: string;
  attemptId: string;
  jobId: string;
  leaseExpiresAt: Date;
};

export type MediaEventRunClaimResult =
  | {
    kind: "claimed";
    claim: MediaEventRunExecutionClaim;
    run: Record<string, any>;
  }
  | { kind: "ready"; run: Record<string, any> }
  | {
    kind: "busy";
    reason: "active" | "provider_outcome_unknown";
    run: Record<string, any>;
  };

function claimFilter(claim: MediaEventRunExecutionClaim) {
  return {
    _id: claim.runId,
    state: "building",
    "executionClaim.id": claim.claimId,
  };
}

export async function claimMediaEventRun(
  db: Db,
  input: {
    runId: string;
    jobId: string;
    initial: Record<string, unknown>;
  },
  options: { now?: Date; leaseMs?: number; claimId?: string } = {},
): Promise<MediaEventRunClaimResult> {
  const collection = db.collection<any>("media_event_runs");
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
    if ((error as { code?: number })?.code !== 11000) throw error;
  }

  const claimId = options.claimId ?? randomUUID();
  const attemptId = `${input.runId}:${claimId}`;
  const leaseExpiresAt = new Date(
    now.getTime() +
      Math.max(1_000, options.leaseMs ?? MEDIA_EVENT_RUN_CLAIM_LEASE_MS),
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
        executionClaim: {
          id: claimId,
          jobId: input.jobId,
          phase: "claimed",
          claimedAt: now,
          leaseExpiresAt,
        },
        updatedAt: now,
      },
      $unset: { safeError: "" },
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
  if (!existing) throw new Error("MEDIA_EVENT_RUN_NOT_FOUND");
  if (existing.state === "ready") return { kind: "ready", run: existing };
  if (existing.state === "provider_outcome_unknown") {
    return { kind: "busy", reason: "provider_outcome_unknown", run: existing };
  }
  const staleStarted = existing.executionClaim?.providerStartedAt &&
    existing.executionClaim?.leaseExpiresAt &&
    new Date(existing.executionClaim.leaseExpiresAt).getTime() <= now.getTime();
  return {
    kind: "busy",
    reason: staleStarted ? "provider_outcome_unknown" : "active",
    run: existing,
  };
}

export async function markMediaEventRunProviderStarted(
  db: Db,
  claim: MediaEventRunExecutionClaim,
  now = new Date(),
): Promise<void> {
  const result = await db.collection<any>("media_event_runs").updateOne(
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
  if (result.modifiedCount !== 1) {
    throw new Error("MEDIA_EVENT_RUN_CLAIM_LOST");
  }
}

export async function markMediaEventRunReady(
  db: Db,
  claim: MediaEventRunExecutionClaim,
  fields: Record<string, unknown>,
  now = new Date(),
): Promise<void> {
  const result = await db.collection<any>("media_event_runs").updateOne(
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
  if (result.modifiedCount !== 1) {
    throw new Error("MEDIA_EVENT_RUN_CLAIM_LOST");
  }
}

export async function markMediaEventRunOutcomeUnknown(
  db: Db,
  claim: MediaEventRunExecutionClaim,
  safeError: string,
  now = new Date(),
): Promise<void> {
  const result = await db.collection<any>("media_event_runs").updateOne(
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
  if (result.modifiedCount !== 1) {
    throw new Error("MEDIA_EVENT_RUN_CLAIM_LOST");
  }
}

export async function markMediaEventRunFailed(
  db: Db,
  claim: MediaEventRunExecutionClaim,
  safeError: string,
  now = new Date(),
): Promise<void> {
  const result = await db.collection<any>("media_event_runs").updateOne(
    claimFilter(claim),
    {
      $set: { state: "failed", safeError, updatedAt: now },
      $unset: { executionClaim: "" },
    },
  );
  if (result.modifiedCount !== 1) {
    throw new Error("MEDIA_EVENT_RUN_CLAIM_LOST");
  }
}
