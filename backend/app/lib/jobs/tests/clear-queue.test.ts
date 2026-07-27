import { expect } from "@std/expect";
import { JobsResource } from "@/lib/resources/worker.ts";

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
