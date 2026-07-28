// @vitest-environment node

import { describe, expect, it } from "vitest";
import { formatJobDuration } from "./jobDuration";
import { getJobErrorCode, parseJobError } from "./jobErrors";

describe("parseJobError", () => {
  it("explains an unavailable configured inference server", () => {
    expect(parseJobError(
      'LLM API error (502) for model "medium-sky" at http://100.119.163.116:8082/v1: tcp connect error: Connection refused',
    )).toEqual({
      label: "Inference server unavailable",
      detail:
        "The configured LLM server refused the connection; start it and verify the inference URL",
    });
  });

  it("explains remote STT HTTP 500 failures", () => {
    expect(parseJobError("Failed to transcribe audio: Internal Server Error"))
      .toEqual({
        label: "Remote STT failed",
        detail:
          "The remote transcription service returned HTTP 500; inspect its model/GPU logs",
      });
  });

  it("explains CUDA OOM regardless of the exact CUDA wording", () => {
    expect(parseJobError("RuntimeError: CUDA failed with error out of memory"))
      .toEqual({
        label: "GPU out of memory",
        detail:
          "The remote model exhausted GPU memory; reduce model load or stop the competing GPU service",
      });
  });

  it("surfaces a summarization range with no transcript", () => {
    expect(parseJobError(
      "Worker exited with code 1: Job failed: Summarization processed 0 of 25 conversation(s); No transcripts found in range",
    )).toEqual({
      label: "No transcripts for summary",
      detail:
        "The selected conversation time range has no matching transcription records",
    });
  });

  it("explains the historical missing completion message failure", () => {
    expect(parseJobError(
      "Worker exited with code 1: TypeError: Cannot read properties of undefined (reading 'content')",
    )).toEqual({
      label: "Invalid LLM response",
      detail:
        "The LLM call returned data, but the first completion choice had no message content. Verify that the summary model and endpoint support OpenAI-compatible chat completions before retrying.",
    });
  });

  it("distinguishes a loading provider health gate", () => {
    expect(parseJobError(
      "Job blocked by LLM inference health check: loading. Loading model",
    )).toEqual({
      label: "Provider model loading",
      detail:
        "The job was held before execution; retry after the provider reports healthy",
    });
  });

  it("does not confuse a model-routing error containing 429 in a job id with rate limiting", () => {
    expect(parseJobError(
      'Job 6a67f0cc78322a92938ef7b7: LLM API error (400); requested model "small" resolved to "Qwen.gguf": unexpected model name format',
    )).toEqual({
      label: "Invalid model route",
      detail:
        'Requested small resolved to "Qwen.gguf", which this provider rejected',
    });
  });

  it("still recognizes an actual HTTP 429", () => {
    expect(parseJobError("LLM API error (429): quota reached")).toEqual({
      label: "Rate limited",
      detail: "API rate limit exceeded",
    });
  });
});

describe("getJobErrorCode", () => {
  it("prefers an explicit application error code", () => {
    expect(getJobErrorCode(
      "Worker exited with code 1: LLM_INVALID_RESPONSE: missing message",
    )).toBe("LLM_INVALID_RESPONSE");
  });

  it("surfaces an LLM HTTP status", () => {
    expect(getJobErrorCode("LLM API error (429): quota reached")).toBe(
      "HTTP 429",
    );
  });

  it("surfaces a worker exit code when no more specific code exists", () => {
    expect(getJobErrorCode("Worker exited with code 1: failed")).toBe(
      "Worker exit 1",
    );
  });
});

describe("formatJobDuration", () => {
  it("formats a completed job duration", () => {
    expect(formatJobDuration(1_000, 62_500)).toBe("1m 1s");
  });

  it("uses the current time for an active job", () => {
    expect(formatJobDuration(1_000, undefined, 3_500)).toBe("2.5s");
  });

  it("does not display negative duration from stale restart timestamps", () => {
    expect(formatJobDuration(5_000, 4_000)).toBe("Restarted");
  });
});
