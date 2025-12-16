import { expect } from "@std/expect";
import { withFixtures } from "@/tests/fixtures.server.ts";
import { WorkerProgressResource } from "@/lib/resources/worker.ts";
import { enqueueJob, getJob } from "../queue.ts";
import { redis } from "@/lib/redis.ts";
import { VadJobDataSchema } from "../types.ts";
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
      jobId: job.id!,
      jobType: "vad",
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
  "WorkerProgressResource publishes to Redis Stream",
  withFixtures(["JobQueue", "WorkerProgressResource", "Admin"], async ({ redis }, resource, auth: Auth) => {
    const jobData: VadJobDataInput = {
      type: "vad",
      limit: 1000,
    };

    const job = await enqueueJob(jobData as any);
    const streamKey = `progress:vad:${job.id}`;

    await resource.use({
      jobId: job.id!,
      jobType: "vad",
      progress: {
        processed: 100,
        total: 1000,
        hasSpeech: 45,
      },
    });

    const stream = await redis.xrange(streamKey, "-", "+");

    expect(stream.length).toBeGreaterThan(0);

    const [_id, fields] = stream[0];
    const data: Record<string, string> = {};
    for (let i = 0; i < fields.length; i += 2) {
      data[fields[i]] = fields[i + 1];
    }

    expect(data.processed).toBe("100");
    expect(data.total).toBe("1000");
    expect(data.hasSpeech).toBe("45");
    expect(data.timestamp).toBeDefined();
  }),
);

Deno.test(
  "WorkerProgressResource sets TTL on stream",
  withFixtures(["JobQueue", "WorkerProgressResource", "Admin"], async ({ redis }, resource, auth: Auth) => {
    const jobData: VadJobDataInput = {
      type: "vad",
      limit: 1000,
    };

    const job = await enqueueJob(jobData as any);
    const streamKey = `progress:vad:${job.id}`;

    await resource.use({
      jobId: job.id!,
      jobType: "vad",
      progress: {
        processed: 100,
        total: 1000,
      },
    });

    const ttl = await redis.ttl(streamKey);

    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(3600);
  }),
);

Deno.test(
  "WorkerProgressResource throws error for non-existent job",
  withFixtures(["JobQueue", "WorkerProgressResource", "Admin"], async ({ redis }, resource, auth: Auth) => {
    const fakeJobId = "67a1b2c3d4e5f6789abcdef0";

    await expect(
      resource.use({
        jobId: fakeJobId,
        jobType: "vad",
        progress: {
          processed: 100,
          total: 1000,
        },
      }),
    ).rejects.toThrow("Job 67a1b2c3d4e5f6789abcdef0 not found");
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
    const streamKey = `progress:vad:${job.id}`;

    await resource.use({
      jobId: job.id!,
      jobType: "vad",
      progress: { processed: 100, total: 1000 },
    });

    await resource.use({
      jobId: job.id!,
      jobType: "vad",
      progress: { processed: 200, total: 1000 },
    });

    await resource.use({
      jobId: job.id!,
      jobType: "vad",
      progress: { processed: 300, total: 1000 },
    });

    const stream = await redis.xrange(streamKey, "-", "+");

    expect(stream.length).toBe(3);

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
      jobId: job.id!,
      jobType: "vad",
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
  "WorkerProgressResource validates input schema",
  withFixtures(["WorkerProgressResource"], async (resource) => {
    await expect(
      resource.use({
        jobId: "abc",
        jobType: "invalid_type" as any,
        progress: {},
      }),
    ).rejects.toThrow();
  }),
);
