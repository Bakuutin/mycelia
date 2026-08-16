// @vitest-environment node

import { describe, expect, it } from "vitest";
import type { JobInfo } from "@/types/jobs";
import { buildDiarizationRuntime } from "./diarizationRuntime";

function job(
  id: string,
  state: string,
  providerProfileId: string,
): JobInfo {
  return {
    id,
    type: "diarization",
    state,
    data: {},
    progress: {},
    timestamp: Number(id.replace(/\D/g, "")) || 0,
    routingContext: {
      providerProfileId,
      providerProfileName: providerProfileId,
      resolvedAt: "2026-08-14T00:00:00Z",
    },
  };
}

describe("diarization runtime slots", () => {
  const routes = [
    {
      id: "gpu-a",
      name: "gpu-a",
      baseUrl: "http://gpu-a:8085",
      enabled: true,
      concurrency: 2,
    },
    {
      id: "environment",
      name: "Environment diarizator",
      baseUrl: "http://diarizator:8085",
      enabled: true,
      concurrency: 1,
    },
  ];

  it("shows two jobs on one server as separate slots, not duplicates", () => {
    const runtime = buildDiarizationRuntime(routes, 3, [
      job("job-1", "active", "gpu-a"),
      job("job-2", "active", "gpu-a"),
      job("job-3", "active", "environment"),
    ]);

    expect(runtime.routes[0].slots.map((slot) => slot.job?.id)).toEqual([
      "job-1",
      "job-2",
    ]);
    expect(runtime.routes[1].slots[0].job?.id).toBe("job-3");
    expect(runtime.activeJobs).toBe(3);
    expect(runtime.concurrencyMismatch).toBe(false);
  });

  it("makes a route-capacity mismatch and queued slot explicit", () => {
    const runtime = buildDiarizationRuntime(routes, 2, [
      job("job-1", "active", "gpu-a"),
      job("job-2", "waiting", "gpu-a"),
      job("job-3", "active", "environment"),
    ]);

    expect(runtime.configuredCapacity).toBe(3);
    expect(runtime.workerConcurrency).toBe(2);
    expect(runtime.concurrencyMismatch).toBe(true);
    expect(runtime.routes[0].slots.map((slot) => slot.state)).toEqual([
      "processing",
      "queued",
    ]);
  });

  it("keeps a disabled route visible while its in-flight batch finishes", () => {
    const disabledRoutes = routes.map((route) =>
      route.id === "environment" ? { ...route, enabled: false } : route
    );
    const runtime = buildDiarizationRuntime(disabledRoutes, 2, [
      job("job-1", "active", "gpu-a"),
      job("job-2", "waiting", "gpu-a"),
      job("job-3", "active", "environment"),
    ]);

    const environment = runtime.routes.find((route) =>
      route.id === "environment"
    );
    expect(runtime.configuredCapacity).toBe(2);
    expect(environment?.enabled).toBe(false);
    expect(environment?.slots[0].state).toBe("processing");
    expect(environment?.slots[0].job?.id).toBe("job-3");
  });

  it("does not report a persisted orphan as queued work", () => {
    const orphan = job("job-1", "waiting", "gpu-a");
    orphan.queuePresent = false;
    const runtime = buildDiarizationRuntime(routes, 3, [orphan]);

    expect(runtime.queuedJobs).toBe(0);
    expect(runtime.staleJobs).toBe(1);
    expect(runtime.routes[0].slots[0].state).toBe("stale");
  });
});
