// @vitest-environment node

import { describe, expect, it } from "vitest";
import { parseJobError } from "./jobErrors";

describe("parseJobError", () => {
  it("explains an unavailable configured inference server", () => {
    expect(parseJobError(
      'LLM API error (502) for model "medium-sky" at http://100.119.163.116:8082/v1: tcp connect error: Connection refused',
    )).toEqual({
      label: "Inference server unavailable",
      detail: "The configured LLM server refused the connection; start it and verify the inference URL",
    });
  });

  it("explains remote STT HTTP 500 failures", () => {
    expect(parseJobError("Failed to transcribe audio: Internal Server Error"))
      .toEqual({
        label: "Remote STT failed",
        detail: "The remote transcription service returned HTTP 500; inspect its model/GPU logs",
      });
  });

  it("explains CUDA OOM regardless of the exact CUDA wording", () => {
    expect(parseJobError("RuntimeError: CUDA failed with error out of memory"))
      .toEqual({
        label: "GPU out of memory",
        detail: "The remote model exhausted GPU memory; reduce model load or stop the competing GPU service",
      });
  });

  it("surfaces a summarization range with no transcript", () => {
    expect(parseJobError(
      "Worker exited with code 1: Job failed: Summarization processed 0 of 25 conversation(s); No transcripts found in range",
    )).toEqual({
      label: "No transcripts for summary",
      detail: "The selected conversation time range has no matching transcription records",
    });
  });

  it("distinguishes a loading provider health gate", () => {
    expect(parseJobError(
      "Job blocked by LLM inference health check: loading. Loading model",
    )).toEqual({
      label: "Provider model loading",
      detail: "The job was held before execution; retry after the provider reports healthy",
    });
  });
});
