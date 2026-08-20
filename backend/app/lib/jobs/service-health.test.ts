import { expect } from "@std/expect";
import {
  classifyAutoLegacyDiarizatorHealth,
  classifyServiceResponse,
  getDiarizatorHealthUrl,
  getDiarizatorReadyUrl,
  getJobServiceDependencies,
  getModelsUrl,
  getProviderHealthUrl,
  normalizeProviderModelId,
  shouldAutoFallbackToDiarizatorHealth,
  shouldFallbackToSttHealth,
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

Deno.test("falls back to STT health when a provider has no models route", () => {
  expect(getProviderHealthUrl("http://host:10301/")).toBe(
    "http://host:10301/health",
  );
  expect(shouldFallbackToSttHealth("stt", 404)).toBe(true);
  expect(shouldFallbackToSttHealth("stt", 405)).toBe(true);
  expect(shouldFallbackToSttHealth("stt", 500)).toBe(false);
  expect(shouldFallbackToSttHealth("llm", 404)).toBe(false);
});

Deno.test("builds the strict diarizator readiness URL", () => {
  expect(getDiarizatorReadyUrl("http://host:8085/")).toBe(
    "http://host:8085/ready",
  );
});

Deno.test("auto mode falls back only when a diarizator has no ready endpoint", () => {
  expect(getDiarizatorHealthUrl("http://host:8085/")).toBe(
    "http://host:8085/health",
  );
  expect(shouldAutoFallbackToDiarizatorHealth("auto", 404)).toBe(true);
  expect(shouldAutoFallbackToDiarizatorHealth("auto", 405)).toBe(true);
  expect(shouldAutoFallbackToDiarizatorHealth("auto", 503)).toBe(false);
  expect(shouldAutoFallbackToDiarizatorHealth("strict", 404)).toBe(false);
  expect(shouldAutoFallbackToDiarizatorHealth("legacy", 404)).toBe(false);
});

Deno.test("auto mode accepts only a model-ready legacy diarizator health body", () => {
  expect(classifyAutoLegacyDiarizatorHealth(
    200,
    JSON.stringify({
      status: "ok",
      service: "pyannote-diarization",
      ready: true,
      device: "cuda",
    }),
  )).toMatchObject({ status: "healthy" });
  expect(classifyAutoLegacyDiarizatorHealth(
    200,
    JSON.stringify({
      status: "ok",
      service: "pyannote-diarization",
      ready: false,
      device: "cuda",
    }),
  )).toMatchObject({ status: "unavailable" });
  expect(classifyAutoLegacyDiarizatorHealth(200, "ok")).toMatchObject({
    status: "unavailable",
  });
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
  expect(getJobServiceDependencies("diarization")).toEqual(["diarizator"]);
  expect(getJobServiceDependencies("enrollment")).toEqual(["diarizator"]);
  expect(getJobServiceDependencies("speakerMatching")).toEqual([]);
  expect(getJobServiceDependencies("vad")).toEqual([]);
});
