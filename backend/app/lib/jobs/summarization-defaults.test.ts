import { expect } from "@std/expect";
import { applySummarizationDefaults } from "./summarization-defaults.ts";

const configured = {
  prompt: {
    id: "prompt-v7",
    name: "sky summariser v7",
    text: "Sky Summarizer Prompt (v7)",
  },
  defaultModel: "small",
};

Deno.test("configured default prompt wins over stale worker prompt snapshot", () => {
  const result = applySummarizationDefaults(
    { type: "summarization" },
    {
      prompt: "Sky Summarizer Prompt (v5)",
      model: "small",
    },
    configured,
  );

  expect(result).toMatchObject({
    prompt: "Sky Summarizer Prompt (v7)",
    promptName: "sky summariser v7",
    model: "small",
  });
});

Deno.test("explicit summary job values remain authoritative", () => {
  const result = applySummarizationDefaults(
    {
      type: "summarization",
      prompt: "Custom prompt",
      promptName: "Custom",
      model: "custom-model",
    },
    { prompt: "Worker prompt", model: "large" },
    configured,
  );

  expect(result).toMatchObject({
    prompt: "Custom prompt",
    promptName: "Custom",
    model: "custom-model",
  });
});

Deno.test("prompt metadata never overrides the summaries model route", () => {
  const result = applySummarizationDefaults(
    { type: "summarization" },
    { model: "small" },
    {
      prompt: {
        name: "Default prompt",
        text: "Prompt text",
        model: "large",
      } as any,
      defaultModel: "medium",
    },
  );

  expect(result.model).toBe("small");
});

Deno.test("active preset default is used when no prompt or worker model exists", () => {
  const result = applySummarizationDefaults(
    { type: "summarization" },
    undefined,
    {
      prompt: { name: "Default prompt", text: "Prompt text" },
      defaultModel: "small",
    },
  );

  expect(result.model).toBe("small");
});
