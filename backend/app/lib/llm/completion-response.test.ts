import { expect } from "@std/expect";
import {
  assertCompletionNotTruncated,
  getChatCompletionText,
  normalizeChatCompletionResponse,
} from "./completion-response.ts";

Deno.test("normalizes a legacy completion choice with text", () => {
  const response: {
    choices: Array<{
      text: string;
      message?: { role: string; content: string };
    }>;
  } = {
    choices: [{ text: "Legacy summary" }],
  };

  normalizeChatCompletionResponse(response, {
    requestedModel: "small",
    resolvedModel: "legacy-model",
  });

  expect(response.choices[0].message).toEqual({
    role: "assistant",
    content: "Legacy summary",
  });
});

Deno.test("rejects a successful response whose first choice has no message", () => {
  const invalidResponse = () =>
    normalizeChatCompletionResponse(
      {
        choices: [{ finish_reason: "stop" }],
        usage: { prompt_tokens: 42, completion_tokens: 0 },
      },
      {
        requestedModel: "small",
        resolvedModel: "gemini-3.5-flash-lite",
        purpose: "summary",
      },
    );

  expect(invalidResponse).toThrow(
    "LLM_INVALID_RESPONSE: Provider returned HTTP 200, but choices[0].message was missing",
  );
  expect(invalidResponse).toThrow('finish_reason: "stop"');
  expect(invalidResponse).toThrow("prompt_tokens: 42");
  expect(invalidResponse).toThrow("completion_tokens: 0");
});

Deno.test("extracts text parts from structured assistant content", () => {
  expect(getChatCompletionText(
    {
      choices: [{
        message: {
          content: [
            { type: "text", text: "Part one" },
            { type: "text", text: " and two" },
          ],
        },
      }],
    },
    { requestedModel: "medium", purpose: "summary" },
  )).toBe("Part one and two");
});

Deno.test("reports an explicit empty-response code", () => {
  expect(() =>
    getChatCompletionText(
      { choices: [{ message: { content: "" } }] },
      { requestedModel: "medium", purpose: "summary" },
    )
  ).toThrow("LLM_EMPTY_RESPONSE:");
});

Deno.test("truncated completions fail with an explicit code", () => {
  const truncated = {
    choices: [{
      message: { content: '{"partial": tru' },
      finish_reason: "length",
    }],
    usage: { completion_tokens: 512 },
  };

  expect(() =>
    assertCompletionNotTruncated(truncated, {
      requestedModel: "small",
      maxTokens: 512,
      purpose: "tagging",
    })
  ).toThrow("LLM_TRUNCATED_RESPONSE:");
  expect(() =>
    assertCompletionNotTruncated(truncated, {
      requestedModel: "small",
      maxTokens: 512,
    })
  ).toThrow("max_tokens=512");

  // Normal completions pass through untouched.
  assertCompletionNotTruncated(
    { choices: [{ message: { content: "ok" }, finish_reason: "stop" }] },
    { requestedModel: "small" },
  );
});

Deno.test("empty-but-truncated responses report truncation, not emptiness", () => {
  expect(() =>
    getChatCompletionText(
      {
        choices: [{ message: { content: "" }, finish_reason: "length" }],
        usage: { completion_tokens: 300 },
      },
      { requestedModel: "small", maxTokens: 300 },
    )
  ).toThrow("LLM_TRUNCATED_RESPONSE:");
});
