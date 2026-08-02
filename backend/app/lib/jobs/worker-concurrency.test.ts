import { expect } from "@std/expect";
import {
  assertWorkerConcurrency,
  getAvailableForceStartSlots,
  getWorkerConcurrencyCap,
  normalizeWorkerConcurrency,
} from "./worker-concurrency.ts";
import { zWorkerConfig } from "@myceliasdk/config.ts";

Deno.test("legacy worker config defaults concurrency to one", () => {
  expect(zWorkerConfig.parse({ paused: false }).concurrency).toBe(1);
});

Deno.test("worker concurrency defaults to one and clamps legacy values", () => {
  expect(normalizeWorkerConcurrency("summarization", undefined)).toBe(1);
  expect(normalizeWorkerConcurrency("summarization", 99)).toBe(8);
});

Deno.test("transcription keeps serial job execution despite batching", () => {
  expect(getWorkerConcurrencyCap("transcription")).toBe(1);
  expect(normalizeWorkerConcurrency("transcription", 8)).toBe(1);
  expect(() => assertWorkerConcurrency("transcription", 2)).toThrow();
});

Deno.test("worker concurrency accepts the general one through eight range", () => {
  expect(assertWorkerConcurrency("summarization", 1)).toBe(1);
  expect(assertWorkerConcurrency("summarization", 8)).toBe(8);
  expect(() => assertWorkerConcurrency("summarization", 0)).toThrow();
  expect(() => assertWorkerConcurrency("summarization", 9)).toThrow();
});

Deno.test("force start never exceeds free runtime slots", () => {
  expect(getAvailableForceStartSlots(4, 1)).toBe(3);
  expect(getAvailableForceStartSlots(2, 5)).toBe(0);
});
