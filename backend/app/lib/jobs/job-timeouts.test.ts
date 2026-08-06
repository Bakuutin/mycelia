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
  expect(getJobTimeoutMs("tagger", { batchSize: 8 })).toBe(
    DEFAULT_JOB_TIMEOUT_MS,
  );
});

Deno.test("summarization timeout scales with batch size", () => {
  // Default batch of 25: 5 min base + 25 * 90s = 42.5 min
  expect(getJobTimeoutMs("summarization", {})).toBe(2_550_000);
  expect(getJobTimeoutMs("summarization", { batchSize: 25 })).toBe(2_550_000);
  // Small batches never drop below the legacy flat timeout
  expect(getJobTimeoutMs("summarization", { batchSize: 5 })).toBe(
    DEFAULT_JOB_TIMEOUT_MS,
  );
  // Out-of-bounds batch size is clamped to 100
  expect(getJobTimeoutMs("summarization", { batchSize: 9999 })).toBe(
    5 * 60 * 1000 + 100 * 90 * 1000,
  );
});

Deno.test("manual summarization jobs keep the flat timeout", () => {
  expect(getJobTimeoutMs("summarization", { objectId: "abc", batchSize: 25 }))
    .toBe(DEFAULT_JOB_TIMEOUT_MS);
  expect(getJobTimeoutMs("summarization", {
    start: "2026-01-01T00:00:00Z",
    end: "2026-01-01T01:00:00Z",
    batchSize: 25,
  })).toBe(DEFAULT_JOB_TIMEOUT_MS);
});
