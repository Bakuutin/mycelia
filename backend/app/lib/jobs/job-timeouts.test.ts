import { expect } from "@std/expect";
import { DEFAULT_JOB_TIMEOUT_MS, getJobTimeoutMs } from "./job-timeouts.ts";

Deno.test("transcription timeout scales with its batch snapshot", () => {
  expect(getJobTimeoutMs("transcription", { batchSize: 3 })).toBe(
    DEFAULT_JOB_TIMEOUT_MS * 3,
  );
  expect(getJobTimeoutMs("transcription", { batchSize: 99 })).toBe(
    DEFAULT_JOB_TIMEOUT_MS * 8,
  );
  expect(getJobTimeoutMs("summarization", { batchSize: 8 })).toBe(
    DEFAULT_JOB_TIMEOUT_MS,
  );
});
