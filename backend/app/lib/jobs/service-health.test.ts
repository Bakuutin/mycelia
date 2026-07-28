import { expect } from "@std/expect";
import {
  classifyServiceResponse,
  getJobServiceDependencies,
  getModelsUrl,
  normalizeProviderModelId,
} from "./service-health.shared.ts";

Deno.test("normalizes provider model endpoints", () => {
  expect(getModelsUrl("http://host:8082")).toBe("http://host:8082/v1/models");
  expect(getModelsUrl("http://host:8082/v1/")).toBe(
    "http://host:8082/v1/models",
  );
  expect(
    getModelsUrl("https://generativelanguage.googleapis.com/v1beta/openai/"),
  ).toBe(
    "https://generativelanguage.googleapis.com/v1beta/openai/models",
  );
});

Deno.test("normalizes Google model resource names for routing", () => {
  expect(normalizeProviderModelId("models/gemini-3.5-flash-lite"))
    .toBe("gemini-3.5-flash-lite");
  expect(normalizeProviderModelId("Qwen.gguf")).toBe("Qwen.gguf");
});

Deno.test("classifies a model loading response separately from downtime", () => {
  expect(classifyServiceResponse(503, "Loading model")).toEqual({
    status: "loading",
    message: "Loading model",
  });
  expect(classifyServiceResponse(502, "Bad gateway: Name or service not known"))
    .toEqual({
      status: "unavailable",
      message: "Bad gateway: Name or service not known",
    });
});

Deno.test("maps external services to dependent workers", () => {
  expect(getJobServiceDependencies("transcription")).toEqual(["stt"]);
  expect(getJobServiceDependencies("summarization")).toEqual(["llm"]);
  expect(getJobServiceDependencies("vad")).toEqual([]);
});
