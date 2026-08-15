import { assertEquals } from "jsr:@std/assert";
import { zDiarizationProfilesConfig } from "@myceliasdk/config.ts";
import {
  buildDiarizatorJobSnapshot,
  selectDiarizatorRoute,
} from "./provider-routing.ts";

Deno.test("selectDiarizatorRoute prefers the lowest-priority healthy route", () => {
  const selected = selectDiarizatorRoute([
    {
      id: "remote",
      name: "Remote",
      baseUrl: "https://voice.example",
      enabled: true,
      priority: 20,
      concurrency: 1,
    },
    {
      id: "local",
      name: "Local",
      baseUrl: "http://host.docker.internal:8085",
      enabled: true,
      priority: 10,
      concurrency: 1,
    },
  ], new Set(["remote", "local"]));

  assertEquals(selected?.id, "local");
});

Deno.test("selectDiarizatorRoute skips disabled and unhealthy routes", () => {
  const selected = selectDiarizatorRoute([
    {
      id: "disabled",
      name: "Disabled",
      baseUrl: "http://disabled",
      enabled: false,
      priority: 1,
      concurrency: 1,
    },
    {
      id: "down",
      name: "Down",
      baseUrl: "http://down",
      enabled: true,
      priority: 2,
      concurrency: 1,
    },
    {
      id: "ready",
      name: "Ready",
      baseUrl: "http://ready",
      enabled: true,
      priority: 3,
      concurrency: 1,
    },
  ], new Set(["ready"]));

  assertEquals(selected?.id, "ready");
});

Deno.test("selectDiarizatorRoute skips providers whose slots are reserved", () => {
  const selected = selectDiarizatorRoute(
    [
      {
        id: "local",
        name: "Local",
        baseUrl: "http://local",
        enabled: true,
        priority: 10,
        concurrency: 1,
      },
      {
        id: "remote",
        name: "Remote",
        baseUrl: "http://remote",
        enabled: true,
        priority: 20,
        concurrency: 2,
      },
    ],
    new Set(["local", "remote"]),
    { local: 1 },
  );

  assertEquals(selected?.id, "remote");
});

Deno.test("selectDiarizatorRoute keeps a requested provider within its slots", () => {
  const routes = [{
    id: "local",
    name: "Local",
    baseUrl: "http://local",
    enabled: true,
    priority: 10,
    concurrency: 1,
  }];

  assertEquals(
    selectDiarizatorRoute(
      routes,
      new Set(["local"]),
      { local: 1 },
      "local",
    ),
    undefined,
  );
});

Deno.test("diarization config preserves an intentionally disabled route set", () => {
  const parsed = zDiarizationProfilesConfig.parse({
    includeEnvironment: false,
    profiles: [{
      id: "remote",
      name: "Remote",
      baseUrl: "https://voice.example",
      enabled: false,
      priority: 20,
      concurrency: 3,
    }],
  });

  assertEquals(parsed.includeEnvironment, false);
  assertEquals(parsed.profiles[0].enabled, false);
  assertEquals(parsed.profiles[0].concurrency, 3);
});

Deno.test("diarization config defaults every server to one slot", () => {
  const parsed = zDiarizationProfilesConfig.parse({
    profiles: [{
      id: "local",
      name: "Local",
      baseUrl: "http://local",
    }],
  });

  assertEquals(parsed.environmentConcurrency, 1);
  assertEquals(parsed.profiles[0].concurrency, 1);
});

Deno.test("diarizator snapshot replaces an inherited LLM provider name", () => {
  assertEquals(
    buildDiarizatorJobSnapshot(
      {
        providerProfileId: "remote-1",
        providerProfileName: "remote-diarizer",
        baseUrl: "http://diarizer.example.test:8085",
      },
      { providerProfileName: "selfhost" },
      "2026-08-10T00:00:00.000Z",
    ),
    {
      diarizationServerUrl: "http://diarizer.example.test:8085",
      routingContext: {
        providerProfileId: "remote-1",
        providerProfileName: "remote-diarizer",
        sourceId: "diarization:remote-1",
        resolvedAt: "2026-08-10T00:00:00.000Z",
      },
    },
  );
});
