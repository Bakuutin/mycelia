import { expect } from "@std/expect";
import {
  canonicalQueueJobState,
  resolveLiveJobState,
} from "./job-live-state.ts";

Deno.test("live queue state corrects a stale persisted waiting record", () => {
  expect(resolveLiveJobState("waiting", "active")).toBe("active");
  expect(resolveLiveJobState("waiting", "completed")).toBe("completed");
});

Deno.test("BullMQ waiting variants remain one UI lifecycle state", () => {
  expect(canonicalQueueJobState("prioritized")).toBe("waiting");
  expect(canonicalQueueJobState("waiting-children")).toBe("waiting");
  expect(canonicalQueueJobState("unknown")).toBeUndefined();
});
