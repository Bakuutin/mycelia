/**
 * Parses a job failedReason into a short human-readable error label and detail.
 */
export function parseJobError(failedReason?: string): { label: string; detail: string } | null {
  if (!failedReason) return null;
  const r = failedReason;

  if (r.includes("requires more credits") || r.includes("can only afford")) {
    const match = r.match(/requested up to (\d+) tokens.*can only afford (\d+)/);
    return {
      label: "API credit limit",
      detail: match ? `Requested ${match[1]} tokens, only ${match[2]} available` : "Insufficient credits for request",
    };
  }
  if (r.includes("rate_limit") || r.includes("RateLimitError") || r.includes("429")) {
    return { label: "Rate limited", detail: "API rate limit exceeded" };
  }
  if (r.includes("401") || r.includes("AuthenticationError") || r.includes("invalid_api_key") || r.includes("Unauthorized")) {
    return { label: "Auth error", detail: "Invalid or expired API key" };
  }
  if (r.includes("402") || r.includes("Payment Required") || r.includes("insufficient_quota")) {
    return { label: "Payment required", detail: "API quota or credits exhausted" };
  }
  if (r === "timeout" || r.includes("timed out") || r.includes("TimeoutError") || r.includes("ETIMEDOUT")) {
    return { label: "Timeout", detail: "Job timed out" };
  }
  if (r.includes("No transcripts found in range")) {
    return {
      label: "No transcripts for summary",
      detail: "The selected conversation time range has no matching transcription records",
    };
  }
  if (r.includes("Job blocked by") && r.includes("health check: loading")) {
    return {
      label: "Provider model loading",
      detail: "The job was held before execution; retry after the provider reports healthy",
    };
  }
  if (r.includes("Job blocked by") && r.includes("health check:")) {
    return {
      label: "Provider unavailable",
      detail: "The job was held before execution because its configured external service is unavailable",
    };
  }
  if (r.includes("Connection refused") && (r.includes("8082") || r.includes("LLM API error"))) {
    return {
      label: "Inference server unavailable",
      detail: "The configured LLM server refused the connection; start it and verify the inference URL",
    };
  }
  if (r.includes("ECONNREFUSED") || r.includes("ECONNRESET") || r.includes("ENOTFOUND") || r.includes("fetch failed") || r.includes("Connection refused")) {
    return { label: "Connection error", detail: "Failed to connect to service" };
  }
  if (r.includes("LLM API error")) {
    const statusMatch = r.match(/LLM API error \((\d+)\)/);
    const modelMatch = r.match(/for model "([^"]+)"/);
    const status = statusMatch ? statusMatch[1] : "unknown";
    const model = modelMatch ? modelMatch[1] : "";
    return { label: `LLM error (${status})`, detail: model ? `Model "${model}" — HTTP ${status}` : `HTTP ${status}` };
  }
  if (r.includes("OutOfMemory") || /CUDA.*out of memory/i.test(r) || r.includes("OOM")) {
    return { label: "GPU out of memory", detail: "The remote model exhausted GPU memory; reduce model load or stop the competing GPU service" };
  }
  if (r.includes("Failed to transcribe") && (r.includes("Internal Server Error") || r.includes("status code 500"))) {
    return {
      label: "Remote STT failed",
      detail: "The remote transcription service returned HTTP 500; inspect its model/GPU logs",
    };
  }
  if (r.length > 100) {
    const firstLine = r.split(/[\n:]/)[0].trim();
    return { label: "Error", detail: firstLine.length > 80 ? firstLine.slice(0, 80) + "…" : firstLine };
  }
  return { label: "Error", detail: r };
}
