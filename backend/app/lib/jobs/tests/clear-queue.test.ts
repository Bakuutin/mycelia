import { expect } from "@std/expect";
import {
  getFailedJobsQuery,
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

Deno.test("clear_failed query cannot delete other worker types or states", () => {
  expect(getFailedJobsQuery("vad")).toEqual({
    type: "vad",
    state: "failed",
  });
});
