/**
 * Decides when the absence of a BullMQ record is trustworthy evidence that an
 * "active" Mongo job is really orphaned.
 *
 * Redis persists to an RDB snapshot, so a restart restores the queue as of the
 * last save: every job enqueued since then is simply gone, even though its
 * worker may still be running. Reaping on that signal cancels healthy jobs with
 * `queue_record_missing`, which is exactly the false positive this guards.
 */

/**
 * How long Redis must have been continuously connected before a missing queue
 * record counts as evidence. Longer than cancelMissingWaitingJobs' two-minute
 * grace so the re-enqueue recovery path gets to run first.
 */
export const REDIS_STABLE_BEFORE_REAP_MS = 5 * 60 * 1000;

export type MissingRecordDistrustReason =
  | "redis_unavailable"
  | "redis_recently_reconnected";

export type MissingRecordTrust =
  | { trusted: true }
  | { trusted: false; reason: MissingRecordDistrustReason };

/**
 * @param redisConnectedForMs Milliseconds the Redis connection has been
 * continuously established, or null when it is not currently up.
 */
export function canTrustMissingQueueRecords(
  redisConnectedForMs: number | null,
): MissingRecordTrust {
  if (redisConnectedForMs === null) {
    return { trusted: false, reason: "redis_unavailable" };
  }
  if (redisConnectedForMs < REDIS_STABLE_BEFORE_REAP_MS) {
    return { trusted: false, reason: "redis_recently_reconnected" };
  }
  return { trusted: true };
}
