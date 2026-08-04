import { expect } from "@std/expect";
import { zLlmProfilesConfig } from "@myceliasdk/config.ts";
import {
  LlmProviderLimiter,
  providerAdvertisesModel,
  resolveProviderModel,
  type ResolvedLlmProvider,
  selectLlmProviders,
} from "./provider-routing.ts";

const providers: ResolvedLlmProvider[] = [
  {
    id: "openrouter",
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    apiKey: "or-key",
    aliases: {
      small: "google/gemini-2.5-flash",
      medium: "anthropic/claude-sonnet-5",
      large: "anthropic/claude-opus-5",
    },
    defaultAlias: "medium",
    enabled: true,
    priority: 10,
    concurrency: 4,
    promptCachingEnabled: true,
    source: "llm_profile",
  },
  {
    id: "local",
    name: "Local vLLM",
    baseUrl: "http://localhost:8000/v1",
    apiKey: "local-key",
    aliases: { small: "qwen3-8b" },
    defaultAlias: "small",
    enabled: true,
    priority: 20,
    concurrency: 1,
    promptCachingEnabled: false,
    source: "llm_profile",
  },
];

Deno.test("LLM alias resolution uses the provider's alias map", () => {
  expect(resolveProviderModel("small", providers[0])).toBe(
    "google/gemini-2.5-flash",
  );
  expect(resolveProviderModel("small", providers[1])).toBe("qwen3-8b");
  // Unmapped alias means the provider cannot serve the request.
  expect(resolveProviderModel("large", providers[1])).toBe(null);
  // Explicit models stay explicit and are never replaced.
  expect(resolveProviderModel("gpt-4o", providers[1])).toBe("gpt-4o");
  expect(resolveProviderModel("  ", providers[0])).toBe(null);
});

Deno.test("LLM provider selection orders the failover chain by priority", () => {
  expect(selectLlmProviders(providers, "small").map((p) => p.id)).toEqual([
    "openrouter",
    "local",
  ]);
  const swapped = providers.map((provider) => ({
    ...provider,
    priority: provider.id === "local" ? 5 : 50,
  }));
  expect(selectLlmProviders(swapped, "small").map((p) => p.id)).toEqual([
    "local",
    "openrouter",
  ]);
});

Deno.test("LLM provider selection skips disabled and alias-less providers", () => {
  expect(selectLlmProviders(providers, "large").map((p) => p.id)).toEqual([
    "openrouter",
  ]);
  expect(
    selectLlmProviders(
      providers.map((provider) => ({ ...provider, enabled: false })),
      "small",
    ),
  ).toEqual([]);
  // Explicit models keep every enabled provider in the chain; failover
  // decides at request time whether the provider actually has the model.
  expect(selectLlmProviders(providers, "gpt-4o").map((p) => p.id)).toEqual([
    "openrouter",
    "local",
  ]);
});

Deno.test("LLM providers with equal priority tie-break on name then id", () => {
  const equal = providers.map((provider) => ({ ...provider, priority: 10 }));
  expect(selectLlmProviders(equal, "small").map((p) => p.id)).toEqual([
    "local",
    "openrouter",
  ]);
});

Deno.test("LLM profile config requires an enabled route unless env is included", () => {
  const profile = {
    id: "p1",
    name: "Provider",
    baseUrl: "https://api.example.com/v1",
    apiKey: "key",
    aliases: { medium: "model-m" },
    enabled: false,
  };
  expect(() => zLlmProfilesConfig.parse({ profiles: [profile] })).toThrow(
    /At least one LLM provider profile/,
  );
  expect(
    zLlmProfilesConfig.parse({
      profiles: [profile],
      includeEnvironment: true,
    }).includeEnvironment,
  ).toBe(true);
  expect(() =>
    zLlmProfilesConfig.parse({
      profiles: [
        { ...profile, enabled: true },
        { ...profile, enabled: true },
      ],
    })
  ).toThrow(/Duplicate LLM provider profile id/);
});

Deno.test("LLM profile defaults apply for legacy configurations", () => {
  const parsed = zLlmProfilesConfig.parse({
    activeProfileId: "p1",
    profiles: [{
      id: "p1",
      name: "Provider",
      baseUrl: "https://api.example.com/v1",
      apiKey: "key",
      aliases: {
        small: "model-s",
        medium: "model-m",
        large: "model-l",
      },
    }],
  });
  expect(parsed.profiles[0].enabled).toBe(true);
  expect(parsed.profiles[0].priority).toBe(50);
  expect(parsed.includeEnvironment).toBe(false);
  expect(parsed.environmentPriority).toBe(50);
});

Deno.test("Providers advertising an explicit model outrank blind failover candidates", () => {
  // "qwen3-8b" is only advertised by the lower-priority local provider, so it
  // must be tried first; the higher-priority provider stays as failover.
  expect(providerAdvertisesModel("qwen3-8b", providers[1])).toBe(true);
  expect(providerAdvertisesModel("qwen3-8b", providers[0])).toBe(false);
  expect(selectLlmProviders(providers, "qwen3-8b").map((p) => p.id)).toEqual([
    "local",
    "openrouter",
  ]);
  // Aliases keep pure priority order.
  expect(selectLlmProviders(providers, "small").map((p) => p.id)).toEqual([
    "openrouter",
    "local",
  ]);
});

Deno.test("Equal priorities balance by in-flight load ratio", () => {
  const equal = providers.map((provider) => ({ ...provider, priority: 10 }));
  // openrouter (concurrency 4) with 2 in flight = 0.5; local (1) idle = 0.
  expect(
    selectLlmProviders(equal, "small", { openrouter: 2 }).map((p) => p.id),
  ).toEqual(["local", "openrouter"]);
  expect(
    selectLlmProviders(equal, "small", { local: 1, openrouter: 1 })
      .map((p) => p.id),
  ).toEqual(["openrouter", "local"]);
});

Deno.test("LlmProviderLimiter enforces per-provider budgets and wakes waiters", async () => {
  const limiter = new LlmProviderLimiter();
  const local = providers[1]; // concurrency 1

  expect(limiter.tryAcquire(local)).toBe(true);
  expect(limiter.tryAcquire(local)).toBe(false);
  expect(limiter.load()).toEqual({ [local.id]: 1 });

  let woke = false;
  const waiter = limiter.waitForRelease().then(() => {
    woke = true;
  });
  limiter.release(local.id);
  await waiter;
  expect(woke).toBe(true);
  expect(limiter.load()).toEqual({});
  expect(limiter.tryAcquire(local)).toBe(true);
});
