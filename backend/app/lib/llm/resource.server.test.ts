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
