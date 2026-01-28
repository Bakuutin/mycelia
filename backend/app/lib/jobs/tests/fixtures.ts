import { defineFixture } from "@/tests/fixtures.server.ts";
import { redis } from "@/lib/redis.ts";
import { ObjectId } from "bson";
import { fn } from "@std/expect";
import { JobsResource } from "@/lib/resources/worker.ts";
import { defaultResourceManager } from "@/lib/auth/resources.ts";
import { discoverJobWorkers, jobRegistry } from "../job-registry.ts";


defineFixture({
  token: "JobWorkers",
  dependencies: [],
  factory: async () => {
  },
  teardown: async () => {

  },
});

defineFixture({
  token: "JobQueue",
  dependencies: ["JobWorkers"],
  factory: async () => {
  },
  teardown: async () => {
  },
});

defineFixture({
  token: "MockPythonWorker",
  factory: () => {
    const responses = new Map<string, any>();
    const calls: Array<{ type: string; jobId: string; data: any }> = [];

    const mockFetch = fn(async (url: string | URL, options?: RequestInit) => {
      const urlString = url.toString();
      const match = urlString.match(/\/jobs\/(\w+)$/);
      const jobType = match?.[1];

      if (!jobType) {
        return new Response(JSON.stringify({ error: "Invalid URL" }), {
          status: 404,
        });
      }

      const body = options?.body ? JSON.parse(options.body as string) : {};
      calls.push({ type: jobType, jobId: body.jobId, data: body.data });

      const response = responses.get(jobType) || {
        processed: 100,
        duration: 1.5,
      };

      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    return {
      fetch: mockFetch,
      responses,
      calls,
      setResponse: (type: string, response: any) => {
        responses.set(type, response);
      },
      getCalls: () => calls,
      clearCalls: () => calls.splice(0, calls.length),
    };
  },
});

defineFixture({
  token: "JobsResource",
  dependencies: ["Mongo"],
  factory: () => {
    const resource = new JobsResource();
    defaultResourceManager.registerResource(resource);
    return resource;
  },
});

defineFixture({
  token: "MockProgressCallback",
  factory: () => {
    const progressUpdates: any[] = [];
    const callback = fn((progress: any) => {
      progressUpdates.push(progress);
    });

    return {
      callback,
      updates: progressUpdates,
      getUpdates: () => progressUpdates,
      clearUpdates: () => progressUpdates.splice(0, progressUpdates.length),
    };
  },
});
