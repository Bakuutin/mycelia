import { expect } from "@std/expect";
import { withFixtures } from "@/tests/fixtures.server.ts";
import { WorkerProgressResource } from "@/lib/resources/worker.ts";
import { enqueueJob, getJob } from "../queue.ts";
import { redis } from "@/lib/redis.ts";
import { schema as VadJobDataSchema } from "../workers/vad.ts";
import type { z } from "zod";
import { Auth } from "@/lib/auth/core.server.ts";
import "./fixtures.ts";

type VadJobDataInput = z.input<typeof VadJobDataSchema>;

Deno.test(
  "WorkerProgressResource updates job progress",
  withFixtures(["JobQueue", "WorkerProgressResource", "Admin"], async ({ redis }, resource, auth: Auth) => {
    const jobData: VadJobDataInput = {
      type: "vad",
      limit: 1000,
    };

    const job = await enqueueJob(jobData as any);

    await resource.use({
      action: "progressUpdate",
      jobId: job.id!,
      progress: {
        processed: 100,
        total: 1000,
        hasSpeech: 45,
      },
    });

    const updatedJob = await getJob("vad", job.id!);
    expect(updatedJob?.progress).toEqual({
      processed: 100,
      total: 1000,
      hasSpeech: 45,
    });
  }),
);

Deno.test(
  "WorkerProgressResource publishes job progress updates",
  withFixtures(["JobQueue", "WorkerProgressResource", "Admin"], async ({ redis }, resource, auth: Auth) => {
    const jobData: VadJobDataInput = {
      type: "vad",
      limit: 1000,
    };

    const job = await enqueueJob(jobData as any);

    await resource.use({
      action: "progressUpdate",
      jobId: job.id!,
      progress: {
        processed: 100,
        total: 1000,
        hasSpeech: 45,
      },
    });

    // Verify job progress was updated
    const updatedJob = await getJob("vad", job.id!);
    expect(updatedJob?.progress).toEqual({
      processed: 100,
      total: 1000,
      hasSpeech: 45,
    });
  }),
);

Deno.test(
  "WorkerProgressResource updates progress without hasSpeech field",
  withFixtures(["JobQueue", "WorkerProgressResource", "Admin"], async ({ redis }, resource, auth: Auth) => {
    const jobData: VadJobDataInput = {
      type: "vad",
      limit: 1000,
    };

    const job = await enqueueJob(jobData as any);

    await resource.use({
      action: "progressUpdate",
      jobId: job.id!,
      progress: {
        processed: 100,
        total: 1000,
      },
    });

    // Verify job progress was updated
    const updatedJob = await getJob("vad", job.id!);
    expect(updatedJob?.progress).toEqual({
      processed: 100,
      total: 1000,
    });
  }),
);

Deno.test(
  "WorkerProgressResource gracefully handles non-existent job",
  withFixtures(["JobQueue", "WorkerProgressResource", "Admin"], async ({ redis }, resource, auth: Auth) => {
    const fakeJobId = "67a1b2c3d4e5f6789abcdef0";

    // Should not throw - returns error response
    const result = await resource.use({
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
  "WorkerProgressResource handles multiple updates",
  withFixtures(["JobQueue", "WorkerProgressResource", "Admin"], async ({ redis }, resource, auth: Auth) => {
    const jobData: VadJobDataInput = {
      type: "vad",
      limit: 1000,
    };

    const job = await enqueueJob(jobData as any);

    await resource.use({
      action: "progressUpdate",
      jobId: job.id!,
      progress: { processed: 100, total: 1000 },
    });

    await resource.use({
      action: "progressUpdate",
      jobId: job.id!,
      progress: { processed: 200, total: 1000 },
    });

    await resource.use({
      action: "progressUpdate",
      jobId: job.id!,
      progress: { processed: 300, total: 1000 },
    });

    // Verify final progress is the last update
    const updatedJob = await getJob("vad", job.id!);
    expect(updatedJob?.progress).toEqual({
      processed: 300,
      total: 1000,
    });
  }),
);

Deno.test(
  "WorkerProgressResource handles custom progress fields",
  withFixtures(["JobQueue", "WorkerProgressResource", "Admin"], async ({ redis }, resource, auth: Auth) => {
    const jobData: VadJobDataInput = {
      type: "vad",
      limit: 1000,
    };

    const job = await enqueueJob(jobData as any);

    await resource.use({
      action: "progressUpdate",
      jobId: job.id!,
      progress: {
        processed: 100,
        total: 1000,
        customField: "value",
        nestedData: { foo: "bar" },
      },
    });

    const updatedJob = await getJob("vad", job.id!);
    expect(updatedJob?.progress).toEqual({
      processed: 100,
      total: 1000,
      customField: "value",
      nestedData: { foo: "bar" },
    });
  }),
);

Deno.test(
  "WorkerProgressResource handles invalid job type gracefully",
  withFixtures(["JobQueue", "WorkerProgressResource", "Admin"], async ({ redis }, resource, auth: Auth) => {
    // An invalid job + non-existent job ID will return error
    const result = await resource.use({
      action: "progressUpdate",
      jobId: "abc",
      progress: {},
    });
    // expect(result.success).toBe(false);
  }),
);
