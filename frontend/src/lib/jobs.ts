import { wsClient } from "@/lib/websocket";
import { api } from "@/lib/api";

/**
 * Parses a job failedReason into a short human-readable error label and detail.
 */
export function parseJobError(failedReason?: string): { label: string; detail: string } | null {
  if (!failedReason) return null;
  const r = failedReason;

  // LLM API credit / token limits
  if (r.includes("requires more credits") || r.includes("can only afford")) {
    const match = r.match(/requested up to (\d+) tokens.*can only afford (\d+)/);
    return {
      label: "API credit limit",
      detail: match ? `Requested ${match[1]} tokens, only ${match[2]} available` : "Insufficient credits for request",
    };
  }
  // Rate limiting
  if (r.includes("rate_limit") || r.includes("RateLimitError") || r.includes("429")) {
    return { label: "Rate limited", detail: "API rate limit exceeded" };
  }
  // Auth / API key errors
  if (r.includes("401") || r.includes("AuthenticationError") || r.includes("invalid_api_key") || r.includes("Unauthorized")) {
    return { label: "Auth error", detail: "Invalid or expired API key" };
  }
  // Payment required (generic 402)
  if (r.includes("402") || r.includes("Payment Required") || r.includes("insufficient_quota")) {
    return { label: "Payment required", detail: "API quota or credits exhausted" };
  }
  // Timeout
  if (r === "timeout" || r.includes("timed out") || r.includes("TimeoutError") || r.includes("ETIMEDOUT")) {
    return { label: "Timeout", detail: "Job timed out" };
  }
  // Connection errors
  if (r.includes("ECONNREFUSED") || r.includes("ECONNRESET") || r.includes("ENOTFOUND") || r.includes("fetch failed")) {
    return { label: "Connection error", detail: "Failed to connect to service" };
  }
  // LLM API errors (generic)
  if (r.includes("LLM API error")) {
    const statusMatch = r.match(/LLM API error \((\d+)\)/);
    const modelMatch = r.match(/for model "([^"]+)"/);
    const status = statusMatch ? statusMatch[1] : "unknown";
    const model = modelMatch ? modelMatch[1] : "";
    return { label: `LLM error (${status})`, detail: model ? `Model "${model}" — HTTP ${status}` : `HTTP ${status}` };
  }
  // Out of memory
  if (r.includes("OutOfMemory") || r.includes("CUDA out of memory") || r.includes("OOM")) {
    return { label: "Out of memory", detail: "GPU/system memory exhausted" };
  }
  // Generic - extract first meaningful part
  if (r.length > 100) {
    const firstLine = r.split(/[\n:]/)[0].trim();
    return { label: "Error", detail: firstLine.length > 80 ? firstLine.slice(0, 80) + "…" : firstLine };
  }
  return { label: "Error", detail: r };
}

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
