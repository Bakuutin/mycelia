import { wsClient } from "@/lib/websocket";
import { api } from "@/lib/api";

interface JobUpdate {
  jobId: string;
  jobType: string;
  state: string;
  progress?: any;
  result?: any;
  failedReason?: string;
}

export function subscribeToJob(
  jobId: string,
  onUpdate: (job: JobUpdate) => void
): () => void {
  return wsClient.subscribe(`jobs:${jobId}`, (event) => {
    if (
      event.event === "job.progress" ||
      event.event === "job.completed" ||
      event.event === "job.failed" ||
      event.event === "job.started" ||
      event.event === "job.active"
    ) {
      onUpdate(event.data);
    }
  });
}

export async function waitForJobCompletion(
  jobId: string,
  jobType: string,
  timeout = 60000
): Promise<any> {
  const fetchCurrentState = async () => {
    try {
      const job = await api.callResource("jobs", {
        action: "get",
        id: jobId,
      });
      return job;
    } catch (error) {
      console.warn("Failed to fetch current job state:", error);
      return null;
    }
  };

  const currentState = await fetchCurrentState();

  if (currentState?.state === "completed") {
    return currentState.result;
  } else if (currentState?.state === "failed") {
    throw new Error(currentState.failedReason || "Job failed");
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error("Job timeout"));
    }, timeout);

    const unsubscribe = subscribeToJob(jobId, (update) => {
      if (update.state === "completed") {
        clearTimeout(timer);
        unsubscribe();
        resolve(update.result);
      } else if (update.state === "failed") {
        clearTimeout(timer);
        unsubscribe();
        reject(new Error(update.failedReason || "Job failed"));
      }
    });
  });
}

export async function pollJob(
  jobId: string,
  jobType: string = "summarization",
  timeout = 60000
): Promise<any> {
  return waitForJobCompletion(jobId, jobType, timeout);
}
