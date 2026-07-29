import { expect } from "@std/expect";
import { LLMResource } from "./resource.server.ts";

const ENV_NAMES = [
  "OPENAI_BASE_URL",
  "OPENAI_API_KEY",
  "OPENAI_MODEL",
  "OPENROUTER_PROMPT_CACHING",
  "OPENROUTER_SESSION_PREFIX",
] as const;

function restoreEnv(values: Map<string, string | undefined>) {
  for (const [name, value] of values) {
    if (value === undefined) Deno.env.delete(name);
    else Deno.env.set(name, value);
  }
}

const COMPLETION = {
  id: "gen-completion",
  choices: [{ message: { role: "assistant", content: "hello" } }],
  usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
};

Deno.test("OpenRouter cache routing sends a namespaced sticky session", async () => {
  const previousEnv = new Map(
    ENV_NAMES.map((name) => [name, Deno.env.get(name)]),
  );
  const originalFetch = globalThis.fetch;
  let requestBody: Record<string, unknown> | undefined;

  Deno.env.set("OPENAI_BASE_URL", "https://openrouter.ai/api/v1");
  Deno.env.set("OPENAI_API_KEY", "test-key");
  Deno.env.set("OPENAI_MODEL", "deepseek/deepseek-v3.2");
  Deno.env.set("OPENROUTER_PROMPT_CACHING", "true");
  Deno.env.set("OPENROUTER_SESSION_PREFIX", "mycelia-test");
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify(COMPLETION));
  };

  try {
    const response = await new LLMResource().use({
      action: "completions",
      model: "small",
      session_id: "summarization:body",
      messages: [{ role: "user", content: "hello" }],
    }, {} as never) as Record<string, any>;

    expect(requestBody?.session_id).toBe("mycelia-test:summarization:body");
    expect(response.mycelia_routing.promptCaching).toEqual({
      enabled: true,
      sessionId: "mycelia-test:summarization:body",
    });
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv(previousEnv);
  }
});

Deno.test("OpenRouter cache routing can be disabled without changing the request", async () => {
  const previousEnv = new Map(
    ENV_NAMES.map((name) => [name, Deno.env.get(name)]),
  );
  const originalFetch = globalThis.fetch;
  let requestBody: Record<string, unknown> | undefined;

  Deno.env.set("OPENAI_BASE_URL", "https://openrouter.ai/api/v1");
  Deno.env.set("OPENAI_API_KEY", "test-key");
  Deno.env.set("OPENAI_MODEL", "deepseek/deepseek-v3.2");
  Deno.env.set("OPENROUTER_PROMPT_CACHING", "false");
  Deno.env.delete("OPENROUTER_SESSION_PREFIX");
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify(COMPLETION));
  };

  try {
    await new LLMResource().use({
      action: "completions",
      model: "small",
      session_id: "summarization:body",
      messages: [{ role: "user", content: "hello" }],
    }, {} as never);

    expect(requestBody?.session_id).toBeUndefined();
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv(previousEnv);
  }
});
