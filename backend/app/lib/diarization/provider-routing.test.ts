import { assertEquals } from "jsr:@std/assert@^1.0.15";
import { zDiarizationProfilesConfig } from "@myceliasdk/config.ts";
import {
  applyDiarizatorHealthConstraints,
  buildDiarizatorJobSnapshot,
  extractDiarizatorRuntimeProvenance,
  resolveDiarizatorRoutes,
  selectDiarizatorRoute,
} from "./provider-routing.ts";

const runtime = {
  modelId: "pyannote/community-1",
  modelVersion: "model-revision-1",
  embeddingSpaceId: "space-1",
};

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

Deno.test("compatible affinity falls back from a busy preferred route", () => {
  const selected = selectDiarizatorRoute(
    [
      {
        id: "preferred",
        name: "Preferred",
        baseUrl: "http://preferred",
        enabled: true,
        priority: 1,
        concurrency: 1,
        runtimeProvenance: runtime,
      },
      {
        id: "compatible",
        name: "Compatible",
        baseUrl: "http://compatible",
        enabled: true,
        priority: 1,
        concurrency: 1,
        runtimeProvenance: runtime,
      },
      {
        id: "different",
        name: "Different",
        baseUrl: "http://different",
        enabled: true,
        priority: 1,
        concurrency: 1,
        runtimeProvenance: { ...runtime, embeddingSpaceId: "space-2" },
      },
    ],
    new Set(["preferred", "compatible", "different"]),
    { preferred: 1 },
    undefined,
    { preferredProviderId: "preferred", compatibleWith: runtime },
  );

  assertEquals(selected?.id, "compatible");
});

Deno.test("health metadata becomes a routable runtime contract", () => {
  const [resolved] = applyDiarizatorHealthConstraints(
    [{
      id: "gpu",
      name: "GPU",
      baseUrl: "http://gpu",
      enabled: true,
      priority: 1,
      concurrency: 1,
    }],
    [{
      providerProfileId: "gpu",
      detectedReadinessMode: "ready",
      metadata: {
        diarizationFingerprint: {
          model: runtime.modelId,
          resolvedRevision: runtime.modelVersion,
        },
        embeddingSpaceId: runtime.embeddingSpaceId,
      },
    }],
  );

  assertEquals(resolved.runtimeProvenance, runtime);
  assertEquals(
    extractDiarizatorRuntimeProvenance(resolved.runtimeProvenance),
    runtime,
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
  assertEquals(parsed.environmentReadinessMode, "auto");
  assertEquals(parsed.profiles[0].readinessMode, "auto");
});

Deno.test("manual and detected legacy routes are limited to one slot", () => {
  const routes = resolveDiarizatorRoutes({
    diarizationProfiles: {
      includeEnvironment: false,
      profiles: [
        {
          id: "manual",
          name: "Manual legacy",
          baseUrl: "http://manual",
          concurrency: 4,
          readinessMode: "legacy",
        },
        {
          id: "automatic",
          name: "Auto legacy",
          baseUrl: "http://automatic",
          concurrency: 3,
          readinessMode: "auto",
        },
      ],
    },
  });

  assertEquals(routes.find((route) => route.id === "manual")?.concurrency, 1);
  assertEquals(
    applyDiarizatorHealthConstraints(routes, [{
      providerProfileId: "automatic",
      detectedReadinessMode: "legacy-health",
    }]).find((route) => route.id === "automatic")?.concurrency,
    1,
  );
});

Deno.test("disabled environment diarizator remains visible but unselectable", () => {
  const routes = resolveDiarizatorRoutes({
    diarizationProfiles: {
      profiles: [],
      includeEnvironment: false,
      environmentPriority: 7,
      environmentConcurrency: 1,
    },
  });

  assertEquals(routes.length, 1);
  assertEquals(routes[0]?.id, "environment");
  assertEquals(routes[0]?.enabled, false);
  assertEquals(routes[0]?.priority, 7);
  assertEquals(selectDiarizatorRoute(routes), undefined);
});

Deno.test("diarizator snapshot replaces an inherited LLM provider name", () => {
  assertEquals(
    buildDiarizatorJobSnapshot(
      {
        providerProfileId: "remote-1",
        providerProfileName: "remote-diarizer",
        baseUrl: "http://diarizer.example.test:8085",
        runtimeProvenance: runtime,
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
        ...runtime,
        runtimeProvenanceSource: "route_readiness",
      },
    },
  );
});
