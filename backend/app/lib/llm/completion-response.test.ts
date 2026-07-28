import { expect } from "@std/expect";
import {
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
      { choices: [{ finish_reason: "stop" }] },
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
