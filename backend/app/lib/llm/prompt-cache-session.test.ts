import { expect } from "@std/expect";
import { createPromptCacheSessionId } from "./prompt-cache-session.ts";

Deno.test("prompt-cache sessions are stable for an unchanged task prefix", () => {
  const prefix = {
    system: "Classify conversations using this tag catalogue.",
    tags: ["travel", "work"],
    responseFormat: { type: "json_object" },
  };

  expect(createPromptCacheSessionId("tagger", prefix)).toBe(
    createPromptCacheSessionId("tagger", prefix),
  );
});

Deno.test("prompt-cache sessions split when a task prefix changes", () => {
  const base = createPromptCacheSessionId("summarization-body", {
    system: "Summarize the transcript.",
  });
  const changed = createPromptCacheSessionId("summarization-body", {
    system: "Summarize the transcript and list decisions.",
  });

  expect(changed).not.toBe(base);
  expect(base).toMatch(/^summarization-body:v1:[a-f0-9]{16}$/);
});
