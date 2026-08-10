import { describe, expect, it } from "vitest";
import { validateDiarizationRoutes } from "./diarizationSettings";

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
});
