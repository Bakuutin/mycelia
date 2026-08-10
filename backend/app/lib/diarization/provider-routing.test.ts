import { assertEquals } from "jsr:@std/assert";
import {
  buildDiarizatorJobSnapshot,
  selectDiarizatorRoute,
} from "./provider-routing.ts";

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

Deno.test("diarizator snapshot replaces an inherited LLM provider name", () => {
  assertEquals(
    buildDiarizatorJobSnapshot(
      {
        providerProfileId: "faeon",
        providerProfileName: "faeon-diar",
        baseUrl: "http://100.119.163.116:8085",
      },
      { providerProfileName: "selfhost" },
      "2026-08-10T00:00:00.000Z",
    ),
    {
      diarizationServerUrl: "http://100.119.163.116:8085",
      routingContext: {
        providerProfileId: "faeon",
        providerProfileName: "faeon-diar",
        sourceId: "diarization:faeon",
        resolvedAt: "2026-08-10T00:00:00.000Z",
      },
    },
  );
});
