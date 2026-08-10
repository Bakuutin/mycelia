import { assertEquals } from "jsr:@std/assert";
import { selectDiarizatorRoute } from "./provider-routing.ts";

Deno.test("selectDiarizatorRoute prefers the lowest-priority healthy route", () => {
  const selected = selectDiarizatorRoute([
    { id: "remote", name: "Remote", baseUrl: "https://voice.example", enabled: true, priority: 20 },
    { id: "local", name: "Local", baseUrl: "http://host.docker.internal:8085", enabled: true, priority: 10 },
  ], new Set(["remote", "local"]));

  assertEquals(selected?.id, "local");
});

Deno.test("selectDiarizatorRoute skips disabled and unhealthy routes", () => {
  const selected = selectDiarizatorRoute([
    { id: "disabled", name: "Disabled", baseUrl: "http://disabled", enabled: false, priority: 1 },
    { id: "down", name: "Down", baseUrl: "http://down", enabled: true, priority: 2 },
    { id: "ready", name: "Ready", baseUrl: "http://ready", enabled: true, priority: 3 },
  ], new Set(["ready"]));

  assertEquals(selected?.id, "ready");
});
