import { describe, expect, it } from "vitest";
import { getBlockingService } from "./ServiceHealthBanner";

describe("service health banner", () => {
  it("returns only unhealthy target services", () => {
    const healthy = {
      id: "diarizator",
      label: "Diarizator",
      status: "healthy",
      message: "ok",
    } as const;
    const unavailable = {
      ...healthy,
      status: "unavailable",
      message: "connection refused",
    } as const;

    expect(getBlockingService({ services: [healthy] }, "diarizator"))
      .toBeUndefined();
    expect(getBlockingService({ services: [unavailable] }, "diarizator"))
      .toEqual(unavailable);
  });
});
