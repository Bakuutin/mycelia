import { expect } from "@std/expect";
import {
  chooseProviderModelFromCatalog,
  clearProviderModelCatalogCache,
  parseProviderModelIds,
  resolveProviderModelForRequest,
} from "./provider-model-catalog.ts";
import type { ResolvedLlmProvider } from "./provider-routing.ts";

const provider = (
  overrides: Partial<ResolvedLlmProvider> = {},
): ResolvedLlmProvider => ({
  id: "selfhost",
  name: "Self-hosted",
  baseUrl: "http://llm.example/v1",
  apiKey: "test-key",
  aliases: { medium: "preferred-model" },
  defaultAlias: "medium",
  modelSelectionMode: "automatic",
  enabled: true,
  priority: 10,
  concurrency: 1,
  promptCachingEnabled: false,
  source: "llm_profile",
  ...overrides,
});

Deno.test("provider model catalog parses common OpenAI-compatible shapes", () => {
  expect(parseProviderModelIds(JSON.stringify({
    data: [
      { id: "model-a" },
      { model: "model-b" },
      { name: "model-c" },
      { id: "model-a" },
    ],
  }))).toEqual(["model-a", "model-b", "model-c"]);
});

Deno.test("automatic aliases prefer the configured model while it is available", () => {
  expect(
    chooseProviderModelFromCatalog(
      "medium",
      provider(),
      ["current-model", "preferred-model"],
    ),
  ).toBe("preferred-model");
});

Deno.test("automatic aliases substitute the first available model", () => {
  expect(
    chooseProviderModelFromCatalog(
      "medium",
      provider(),
      ["current-model", "another-model"],
    ),
  ).toBe("current-model");
  expect(
    chooseProviderModelFromCatalog(
      "medium",
      provider({ aliases: {} }),
      ["current-model"],
    ),
  ).toBe("current-model");
});

Deno.test("automatic selection leaves exact model requests fixed", () => {
  expect(
    chooseProviderModelFromCatalog(
      "explicit-model",
      provider(),
      ["current-model"],
    ),
  ).toBe("explicit-model");
});

Deno.test("automatic request resolution loads and caches the live catalog", async () => {
  clearProviderModelCatalogCache();
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  globalThis.fetch = () => {
    fetchCount += 1;
    return Promise.resolve(
      new Response(JSON.stringify({
        data: [{ id: "current-model" }],
      })),
    );
  };

  try {
    expect(await resolveProviderModelForRequest("medium", provider())).toBe(
      "current-model",
    );
    expect(await resolveProviderModelForRequest("medium", provider())).toBe(
      "current-model",
    );
    expect(fetchCount).toBe(1);
  } finally {
    globalThis.fetch = originalFetch;
    clearProviderModelCatalogCache();
  }
});
