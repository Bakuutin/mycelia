import { describe, expect, it } from "vitest";
import { getJobErrorCode, parseJobError } from "./jobErrors";

describe("parseJobError truncation", () => {
  it("classifies LLM_TRUNCATED_RESPONSE with the configured cap", () => {
    const parsed = parseJobError(
      'LLM_TRUNCATED_RESPONSE: finish_reason "length" after 300 output tokens (max_tokens=300; provider openrouter). Raise the worker\'s maxTokens setting or shorten the prompt.',
    );
    expect(parsed?.label).toBe("Output truncated");
    expect(parsed?.detail).toContain("maxTokens=300");
    expect(parsed?.detail).toContain("Raise the worker's maxTokens");
  });

  it("classifies truncation without a recorded cap", () => {
    const parsed = parseJobError(
      'LLM_TRUNCATED_RESPONSE: finish_reason "length" after 4096 output tokens.',
    );
    expect(parsed?.label).toBe("Output truncated");
    expect(parsed?.detail).not.toContain("maxTokens=");
  });

  it("prefers truncation over the empty-response branch", () => {
    const parsed = parseJobError(
      "LLM_TRUNCATED_RESPONSE: something; earlier attempt hit LLM_EMPTY_RESPONSE",
    );
    expect(parsed?.label).toBe("Output truncated");
  });

  it("still classifies LLM_EMPTY_RESPONSE", () => {
    const parsed = parseJobError("LLM_EMPTY_RESPONSE: no content");
    expect(parsed?.label).toBe("Empty LLM response");
  });
});

describe("getJobErrorCode", () => {
  it("extracts the truncation code", () => {
    expect(
      getJobErrorCode('LLM_TRUNCATED_RESPONSE: finish_reason "length"'),
    ).toBe("LLM_TRUNCATED_RESPONSE");
  });
});
