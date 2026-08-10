import { describe, expect, it } from "vitest";
import {
  updateDiarizationRouteConfig,
  validateDiarizationRoutes,
} from "./diarizationSettings";

describe("validateDiarizationRoutes", () => {
  it("requires at least one enabled route", () => {
    expect(validateDiarizationRoutes([], false)).toContain("Enable");
  });

  it("accepts a valid remote route", () => {
    expect(validateDiarizationRoutes([{
      id: "remote",
      name: "Remote",
      baseUrl: "https://voice.example",
      enabled: true,
      priority: 10,
    }], false)).toBeNull();
  });

  it("updates one remote route without changing the others", () => {
    const config = {
      profiles: [
        { id: "remote-a", name: "A", baseUrl: "https://a.example", enabled: true, priority: 10 },
        { id: "remote-b", name: "B", baseUrl: "https://b.example", enabled: true, priority: 20 },
      ],
      includeEnvironment: false,
      environmentPriority: 50,
    };

    const next = updateDiarizationRouteConfig(config, "remote-b", {
      enabled: false,
      priority: 42,
    });

    expect(next.profiles[0]).toEqual(config.profiles[0]);
    expect(next.profiles[1]).toMatchObject({ enabled: false, priority: 42 });
    expect(config.profiles[1]).toMatchObject({ enabled: true, priority: 20 });
  });

  it("refuses to disable the last enabled route", () => {
    expect(() => updateDiarizationRouteConfig({
      profiles: [{
        id: "remote",
        name: "Remote",
        baseUrl: "https://voice.example",
        enabled: true,
        priority: 10,
      }],
      includeEnvironment: false,
      environmentPriority: 50,
    }, "remote", { enabled: false })).toThrow(/at least one/i);
  });

  it("updates the environment route by its health id", () => {
    expect(updateDiarizationRouteConfig({
      profiles: [],
      includeEnvironment: true,
      environmentPriority: 50,
    }, "environment", { priority: 7 })).toMatchObject({
      includeEnvironment: true,
      environmentPriority: 7,
    });
  });
});
