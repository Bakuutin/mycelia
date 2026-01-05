import { expect } from "@std/expect";
import { withFixtures } from "@/tests/fixtures.server.ts";
import { processJob } from "@/lib/jobs/processor.ts";
import { enqueueJob } from "@/lib/jobs/queue.ts";
import { schema as VadJobDataSchema } from "@/workers/vad.ts";
import type { z } from "zod";
import "./fixtures.ts";

type VadJobDataInput = z.input<typeof VadJobDataSchema>;
type VadJobData = z.infer<typeof VadJobDataSchema>;

Deno.test(
  "processJob calls Python worker with correct URL",
  withFixtures(["JobQueue", "Mongo", "MockPythonWorker"], async (_fixtures, _mongo, mockWorker) => {
    const jobData: VadJobDataInput = {
      type: "vad",
      limit: 100,
    };

    const job = await enqueueJob(jobData as any);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockWorker.fetch;

    try {
      await processJob(job);

      expect(mockWorker.fetch).toHaveBeenCalled();
      const calls = mockWorker.getCalls();
      expect(calls.length).toBe(1);
      expect(calls[0].type).toBe("vad");
      expect(calls[0].jobId).toBe(job.id);
      expect(calls[0].data).toEqual({
        ...jobData,
        batchSize: 100, // Default value from schema
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  }),
);

Deno.test(
  "processJob returns result from Python worker",
  withFixtures(["JobQueue", "Mongo", "MockPythonWorker"], async (_fixtures, _mongo, mockWorker) => {
    const jobData: VadJobDataInput = {
      type: "vad",
      limit: 100,
    };

    const job = await enqueueJob(jobData as any);

    mockWorker.setResponse("vad", {
      processed: 100,
      hasSpeech: 45,
      duration: 12.5,
    });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockWorker.fetch;

    try {
      const result = await processJob(job);

      expect(result).toEqual({
        processed: 100,
        hasSpeech: 45,
        duration: 12.5,
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  }),
);

Deno.test(
  "processJob throws error on HTTP failure",
  withFixtures(["JobQueue", "Mongo"], async () => {
    const jobData: VadJobDataInput = {
      type: "vad",
      limit: 100,
    };

    const job = await enqueueJob(jobData as any);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      return new Response(JSON.stringify({ error: "Internal error" }), {
        status: 500,
      });
    };

    try {
      await expect(processJob(job)).rejects.toThrow("Python worker failed (500)");
    } finally {
      globalThis.fetch = originalFetch;
    }
  }),
);

Deno.test(
  "processJob uses PYTHON_WORKER_URL env variable",
  withFixtures(["JobQueue", "Mongo", "MockPythonWorker"], async (_fixtures, _mongo, mockWorker) => {
    const customUrl = "http://custom-python:9000";
    Deno.env.set("PYTHON_WORKER_URL", customUrl);

    const jobData: VadJobDataInput = {
      type: "vad",
      limit: 100,
    };

    const job = await enqueueJob(jobData as any);

    const originalFetch = globalThis.fetch;
    let calledUrl = "";
    globalThis.fetch = async (url) => {
      calledUrl = url.toString();
      return mockWorker.fetch(url);
    };

    try {
      await processJob(job);
      expect(calledUrl).toBe(`${customUrl}/jobs/vad`);
    } finally {
      globalThis.fetch = originalFetch;
      Deno.env.delete("PYTHON_WORKER_URL");
    }
  }),
);

Deno.test(
  "processJob defaults to localhost:8000",
  withFixtures(["JobQueue", "Mongo", "MockPythonWorker"], async (_fixtures, _mongo, mockWorker) => {
    Deno.env.delete("PYTHON_WORKER_URL");

    const jobData: VadJobDataInput = {
      type: "vad",
      limit: 100,
    };

    const job = await enqueueJob(jobData as any);

    const originalFetch = globalThis.fetch;
    let calledUrl = "";
    globalThis.fetch = async (url) => {
      calledUrl = url.toString();
      return mockWorker.fetch(url);
    };

    try {
      await processJob(job);
      expect(calledUrl).toBe("http://localhost:8000/jobs/vad");
    } finally {
      globalThis.fetch = originalFetch;
    }
  }),
);

Deno.test(
  "processJob sends job data in request body",
  withFixtures(["JobQueue", "Mongo", "MockPythonWorker"], async (_fixtures, _mongo, mockWorker) => {
    const jobData: VadJobData = {
      type: "vad",
      start: new Date("2024-01-01T00:00:00Z"),
      end: new Date("2024-01-02T00:00:00Z"),
      limit: 500,
      batchSize: 50,
    };

    const job = await enqueueJob(jobData as any);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockWorker.fetch;

    try {
      await processJob(job);

      const calls = mockWorker.getCalls();
      expect(calls[0].data).toEqual({
        type: "vad",
        start: "2024-01-01T00:00:00.000Z",
        end: "2024-01-02T00:00:00.000Z",
        limit: 500,
        batchSize: 50,
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  }),
);
