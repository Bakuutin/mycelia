import { expect } from "@std/expect";
import {
  getConfiguredFallback,
  normalizeOpenAIBaseUrl,
  resolveConfiguredModel,
  sanitizeProviderBaseUrl,
} from "./model-routing.ts";

Deno.test("OpenAI base URL normalization preserves provider-specific API roots", () => {
  expect(normalizeOpenAIBaseUrl("http://host:8082"))
    .toBe("http://host:8082/v1");
  expect(normalizeOpenAIBaseUrl("http://host:8082/v1/"))
    .toBe("http://host:8082/v1");
  expect(
    normalizeOpenAIBaseUrl(
      "https://generativelanguage.googleapis.com/v1beta/openai/",
    ),
  ).toBe("https://generativelanguage.googleapis.com/v1beta/openai");
});

Deno.test("global default resolves legacy model aliases", () => {
  expect(resolveConfiguredModel("small", {
    defaultModel: "Qwen3.gguf",
  })).toBe("Qwen3.gguf");
  expect(resolveConfiguredModel("medium", {
    defaultModel: "Qwen3.gguf",
  })).toBe("Qwen3.gguf");
});

Deno.test("provider provenance never stores URL credentials", () => {
  expect(
    sanitizeProviderBaseUrl(
      "https://user:secret@example.test/v1?token=hidden#fragment",
    ),
  ).toBe("https://example.test/v1");
});

Deno.test("explicit task model is not replaced by global default", () => {
  expect(resolveConfiguredModel("task-specific-model", {
    defaultModel: "Qwen3.gguf",
    baseModel: "global-model.gguf",
  })).toBe("task-specific-model");
});

Deno.test("BASE_MODEL remains the default for legacy aliases", () => {
  expect(resolveConfiguredModel("medium", {
    baseModel: "global-model.gguf",
    mediumModel: "medium-model.gguf",
    defaultModel: "default-model.gguf",
  })).toBe("global-model.gguf");
});

Deno.test("fallback is opt-in and cannot retry the primary model", () => {
  expect(getConfiguredFallback("Qwen3.gguf", false, "gemini")).toBeNull();
  expect(getConfiguredFallback("Qwen3.gguf", true, "Qwen3.gguf")).toBeNull();
  expect(getConfiguredFallback("Qwen3.gguf", true, "backup-model")).toBe(
    "backup-model",
  );
});
