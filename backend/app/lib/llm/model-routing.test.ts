import { expect } from "@std/expect";
import {
  getConfiguredFallback,
  resolveConfiguredModel,
} from "./model-routing.ts";

Deno.test("global default resolves legacy model aliases", () => {
  expect(resolveConfiguredModel("small", {
    defaultModel: "Qwen3.gguf",
  })).toBe("Qwen3.gguf");
  expect(resolveConfiguredModel("medium", {
    defaultModel: "Qwen3.gguf",
  })).toBe("Qwen3.gguf");
});

Deno.test("explicit task model is not replaced by global default", () => {
  expect(resolveConfiguredModel("task-specific-model", {
    defaultModel: "Qwen3.gguf",
  })).toBe("task-specific-model");
});

Deno.test("fallback is opt-in and cannot retry the primary model", () => {
  expect(getConfiguredFallback("Qwen3.gguf", false, "gemini")).toBeNull();
  expect(getConfiguredFallback("Qwen3.gguf", true, "Qwen3.gguf")).toBeNull();
  expect(getConfiguredFallback("Qwen3.gguf", true, "backup-model")).toBe(
    "backup-model",
  );
});
