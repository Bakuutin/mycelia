import { expect } from "@std/expect";
import {
  canTrustMissingQueueRecords,
  REDIS_STABLE_BEFORE_REAP_MS,
} from "@/lib/jobs/orphan-reaper.ts";

Deno.test("missing queue records are trusted once Redis has been stable", () => {
  expect(canTrustMissingQueueRecords(REDIS_STABLE_BEFORE_REAP_MS + 1)).toEqual({
    trusted: true,
  });
});

Deno.test("missing queue records are not trusted while Redis is down", () => {
  expect(canTrustMissingQueueRecords(null)).toEqual({
    trusted: false,
    reason: "redis_unavailable",
  });
});

Deno.test("missing queue records are not trusted right after a reconnect", () => {
  // A restarted Redis restores a point-in-time snapshot, so records for jobs
  // enqueued since its last save are absent even though the jobs are alive.
  expect(canTrustMissingQueueRecords(5_000)).toEqual({
    trusted: false,
    reason: "redis_recently_reconnected",
  });
});

Deno.test("the stability window is at least as long as the waiting-job grace", () => {
  // cancelMissingWaitingJobs re-enqueues after two minutes; the active reaper
  // must not fire before that recovery path has had a chance to run.
  expect(REDIS_STABLE_BEFORE_REAP_MS).toBeGreaterThanOrEqual(2 * 60 * 1000);
});
