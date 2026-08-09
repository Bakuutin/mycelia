/**
 * Parses a job failedReason into a short human-readable error label and detail.
 */
function extractProviderMessage(reason: string): string | undefined {
  const match = reason.match(
    /"message"\s*:\s*"((?:\\.|[^"\\])*)"/,
  );
  if (!match) return undefined;

  try {
    return JSON.parse(`"${match[1]}"`).trim();
  } catch {
    return match[1].trim();
  }
}

export function parseJobError(
  failedReason?: string,
): { label: string; detail: string } | null {
  if (!failedReason) return null;
  const r = failedReason;
  const providerMessage = extractProviderMessage(r);

  if (r === "queue_record_missing") {
    return {
      label: "Queue record lost",
      detail:
        "Redis no longer had this job when the queue was reconciled — usually a Redis restart, which drops everything queued since its last snapshot. The job was stopped, not failed; re-run it.",
    };
  }
  if (r === "timeout") {
    return {
      label: "Timed out",
      detail:
        "The job exceeded its configured time limit and was cancelled by queue maintenance.",
    };
  }

  if (r.includes("requires more credits") || r.includes("can only afford")) {
    const match = r.match(
      /requested up to (\d+) tokens.*can only afford (\d+)/,
    );
    return {
      label: "API credit limit",
      detail: match
        ? `Requested ${match[1]} tokens, only ${match[2]} available. Top up credits or lower the worker's maxTokens setting.`
        : "Insufficient credits for request. Top up credits or lower the worker's maxTokens setting.",
    };
  }
  // Some providers use HTTP 429 for both temporary throttling and permanent
  // billing failures. Classify explicit credit failures before generic 429s.
  if (
    /(?:prepayment|prepaid) credits? (?:are )?(?:depleted|exhausted)/i.test(r)
  ) {
    return {
      label: "Prepaid credits depleted",
      detail: providerMessage ||
        "The provider account has no prepaid credits remaining",
    };
  }
  if (
    r.includes("402") || r.includes("Payment Required") ||
    r.includes("insufficient_quota")
  ) {
    return {
      label: "Payment required",
      detail: providerMessage || "API quota or credits exhausted",
    };
  }
  if (
    /rate[_ -]?limit/i.test(r) || /RateLimitError/i.test(r) ||
    /(?:LLM API error \(|HTTP |status(?: code)?[": ]+)429\b/i.test(r)
  ) {
    return { label: "Rate limited", detail: "API rate limit exceeded" };
  }
  if (
    r.includes("401") || r.includes("AuthenticationError") ||
    r.includes("invalid_api_key") || r.includes("Unauthorized")
  ) {
    return { label: "Auth error", detail: "Invalid or expired API key" };
  }
  if (
    r === "timeout" || r.includes("timed out") || r.includes("TimeoutError") ||
    r.includes("ETIMEDOUT")
  ) {
    return { label: "Timeout", detail: "Job timed out" };
  }
  if (r.includes("No transcripts found in range")) {
    return {
      label: "No transcripts for summary",
      detail:
        "The selected conversation time range has no matching transcription records",
    };
  }
  if (
    r.includes("LLM_INVALID_RESPONSE") ||
    r.includes(
      "Cannot read properties of undefined (reading 'content')",
    )
  ) {
    return {
      label: "Invalid LLM response",
      detail:
        "The LLM call returned data, but the first completion choice had no message content. Verify that the summary model and endpoint support OpenAI-compatible chat completions before retrying.",
    };
  }
  if (r.includes("LLM_TRUNCATED_RESPONSE")) {
    const cap = r.match(/max_tokens=(\d+)/)?.[1];
    return {
      label: "Output truncated",
      detail: `The model hit the output-token cap${
        cap ? ` (maxTokens=${cap})` : ""
      } before finishing. Raise the worker's maxTokens (Launch Job form or the worker's defaults) or shorten the prompt, then retry.`,
    };
  }
  if (r.includes("LLM_EMPTY_RESPONSE")) {
    return {
      label: "Empty LLM response",
      detail:
        "The model returned no usable summary text. Check model safety/output settings and the configured output-token budget before retrying.",
    };
  }
  if (r.includes("Job blocked by") && r.includes("health check: loading")) {
    return {
      label: "Provider model loading",
      detail:
        "The job was held before execution; retry after the provider reports healthy",
    };
  }
  if (r.includes("Job blocked by") && r.includes("health check:")) {
    return {
      label: "Provider unavailable",
      detail:
        "The job was held before execution because its configured external service is unavailable",
    };
  }
  if (
    r.includes("Connection refused") &&
    (r.includes("8082") || r.includes("LLM API error"))
  ) {
    return {
      label: "Inference server unavailable",
      detail:
        "The configured LLM server refused the connection; start it and verify the inference URL",
    };
  }
  if (
    r.includes("ECONNREFUSED") || r.includes("ECONNRESET") ||
    r.includes("ENOTFOUND") || r.includes("fetch failed") ||
    r.includes("Connection refused")
  ) {
    return {
      label: "Connection error",
      detail: "Failed to connect to service",
    };
  }
  if (r.includes("LLM API error")) {
    const statusMatch = r.match(/LLM API error \((\d+)\)/);
    const requestedMatch = r.match(/requested model "([^"]+)"/);
    const modelMatch = r.match(/resolved to "([^"]+)"/) ??
      r.match(/for model "([^"]+)"/);
    const status = statusMatch ? statusMatch[1] : "unknown";
    const model = modelMatch ? modelMatch[1] : "";
    if (
      /unexpected model name format|invalid.*model|model.*not found/i.test(r)
    ) {
      return {
        label: "Invalid model route",
        detail: model
          ? `Requested ${
            requestedMatch?.[1] || "model"
          } resolved to "${model}", which this provider rejected`
          : "The provider rejected the configured model name",
      };
    }
    return {
      label: `LLM error (${status})`,
      detail: model
        ? `Requested ${
          requestedMatch?.[1] || "model"
        } → "${model}" — HTTP ${status}`
        : `HTTP ${status}`,
    };
  }
  if (
    r.includes("OutOfMemory") || /CUDA.*out of memory/i.test(r) ||
    r.includes("OOM")
  ) {
    return {
      label: "GPU out of memory",
      detail:
        "The remote model exhausted GPU memory; reduce model load or stop the competing GPU service",
    };
  }
  if (
    r.includes("Failed to transcribe") &&
    (r.includes("Internal Server Error") || r.includes("status code 500"))
  ) {
    return {
      label: "Remote STT failed",
      detail:
        "The remote transcription service returned HTTP 500; inspect its model/GPU logs",
    };
  }
  if (r.length > 100) {
    const firstLine = r.split(/[\n:]/)[0].trim();
    return {
      label: "Error",
      detail: firstLine.length > 80 ? firstLine.slice(0, 80) + "…" : firstLine,
    };
  }
  return { label: "Error", detail: r };
}

export function getJobErrorCode(failedReason?: string): string | null {
  if (!failedReason) return null;

  const explicitCode = failedReason.match(
    /\b(LLM_[A-Z0-9_]+|STT_[A-Z0-9_]+|JOB_[A-Z0-9_]+)\b/,
  );
  if (explicitCode) return explicitCode[1];

  const llmStatus = failedReason.match(/LLM API error \((\d{3})\)/);
  if (llmStatus) return `HTTP ${llmStatus[1]}`;

  const httpStatus = failedReason.match(/\bHTTP\s+(\d{3})\b/i);
  if (httpStatus) return `HTTP ${httpStatus[1]}`;

  const workerExit = failedReason.match(/Worker exited with code\s+(-?\d+)/i);
  if (workerExit) return `Worker exit ${workerExit[1]}`;

  return null;
}
