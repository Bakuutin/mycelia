import { expect } from "@std/expect";
import { applySummarizationDefaults } from "./summarization-defaults.ts";

const configured = {
  prompt: {
    id: "prompt-v7",
    name: "sky summariser v7",
    text: "Sky Summarizer Prompt (v7)",
    model: "small",
  },
  defaultModel: "medium",
};

Deno.test("configured default prompt wins over stale worker prompt snapshot", () => {
  const result = applySummarizationDefaults(
    { type: "summarization" },
    {
      prompt: "Sky Summarizer Prompt (v5)",
      model: "large",
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

Deno.test("worker model is used when default prompt has no model", () => {
  const result = applySummarizationDefaults(
    { type: "summarization" },
    { model: "large" },
    {
      prompt: { name: "Default prompt", text: "Prompt text" },
      defaultModel: "medium",
    },
  );

  expect(result.model).toBe("large");
});

Deno.test("active preset default is used when no prompt or worker model exists", () => {
  const result = applySummarizationDefaults(
    { type: "summarization" },
    undefined,
    {
      prompt: { name: "Default prompt", text: "Prompt text" },
      defaultModel: "medium",
    },
  );

  expect(result.model).toBe("medium");
});
