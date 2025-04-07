import { Worker } from "bullmq";
import {
  connection,
  JobData,
  JobDataSchema,
  queue,
  QUEUE_NAME,
} from "./shared.ts";

const worker = new Worker<JobData>(
  QUEUE_NAME,
  async (job) => {
    // Validate job data against schema
    const validatedData = JobDataSchema.parse(job.data);
    console.log(validatedData, job.asJSON());
  },
  { connection },
);

worker.on("completed", (job) => {
  console.log(`${job.id} has completed!`);
});

worker.on("failed", (job, err) => {
  if (job) {
    console.log(`${job.id} has failed with ${err.message}`);
  } else {
    console.log(`Job has failed with ${err.message}`);
  }
});
