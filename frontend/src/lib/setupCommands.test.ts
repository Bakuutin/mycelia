import { describe, expect, it } from "vitest";
import {
  getDockerSetupEndpoint,
  getDockerTokenCommand,
  isMediaDevSetupLocation,
} from "./setupCommands";

describe("setup commands", () => {
  it("uses the isolated media stack on port 3211", () => {
    const location = {
      hostname: "127.0.0.1",
      origin: "http://127.0.0.1:3211",
      port: "3211",
    };

    expect(isMediaDevSetupLocation(location)).toBe(true);
    expect(getDockerSetupEndpoint(location)).toBe(location.origin);
    expect(getDockerTokenCommand("Chrome-2026-08-21", location)).toBe(
      "docker exec -it -w /app mycelia-media-89da-backend-1 deno run -A server.ts token-create --name Chrome-2026-08-21",
    );
  });

  it("uses the isolated media stack on its HTTPS port", () => {
    const location = {
      hostname: "localhost",
      origin: "https://localhost:4443",
      port: "4443",
    };

    expect(getDockerSetupEndpoint(location)).toBe(location.origin);
  });

  it("keeps the standard Docker command outside the isolated stack", () => {
    const location = {
      hostname: "localhost",
      origin: "https://localhost:4433",
      port: "4433",
    };

    expect(isMediaDevSetupLocation(location)).toBe(false);
    expect(getDockerSetupEndpoint(location)).toBe("https://localhost:4433");
    expect(getDockerTokenCommand("Firefox-2026-08-21", location)).toBe(
      "docker compose exec backend deno run -A server.ts token-create --name Firefox-2026-08-21",
    );
  });
});
