import { expect } from "@std/expect";
import { getInferenceProvenance } from "./provenance.ts";

Deno.test("uses exact routing provenance when the resource provides it", () => {
  expect(getInferenceProvenance({
    model: "provider-model",
    mycelia_routing: {
      requestedModel: "small",
      resolvedModel: "provider-model",
      fallbackModel: "backup-model",
      fallbackUsed: true,
      providerBaseUrl: "http://inference:8080/v1",
      providerProfileId: "local",
      providerProfileName: "Local GPU",
    },
  }, "small")).toEqual({
    requestedModel: "small",
    resolvedModel: "provider-model",
    responseModel: "provider-model",
    fallbackModel: "backup-model",
    fallbackUsed: true,
    providerBaseUrl: "http://inference:8080/v1",
    providerProfileId: "local",
    providerProfileName: "Local GPU",
  });
});

Deno.test("keeps legacy model requests honest when routing is absent", () => {
  expect(getInferenceProvenance({}, "medium", "fallback")).toEqual({
    requestedModel: "medium",
    resolvedModel: "medium",
    responseModel: undefined,
    fallbackModel: "fallback",
    fallbackUsed: false,
    providerBaseUrl: undefined,
    providerProfileId: undefined,
    providerProfileName: undefined,
  });
});

Deno.test("preserves OpenRouter prompt-cache usage in inference provenance", () => {
  expect(getInferenceProvenance({
    model: "deepseek/deepseek-v4-flash",
    mycelia_routing: {
      requestedModel: "small",
      resolvedModel: "deepseek/deepseek-v4-flash",
      fallbackUsed: false,
      promptCaching: {
        enabled: true,
        sessionId: "mycelia:tagger:v1:aaaaaaaaaaaaaaaa",
        cacheReadTokens: 1200,
        cacheWriteTokens: 300,
      },
    },
  }, "small")).toMatchObject({
    promptCaching: {
      enabled: true,
      sessionId: "mycelia:tagger:v1:aaaaaaaaaaaaaaaa",
      cacheReadTokens: 1200,
      cacheWriteTokens: 300,
    },
  });
});

Deno.test("summarizeInferenceUsage reports the dominant provider and mixed breakdown", async () => {
  const { summarizeInferenceUsage } = await import("./provenance.ts");
  const run = (provider: string, model: string) => ({
    requestedModel: "small",
    resolvedModel: model,
    fallbackUsed: false,
    providerProfileId: provider,
    providerProfileName: provider,
  });

  const single = summarizeInferenceUsage([
    run("selfhost", "qwen"),
    run("selfhost", "qwen"),
  ]);
  expect(single?.providerProfileName).toBe("selfhost");
  expect(single?.mixed).toBeUndefined();
  expect(single?.calls).toBe(2);

  const mixed = summarizeInferenceUsage([
    run("selfhost", "qwen"),
    run("openrouter", "deepseek"),
    run("openrouter", "deepseek"),
  ]);
  expect(mixed?.mixed).toBe(true);
  // The most-used provider leads, not whichever served the last call.
  expect(mixed?.providerProfileName).toBe("openrouter");
  expect(mixed?.resolvedModel).toBe("deepseek");
  expect(mixed?.byProvider?.map((p) => `${p.providerProfileName}:${p.calls}`))
    .toEqual(["openrouter:2", "selfhost:1"]);
});
