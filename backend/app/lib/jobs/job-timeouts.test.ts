import { expect } from "@std/expect";
import { DEFAULT_JOB_TIMEOUT_MS, getJobTimeoutMs } from "./job-timeouts.ts";

Deno.test("transcription timeout uses the snapshotted base and sequence allowance", () => {
  expect(getJobTimeoutMs("transcription", { batchSize: 8 })).toBe(
    10 * 60 * 1000,
  );
  expect(getJobTimeoutMs("transcription", {
    batchSize: 16,
    batchTimeoutBaseSeconds: 300,
    batchTimeoutPerSequenceSeconds: 120,
  })).toBe(
    37 * 60 * 1000,
  );
  expect(getJobTimeoutMs("transcription", { batchSize: 99 })).toBe(
    34 * 60 * 1000,
  );
  expect(getJobTimeoutMs("summarization", { batchSize: 8 })).toBe(
    DEFAULT_JOB_TIMEOUT_MS,
  );
});
