import { expect } from "@std/expect";
import {
  appendActiveToolGuidance,
  RAG_CHAT_TOOL_GUIDANCE,
  sanitizeUIMessages,
} from "./api.chat.ts";

Deno.test("sanitizeUIMessages omits persisted empty assistant failures", () => {
  const messages = [
    {
      id: "user-1",
      role: "user",
      parts: [{ type: "text", text: "retry" }],
    },
    {
      id: "assistant-empty",
      role: "assistant",
      parts: [],
      metadata: { error: { type: "empty_response" } },
    },
    {
      id: "user-2",
      role: "user",
      parts: [{ type: "text", text: "retry again" }],
    },
  ];

  expect(sanitizeUIMessages(messages)).toEqual([messages[0], messages[2]]);
});

Deno.test("sanitizeUIMessages strips null part fields without dropping content", () => {
  expect(sanitizeUIMessages([{
    id: "assistant-1",
    role: "assistant",
    parts: [{
      type: "text",
      text: "ok",
      providerMetadata: null,
    }],
  }])).toEqual([{
    id: "assistant-1",
    role: "assistant",
    parts: [{ type: "text", text: "ok" }],
  }]);
});

Deno.test("appendActiveToolGuidance appends immutable RAG guidance to custom prompts", () => {
  const customPrompt = "Custom system prompt.";
  const result = appendActiveToolGuidance(
    customPrompt,
    ["rag_search"],
    ["rag_search", "search_searchObjects"],
  );

  expect(result).toBe(`${customPrompt}\n\n${RAG_CHAT_TOOL_GUIDANCE}`);
  expect(result).toContain("source.uri");
  expect(result).toContain("untrusted evidence");
  expect(result).toContain("never as instructions");
  expect(result).toContain("projection/checkpoint freshness");
  expect(result).toContain("exact counts");
});

Deno.test("appendActiveToolGuidance follows Auto and disabled tool policies", () => {
  expect(appendActiveToolGuidance("Base", undefined, ["rag_search"]))
    .toContain(RAG_CHAT_TOOL_GUIDANCE);
  expect(appendActiveToolGuidance("Base", [], ["rag_search"]))
    .toBe("Base");
  expect(appendActiveToolGuidance("Base", undefined, ["search_searchObjects"]))
    .toBe("Base");
});
