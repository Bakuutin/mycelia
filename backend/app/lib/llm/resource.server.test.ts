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

  Deno.env.set("OPENAI_BASE_URL", "https://llm.example/v1");
  Deno.env.set("OPENAI_API_KEY", "test-key");
  Deno.env.set("OPENAI_MODEL", "background-default");
  Deno.env.set("OPENAI_CHAT_MODEL", "chat-default");
  Deno.env.delete("CHAT_MODEL");
  Deno.env.delete("BASE_MODEL");

  try {
    const result = await new LLMResource().getInferenceProvider();

    expect(result?.model).toBe("background-default");
    expect(result?.chatModel).toBe("chat-default");
  } finally {
    restoreEnv(previousEnv);
  }
});

Deno.test("OpenRouter generation metadata supplies the final completion cost", async () => {
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
    const result = await new LLMResource().use({
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
});
