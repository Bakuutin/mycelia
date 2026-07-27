import { expect } from "@std/expect";
import {
  classifyServiceResponse,
  getJobServiceDependencies,
  getModelsUrl,
} from "./service-health.shared.ts";

Deno.test("normalizes provider model endpoints", () => {
  expect(getModelsUrl("http://host:8082")).toBe("http://host:8082/v1/models");
  expect(getModelsUrl("http://host:8082/v1/")).toBe("http://host:8082/v1/models");
});

Deno.test("classifies a model loading response separately from downtime", () => {
  expect(classifyServiceResponse(503, "Loading model")).toEqual({
    status: "loading",
    message: "Loading model",
  });
  expect(classifyServiceResponse(502, "Bad gateway: Name or service not known")).toEqual({
    status: "unavailable",
    message: "Bad gateway: Name or service not known",
  });
});

Deno.test("maps external services to dependent workers", () => {
  expect(getJobServiceDependencies("transcription")).toEqual(["stt"]);
  expect(getJobServiceDependencies("summarization")).toEqual(["llm"]);
  expect(getJobServiceDependencies("vad")).toEqual([]);
});
