import { expect } from "@std/expect";
import { zLlmProviderProfile } from "@myceliasdk/config.ts";
import { LLMResource } from "./resource.server.ts";

const ENV_NAMES = [
  "OPENAI_BASE_URL",
  "OPENAI_API_KEY",
  "OPENAI_MODEL",
  "OPENAI_CHAT_MODEL",
  "CHAT_MODEL",
  "BASE_MODEL",
  "MODEL_SMALL",
  "MODEL_MEDIUM",
  "MODEL_LARGE",
] as const;

const COMPLETION = {
  id: "gen-completion",
  choices: [{ message: { role: "assistant", content: "hello" } }],
  usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
};

function restoreEnv(values: Map<string, string | undefined>) {
  for (const [name, value] of values) {
    if (value === undefined) Deno.env.delete(name);
    else Deno.env.set(name, value);
  }
}

// Keep provider resolution hermetic: pretend config storage is unavailable so
// only environment variables (or an injected config) drive the routes.
const noStoredConfig = () => Promise.reject(new Error("no config storage"));

function makeResourceWithProfiles(
  profiles: unknown[],
  overrides: Record<string, unknown> = {},
) {
  return new LLMResource(() =>
    Promise.resolve(
      {
        llmProfiles: { profiles, ...overrides },
      } as never,
    )
  );
}

Deno.test("LLM provider presets preserve an optional chat default", () => {
  const baseProfile = {
    id: "primary",
    name: "Primary",
    baseUrl: "https://llm.example/v1",
    apiKey: "test-key",
    aliases: {
      small: "small-model",
      medium: "medium-model",
      large: "large-model",
    },
    defaultAlias: "medium" as const,
  };

  expect(
    zLlmProviderProfile.parse({
      ...baseProfile,
      chatModel: "chat-model",
    }).chatModel,
  ).toBe("chat-model");
  expect(zLlmProviderProfile.parse(baseProfile).chatModel).toBeUndefined();
});

Deno.test("LLM environment exposes a separate default for new chats", async () => {
  const previousEnv = new Map(
    ENV_NAMES.map((name) => [name, Deno.env.get(name)]),
  );

  ENV_NAMES.forEach((name) => Deno.env.delete(name));
  Deno.env.set("OPENAI_BASE_URL", "https://llm.example/v1");
  Deno.env.set("OPENAI_API_KEY", "test-key");
  Deno.env.set("OPENAI_MODEL", "background-default");
  Deno.env.set("OPENAI_CHAT_MODEL", "chat-default");

  try {
    const result = await new LLMResource(noStoredConfig)
      .getInferenceProvider();

    expect(result?.model).toBe("background-default");
    expect(result?.chatModel).toBe("chat-default");
  } finally {
    restoreEnv(previousEnv);
  }
});

Deno.test({
  name: "OpenRouter generation metadata supplies the final completion cost",
  // Telemetry exporters fire real network ops after span.end(); they are
  // module-level infrastructure, not part of the code under test.
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const previousEnv = new Map(
      ENV_NAMES.map((name) => [name, Deno.env.get(name)]),
    );
    const originalFetch = globalThis.fetch;
    const requests: string[] = [];

    Deno.env.set("OPENAI_BASE_URL", "https://openrouter.ai/api/v1");
    Deno.env.set("OPENAI_API_KEY", "test-key");
    Deno.env.set("OPENAI_MODEL", "openrouter/test-model");

    globalThis.fetch = async (input: string | URL | Request) => {
      const url = String(input);
      requests.push(url);
      if (url === "https://openrouter.ai/api/v1/chat/completions") {
        return new Response(JSON.stringify(COMPLETION), {
          headers: { "X-Generation-Id": "gen-123" },
        });
      }
      if (url === "https://openrouter.ai/api/v1/generation?id=gen-123") {
        return new Response(JSON.stringify({ data: { total_cost: 0.001234 } }));
      }
      throw new Error(`Unexpected request: ${url}`);
    };

    try {
      const result = await new LLMResource(noStoredConfig).use({
        action: "completions",
        model: "small",
        messages: [{ role: "user", content: "hello" }],
      }, {} as never) as Record<string, unknown>;

      expect(result.response_cost).toBe(0.001234);
      expect(requests).toEqual([
        "https://openrouter.ai/api/v1/chat/completions",
        "https://openrouter.ai/api/v1/generation?id=gen-123",
      ]);
    } finally {
      globalThis.fetch = originalFetch;
      restoreEnv(previousEnv);
    }
  },
});

const PROFILE_A = {
  id: "primary",
  name: "Primary",
  baseUrl: "https://primary.example/v1",
  apiKey: "primary-key",
  aliases: { small: "primary-small", medium: "primary-medium" },
  defaultAlias: "medium",
  enabled: true,
  priority: 10,
};

const PROFILE_B = {
  id: "secondary",
  name: "Secondary",
  baseUrl: "https://secondary.example/v1",
  apiKey: "secondary-key",
  aliases: { small: "secondary-small" },
  defaultAlias: "small",
  enabled: true,
  priority: 20,
};

Deno.test({
  name: "LLM completions fail over to the next provider by priority",
  // Telemetry exporters fire real network ops after span.end(); they are
  // module-level infrastructure, not part of the code under test.
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const previousEnv = new Map(
      ENV_NAMES.map((name) => [name, Deno.env.get(name)]),
    );
    ENV_NAMES.forEach((name) => Deno.env.delete(name));
    const originalFetch = globalThis.fetch;
    const requests: string[] = [];

    globalThis.fetch = async (input: string | URL | Request) => {
      const url = String(input);
      requests.push(url);
      if (url.startsWith("https://primary.example/")) {
        return new Response("primary is down", { status: 503 });
      }
      if (url === "https://secondary.example/v1/chat/completions") {
        return new Response(JSON.stringify(COMPLETION));
      }
      throw new Error(`Unexpected request: ${url}`);
    };

    try {
      const result = await makeResourceWithProfiles([PROFILE_A, PROFILE_B]).use(
        {
          action: "completions",
          model: "small",
          messages: [{ role: "user", content: "hello" }],
        },
        {} as never,
      ) as Record<string, any>;

      expect(requests).toEqual([
        "https://primary.example/v1/chat/completions",
        "https://secondary.example/v1/chat/completions",
      ]);
      expect(result.mycelia_routing.providerProfileId).toBe("secondary");
      expect(result.mycelia_routing.resolvedModel).toBe("secondary-small");
      expect(result.mycelia_routing.providerAttempts).toHaveLength(2);
      expect(result.mycelia_routing.providerAttempts[0].providerProfileId).toBe(
        "primary",
      );
      expect(result.mycelia_routing.providerAttempts[0].error).toContain("503");
      expect(result.mycelia_routing.providerAttempts[1].error).toBeUndefined();
    } finally {
      globalThis.fetch = originalFetch;
      restoreEnv(previousEnv);
    }
  },
});

Deno.test({
  name: "LLM completions skip providers without the requested alias",
  // Telemetry exporters fire real network ops after span.end(); they are
  // module-level infrastructure, not part of the code under test.
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const previousEnv = new Map(
      ENV_NAMES.map((name) => [name, Deno.env.get(name)]),
    );
    ENV_NAMES.forEach((name) => Deno.env.delete(name));
    const originalFetch = globalThis.fetch;
    const requests: string[] = [];

    globalThis.fetch = async (input: string | URL | Request) => {
      const url = String(input);
      requests.push(url);
      return new Response(JSON.stringify(COMPLETION));
    };

    try {
      // PROFILE_B has no "medium" alias, so only the primary route may be used.
      const result = await makeResourceWithProfiles([PROFILE_A, PROFILE_B]).use(
        {
          action: "completions",
          model: "medium",
          messages: [{ role: "user", content: "hello" }],
        },
        {} as never,
      ) as Record<string, any>;

      expect(requests).toEqual(["https://primary.example/v1/chat/completions"]);
      expect(result.mycelia_routing.resolvedModel).toBe("primary-medium");

      await expect(
        makeResourceWithProfiles([{ ...PROFILE_B, priority: 1 }]).use({
          action: "completions",
          model: "medium",
          messages: [{ role: "user", content: "hello" }],
        }, {} as never),
      ).rejects.toThrow(/No enabled LLM provider can serve model "medium"/);
    } finally {
      globalThis.fetch = originalFetch;
      restoreEnv(previousEnv);
    }
  },
});

Deno.test({
  name: "LLM completions report an aggregate error when every route fails",
  // Telemetry exporters fire real network ops after span.end(); they are
  // module-level infrastructure, not part of the code under test.
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const previousEnv = new Map(
      ENV_NAMES.map((name) => [name, Deno.env.get(name)]),
    );
    ENV_NAMES.forEach((name) => Deno.env.delete(name));
    const originalFetch = globalThis.fetch;

    globalThis.fetch = async () => new Response("boom", { status: 500 });

    try {
      await expect(
        makeResourceWithProfiles([PROFILE_A, PROFILE_B]).use({
          action: "completions",
          model: "small",
          messages: [{ role: "user", content: "hello" }],
        }, {} as never),
      ).rejects.toThrow(/failed on 2 provider route\(s\)/);
    } finally {
      globalThis.fetch = originalFetch;
      restoreEnv(previousEnv);
    }
  },
});

Deno.test({
  name: "Disabled profiles are excluded and env joins only when included",
  // Telemetry exporters fire real network ops after span.end(); they are
  // module-level infrastructure, not part of the code under test.
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const previousEnv = new Map(
      ENV_NAMES.map((name) => [name, Deno.env.get(name)]),
    );
    ENV_NAMES.forEach((name) => Deno.env.delete(name));
    Deno.env.set("OPENAI_BASE_URL", "https://env.example/v1");
    Deno.env.set("OPENAI_API_KEY", "env-key");
    Deno.env.set("OPENAI_MODEL", "env-model");

    try {
      const withoutEnv = await makeResourceWithProfiles([
        { ...PROFILE_A, enabled: false },
        PROFILE_B,
      ]).getInferenceProviders();
      expect(withoutEnv.map((provider) => provider.id)).toEqual([
        "primary",
        "secondary",
      ]);
      expect(withoutEnv[0].enabled).toBe(false);

      const withEnv = await makeResourceWithProfiles(
        [PROFILE_A, PROFILE_B],
        { includeEnvironment: true, environmentPriority: 5 },
      ).getInferenceProviders();
      expect(withEnv.map((provider) => provider.id)).toEqual([
        "environment",
        "primary",
        "secondary",
      ]);
      expect(withEnv[0].priority).toBe(5);
      expect(withEnv[0].aliases.medium).toBe("env-model");
    } finally {
      restoreEnv(previousEnv);
    }
  },
});

Deno.test({
  name: "LLM completions overflow to the next provider when slots are busy",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const previousEnv = new Map(
      ENV_NAMES.map((name) => [name, Deno.env.get(name)]),
    );
    ENV_NAMES.forEach((name) => Deno.env.delete(name));
    const originalFetch = globalThis.fetch;
    const requests: string[] = [];
    let releasePrimary: (() => void) | undefined;

    globalThis.fetch = async (input: string | URL | Request) => {
      const url = String(input);
      requests.push(url);
      if (url.startsWith("https://primary.example/")) {
        // Hold the primary provider's only slot until released.
        await new Promise<void>((resolve) => {
          releasePrimary = resolve;
        });
        return new Response(JSON.stringify(COMPLETION));
      }
      return new Response(JSON.stringify(COMPLETION));
    };

    try {
      const resource = makeResourceWithProfiles([
        { ...PROFILE_A, concurrency: 1 },
        PROFILE_B,
      ]);
      const first = resource.use({
        action: "completions",
        model: "small",
        messages: [{ role: "user", content: "hello" }],
      }, {} as never) as Promise<Record<string, any>>;
      // Give the first request time to occupy primary's single slot.
      await new Promise((resolve) => setTimeout(resolve, 20));

      const second = await resource.use({
        action: "completions",
        model: "small",
        messages: [{ role: "user", content: "hello" }],
      }, {} as never) as Record<string, any>;

      // The second request overflowed to the secondary route.
      expect(second.mycelia_routing.providerProfileId).toBe("secondary");

      releasePrimary?.();
      const firstResult = await first;
      expect(firstResult.mycelia_routing.providerProfileId).toBe("primary");
      expect(requests[0]).toBe("https://primary.example/v1/chat/completions");
      expect(requests[1]).toBe(
        "https://secondary.example/v1/chat/completions",
      );
    } finally {
      globalThis.fetch = originalFetch;
      restoreEnv(previousEnv);
    }
  },
});
