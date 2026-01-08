import { expect } from "@std/expect";
import { withFixtures } from "@/tests/fixtures.server.ts";
import { enqueueJob } from "../queue.ts";
import { schema as VadJobDataSchema } from "@/workers/vad.ts";
import type { z } from "zod";
import { Auth } from "@/lib/auth/core.server.ts";
import "./fixtures.ts";

type VadJobDataInput = z.input<typeof VadJobDataSchema>;

Deno.test(
  "JobsResource updates job progress",
  withFixtures(["Admin", "JobsResource"], async (auth: Auth) => {
    const jobData: VadJobDataInput = {
      type: "vad",
      limit: 1000,
    };

    const job = await enqueueJob(jobData as any);

    const jobsResource = auth.getResource("jobs");

    await jobsResource({
      action: "progressUpdate",
      jobId: job.id!,
      progress: {
        processed: 100,
        total: 1000,
        hasSpeech: 45,
      },
    });

    const updatedJob = await jobsResource({
      action: "get",
      id: job.id!,
    });
    expect(updatedJob?.progress).toEqual({
      processed: 100,
      total: 1000,
      hasSpeech: 45,
    });
  }),
);

Deno.test(
  "JobsResource publishes job progress updates",
  withFixtures(["Admin", "JobsResource"], async (auth: Auth) => {
    const jobData: VadJobDataInput = {
      type: "vad",
      limit: 1000,
    };

    const job = await enqueueJob(jobData as any);
    const jobsResource = auth.getResource("jobs");

    await jobsResource({
      action: "progressUpdate",
      jobId: job.id!,
      progress: {
        processed: 100,
        total: 1000,
        hasSpeech: 45,
      },
    });

    // Verify job progress was updated
    const updatedJob = await jobsResource({ action: "get", id: job.id! });
    expect(updatedJob?.progress).toEqual({
      processed: 100,
      total: 1000,
      hasSpeech: 45,
    });
  }),
);

Deno.test(
  "JobsResource updates progress without hasSpeech field",
  withFixtures(["Admin", "JobsResource"], async (auth: Auth) => {
    const jobData: VadJobDataInput = {
      type: "vad",
      limit: 1000,
    };

    const job = await enqueueJob(jobData as any);
    const jobsResource = auth.getResource("jobs");

    await jobsResource({
      action: "progressUpdate",
      jobId: job.id!,
      progress: {
        processed: 100,
        total: 1000,
      },
    });

    // Verify job progress was updated
    const updatedJob = await jobsResource({ action: "get", id: job.id! });
    expect(updatedJob?.progress).toEqual({
      processed: 100,
      total: 1000,
    });
  }),
);

Deno.test(
  "JobsResource gracefully handles non-existent job",
  withFixtures(["Admin", "JobsResource"], async (auth: Auth) => {
    const fakeJobId = "67a1b2c3d4e5f6789abcdef0";
    const jobsResource = auth.getResource("jobs");

    // Should not throw - returns error response
    const result = await jobsResource({
      action: "progressUpdate",
      jobId: fakeJobId,
      progress: {
        processed: 100,
        total: 1000,
      },
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Job not found");
  }),
);

Deno.test(
  "JobsResource handles multiple updates",
  withFixtures(["Admin", "JobsResource"], async (auth: Auth) => {
    const jobData: VadJobDataInput = {
      type: "vad",
      limit: 1000,
    };

    const job = await enqueueJob(jobData as any);
    const jobsResource = auth.getResource("jobs");

    await jobsResource({
      action: "progressUpdate",
      jobId: job.id!,
      progress: { processed: 100, total: 1000 },
    });

    await jobsResource({
      action: "progressUpdate",
      jobId: job.id!,
      progress: { processed: 200, total: 1000 },
    });

    await jobsResource({
      action: "progressUpdate",
      jobId: job.id!,
      progress: { processed: 300, total: 1000 },
    });

    // Verify final progress is the last update
    const updatedJob = await jobsResource({ action: "get", id: job.id! });
    expect(updatedJob?.progress).toEqual({
      processed: 300,
      total: 1000,
    });
  }),
);

Deno.test(
  "JobsResource handles custom progress fields",
  withFixtures(["Admin", "JobsResource"], async (auth: Auth) => {
    const jobData: VadJobDataInput = {
      type: "vad",
      limit: 1000,
    };

    const job = await enqueueJob(jobData as any);
    const jobsResource = auth.getResource("jobs");

    await jobsResource({
      action: "progressUpdate",
      jobId: job.id!,
      progress: {
        processed: 100,
        total: 1000,
        customField: "value",
        nestedData: { foo: "bar" },
      },
    });

    const updatedJob = await jobsResource({ action: "get", id: job.id! });
    expect(updatedJob?.progress).toEqual({
      processed: 100,
      total: 1000,
      customField: "value",
      nestedData: { foo: "bar" },
    });
  }),
);


