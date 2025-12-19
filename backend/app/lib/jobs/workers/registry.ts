import type { Job } from "bullmq";
import type { JobData, JobResult, JobType } from "../types.ts";
import { processSummarizationJob } from "./summarization.ts";
import { processHistRecalculationJob } from "./histRecalculation.ts";
import { processPythonJob } from "./python.ts";

export type JobWorker = (job: Job<JobData>) => Promise<JobResult>;

const workerRegistry = new Map<JobType, JobWorker>();

export function registerWorker(jobType: JobType, worker: JobWorker): void {
  workerRegistry.set(jobType, worker);
}

export function getWorker(jobType: JobType): JobWorker {
  const worker = workerRegistry.get(jobType);
  if (!worker) {
    throw new Error(`No worker registered for job type: ${jobType}`);
  }
  return worker;
}

registerWorker("summarization", processSummarizationJob);
registerWorker("histRecalculation", processHistRecalculationJob);
registerWorker("vad", processPythonJob);
registerWorker("transcription", processPythonJob);
registerWorker("diarization", processPythonJob);
registerWorker("ingestion", processPythonJob);
registerWorker("testPythonIntegration", processPythonJob);


