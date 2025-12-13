import { expect } from "@std/expect";
import { withFixtures } from "@/tests/fixtures.server.ts";
import { enqueueJob, getQueue, getJob } from "../queue.ts";
import { ObjectId } from "mongodb";
import type { VadJobData } from "../types.ts";
import "./fixtures.ts";

Deno.test(
  "enqueueJob creates job with ObjectId",
  withFixtures(["JobQueue"], async () => {
    const jobData: VadJobData = {
      type: "vad",
      limit: 100,
    };

    const job = await enqueueJob(jobData);

    expect(job.id).toBeDefined();
    expect(ObjectId.isValid(job.id!)).toBe(true);
    expect(job.data).toEqual(jobData);
  }),
);

Deno.test(
  "enqueueJob accepts custom jobId",
  withFixtures(["JobQueue"], async () => {
    const customId = new ObjectId().toString();
    const jobData: VadJobData = {
      type: "vad",
      limit: 100,
    };

    const job = await enqueueJob(jobData, { jobId: customId });

    expect(job.id).toBe(customId);
  }),
);

Deno.test(
  "enqueueJob sets priority",
  withFixtures(["JobQueue"], async () => {
    const jobData: VadJobData = {
      type: "vad",
      limit: 100,
    };

    const job = await enqueueJob(jobData, { priority: 5 });

    expect(job.opts.priority).toBe(5);
  }),
);

Deno.test(
  "getQueue returns queue for job type",
  withFixtures(["JobQueue"], async () => {
    const vadQueue = getQueue("vad");

    expect(vadQueue).toBeDefined();
    expect(vadQueue.name).toBe("jobs-vad");
  }),
);

Deno.test(
  "getQueue returns same instance for same type",
  withFixtures(["JobQueue"], async () => {
    const vadQueue1 = getQueue("vad");
    const vadQueue2 = getQueue("vad");

    expect(vadQueue1).toBe(vadQueue2);
  }),
);

Deno.test(
  "getJob retrieves enqueued job",
  withFixtures(["JobQueue"], async () => {
    const jobData: VadJobData = {
      type: "vad",
      limit: 100,
    };

    const enqueuedJob = await enqueueJob(jobData);
    const retrievedJob = await getJob("vad", enqueuedJob.id!);

    expect(retrievedJob).toBeDefined();
    expect(retrievedJob?.id).toBe(enqueuedJob.id);
    expect(retrievedJob?.data).toEqual(jobData);
  }),
);

Deno.test(
  "getJob returns null for non-existent job",
  withFixtures(["JobQueue"], async () => {
    const fakeId = new ObjectId().toString();
    const job = await getJob("vad", fakeId);

    expect(job).toBeNull();
  }),
);

Deno.test(
  "enqueued job has correct default options",
  withFixtures(["JobQueue"], async () => {
    const jobData: VadJobData = {
      type: "vad",
      limit: 100,
    };

    const job = await enqueueJob(jobData);

    expect(job.opts.attempts).toBe(3);
    expect(job.opts.backoff).toEqual({
      type: "exponential",
      delay: 2000,
    });
  }),
);

Deno.test(
  "multiple job types use separate queues",
  withFixtures(["JobQueue"], async () => {
    const vadData: VadJobData = {
      type: "vad",
      limit: 100,
    };

    const vadJob = await enqueueJob(vadData);

    const vadQueue = getQueue("vad");
    const transcriptionQueue = getQueue("transcription");

    expect(vadQueue.name).toBe("jobs-vad");
    expect(transcriptionQueue.name).toBe("jobs-transcription");
    expect(vadQueue).not.toBe(transcriptionQueue);

    const retrievedVadJob = await getJob("vad", vadJob.id!);
    expect(retrievedVadJob).toBeDefined();

    const notInTranscriptionQueue = await getJob("transcription", vadJob.id!);
    expect(notInTranscriptionQueue).toBeNull();
  }),
);
