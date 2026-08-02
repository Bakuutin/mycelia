import { expect } from "@std/expect";
import {
  getFailedJobRetryData,
  getFailedJobsQuery,
  groupFailedJobsForRetry,
  JobsResource,
} from "@/lib/resources/worker.ts";

Deno.test("clear_queue requires cancel permission for one worker type", () => {
  const resource = new JobsResource();

  expect(resource.extractActions({
    action: "clear_queue",
    workerType: "summarization",
  })).toEqual([{
    path: ["jobs", "summarization"],
    actions: ["cancel"],
  }]);
});

Deno.test("reset_worker requires scoped lifecycle permissions", () => {
  const resource = new JobsResource();

  expect(resource.extractActions({
    action: "reset_worker",
    workerType: "summarization",
    restart: true,
  })).toEqual([{
    path: ["jobs", "summarization"],
    actions: ["cancel", "pause", "resume", "enqueue"],
  }]);
});

Deno.test("worker concurrency requires scoped configure permission", () => {
  const resource = new JobsResource();
  expect(resource.extractActions({
    action: "set_worker_concurrency",
    workerType: "summarization",
    concurrency: 4,
  })).toEqual([{
    path: ["jobs", "summarization"],
    actions: ["configure"],
  }]);
});

Deno.test("targeted restart preserves scoped cancel and enqueue permissions", () => {
  const resource = new JobsResource();
  expect(resource.extractActions({
    action: "restart_job",
    id: "job-id",
  })).toEqual([{
    path: ["jobs", "job-id"],
    actions: ["cancel", "enqueue"],
  }]);
});

Deno.test("force start requires enqueue permission for one worker", () => {
  const resource = new JobsResource();
  expect(resource.extractActions({
    action: "force_start",
    workerType: "summarization",
    count: 2,
  })).toEqual([{
    path: ["jobs", "summarization"],
    actions: ["enqueue"],
  }]);
});

Deno.test("clear_failed requires delete permission for one worker type", () => {
  const resource = new JobsResource();

  expect(resource.extractActions({
    action: "clear_failed",
    workerType: "vad",
  })).toEqual([{
    path: ["jobs", "vad", "failed"],
    actions: ["delete"],
  }]);
});

Deno.test("dismiss_failed requires scoped history permission", () => {
  const resource = new JobsResource();

  expect(resource.extractActions({
    action: "dismiss_failed",
    id: "job-id",
    reason: "obsolete model route",
  })).toEqual([{
    path: ["jobs", "job-id"],
    actions: ["delete"],
  }]);
});

Deno.test("clear_failed query cannot delete other worker types or states", () => {
  expect(getFailedJobsQuery("vad")).toEqual({
    type: "vad",
    state: "failed",
  });
});

Deno.test("failed pipeline retries preserve the claimed source id", () => {
  expect(getFailedJobRetryData({
    data: { type: "conversation_extractor", limit: 1 },
    progress: { chunkId: "chunk-1" },
  }, "conversation_extractor")).toEqual({
    type: "conversation_extractor",
    limit: 1,
    chunkId: "chunk-1",
  });

  expect(getFailedJobRetryData({
    data: { type: "transcription" },
    progress: { sequenceId: "sequence-1" },
  }, "transcription")).toEqual({
    type: "transcription",
    sequenceId: "sequence-1",
  });
});

Deno.test("bulk retry deduplicates identical discovery jobs", () => {
  const groups = groupFailedJobsForRetry([
    {
      _id: { toString: () => "job-1" },
      data: { type: "summarization", model: "small" },
    },
    {
      _id: { toString: () => "job-2" },
      data: { model: "small", type: "summarization" },
    },
  ], "summarization");

  expect(groups).toHaveLength(1);
  expect(groups[0].failedJobs).toHaveLength(2);
});

Deno.test("bulk retry keeps distinct conversation sources separate", () => {
  const groups = groupFailedJobsForRetry([
    {
      _id: { toString: () => "job-1" },
      data: { type: "conversation_extractor", limit: 1 },
      progress: { chunkId: "chunk-1" },
    },
    {
      _id: { toString: () => "job-2" },
      data: { type: "conversation_extractor", limit: 1 },
      progress: { chunkId: "chunk-2" },
    },
  ], "conversation_extractor");

  expect(groups).toHaveLength(2);
  expect(groups.map((group) => group.data.chunkId)).toEqual([
    "chunk-1",
    "chunk-2",
  ]);
});
