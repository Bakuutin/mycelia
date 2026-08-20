import { describe, expect, it } from "vitest";
import {
  getEnabledDiarizationCapacity,
  setDiarizationRoutesEnabledWithinLimit,
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

describe("setDiarizationRoutesEnabledWithinLimit", () => {
  it("enables the first eight one-slot routes and leaves the ninth off", () => {
    const profiles = Array.from({ length: 8 }, (_, index) => ({
      id: `gpu-${index + 1}`,
      name: `GPU ${index + 1}`,
      baseUrl: `https://gpu-${index + 1}.example`,
      enabled: false,
      priority: index + 1,
      concurrency: 1,
    }));
    const result = setDiarizationRoutesEnabledWithinLimit(
      {
        profiles,
        includeEnvironment: false,
        environmentPriority: 50,
        environmentConcurrency: 1,
      },
      [...profiles.map((profile) => profile.id), "environment"],
      true,
    );

    expect(result.enabledRouteIds).toEqual(
      profiles.map((profile) => profile.id),
    );
    expect(result.skippedRouteIds).toEqual(["environment"]);
    expect(result.enabledCapacity).toBe(8);
    expect(result.config.profiles.every((profile) => profile.enabled)).toBe(
      true,
    );
    expect(result.config.includeEnvironment).toBe(false);
  });

  it("uses slot capacity rather than route count", () => {
    const profiles = [
      {
        id: "gpu-a",
        name: "A",
        baseUrl: "https://a.example",
        enabled: false,
        priority: 1,
        concurrency: 4,
      },
      {
        id: "gpu-b",
        name: "B",
        baseUrl: "https://b.example",
        enabled: false,
        priority: 2,
        concurrency: 4,
      },
      {
        id: "gpu-c",
        name: "C",
        baseUrl: "https://c.example",
        enabled: false,
        priority: 3,
        concurrency: 1,
      },
    ];
    const result = setDiarizationRoutesEnabledWithinLimit(
      {
        profiles,
        includeEnvironment: false,
        environmentPriority: 50,
        environmentConcurrency: 1,
      },
      profiles.map((profile) => profile.id),
      true,
    );

    expect(result.enabledRouteIds).toEqual(["gpu-a", "gpu-b"]);
    expect(result.skippedRouteIds).toEqual(["gpu-c"]);
    expect(result.enabledCapacity).toBe(8);
  });

  it("disables every visible route without deleting it", () => {
    const result = setDiarizationRoutesEnabledWithinLimit(
      {
        profiles: [{
          id: "gpu-a",
          name: "A",
          baseUrl: "https://a.example",
          enabled: true,
          priority: 1,
          concurrency: 1,
        }],
        includeEnvironment: true,
        environmentPriority: 50,
        environmentConcurrency: 1,
      },
      ["gpu-a", "environment"],
      false,
    );

    expect(result.config.profiles[0].enabled).toBe(false);
    expect(result.config.includeEnvironment).toBe(false);
    expect(result.enabledCapacity).toBe(0);
  });
});
