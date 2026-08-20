import { describe, expect, it } from "vitest";
import {
  getEnabledDiarizationCapacity,
  updateDiarizationRouteConfig,
  validateDiarizationRoutes,
} from "./diarizationSettings";

describe("validateDiarizationRoutes", () => {
  it("permits every route to be disabled intentionally", () => {
    expect(validateDiarizationRoutes([], false)).toBeNull();
  });

  it("accepts a valid remote route", () => {
    expect(validateDiarizationRoutes([{
      id: "remote",
      name: "Remote",
      baseUrl: "https://voice.example",
      enabled: true,
      priority: 10,
      concurrency: 1,
    }], false)).toBeNull();
  });

  it("updates one remote route without changing the others", () => {
    const config = {
      profiles: [
        {
          id: "remote-a",
          name: "A",
          baseUrl: "https://a.example",
          enabled: true,
          priority: 10,
          concurrency: 1,
        },
        {
          id: "remote-b",
          name: "B",
          baseUrl: "https://b.example",
          enabled: true,
          priority: 20,
          concurrency: 2,
        },
      ],
      includeEnvironment: false,
      environmentPriority: 50,
      environmentConcurrency: 1,
    };

    const next = updateDiarizationRouteConfig(config, "remote-b", {
      enabled: false,
      priority: 42,
    });

    expect(next.profiles[0]).toEqual(config.profiles[0]);
    expect(next.profiles[1]).toMatchObject({ enabled: false, priority: 42 });
    expect(config.profiles[1]).toMatchObject({ enabled: true, priority: 20 });
  });

  it("allows disabling the last enabled route without deleting it", () => {
    expect(
      updateDiarizationRouteConfig(
        {
          profiles: [{
            id: "remote",
            name: "Remote",
            baseUrl: "https://voice.example",
            enabled: true,
            priority: 10,
            concurrency: 1,
          }],
          includeEnvironment: false,
          environmentPriority: 50,
          environmentConcurrency: 1,
        },
        "remote",
        { enabled: false },
      ).profiles[0].enabled,
    ).toBe(false);
  });

  it("updates the environment route by its health id", () => {
    expect(updateDiarizationRouteConfig(
      {
        profiles: [],
        includeEnvironment: true,
        environmentPriority: 50,
        environmentConcurrency: 1,
      },
      "environment",
      { priority: 7 },
    )).toMatchObject({
      includeEnvironment: true,
      environmentPriority: 7,
    });
  });

  it("updates environment slots by the same route id", () => {
    expect(updateDiarizationRouteConfig(
      {
        profiles: [],
        includeEnvironment: true,
        environmentPriority: 50,
        environmentConcurrency: 1,
      },
      "environment",
      { concurrency: 2 },
    )).toMatchObject({ environmentConcurrency: 2 });
  });

  it("manual legacy mode clamps remote and environment routes to one slot", () => {
    const remote = updateDiarizationRouteConfig(
      {
        profiles: [{
          id: "remote",
          name: "Remote",
          baseUrl: "https://voice.example",
          enabled: true,
          priority: 10,
          concurrency: 4,
          readinessMode: "auto",
        }],
        includeEnvironment: true,
        environmentPriority: 50,
        environmentConcurrency: 3,
        environmentReadinessMode: "auto",
      },
      "remote",
      { readinessMode: "legacy" },
    );
    expect(remote.profiles[0]).toMatchObject({
      readinessMode: "legacy",
      concurrency: 1,
    });

    const environment = updateDiarizationRouteConfig(
      remote,
      "environment",
      { readinessMode: "legacy" },
    );
    expect(environment).toMatchObject({
      environmentReadinessMode: "legacy",
      environmentConcurrency: 1,
    });
  });

  it("sums enabled provider slots for worker synchronization", () => {
    expect(getEnabledDiarizationCapacity(
      [
        {
          id: "a",
          name: "A",
          baseUrl: "https://a.example",
          enabled: true,
          priority: 10,
          concurrency: 2,
        },
        {
          id: "b",
          name: "B",
          baseUrl: "https://b.example",
          enabled: false,
          priority: 20,
          concurrency: 4,
        },
      ],
      true,
      1,
    )).toBe(3);
  });

  it("rejects more than eight total slots", () => {
    expect(validateDiarizationRoutes(
      [{
        id: "remote",
        name: "Remote",
        baseUrl: "https://voice.example",
        enabled: true,
        priority: 10,
        concurrency: 8,
      }],
      true,
      1,
    )).toContain("cannot exceed 8");
  });
});
