import { expect } from "@std/expect";
import { createChatProviderFetch } from "./chat-provider-fetch.ts";

const request = new Request("http://llm.test/v1/chat/completions", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ model: "qwen", stream: true }),
});

function sse(payload: string): Response {
  return new Response(payload, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function testOptions(fetch: typeof globalThis.fetch) {
  return {
    requestId: "request-1",
    providerName: "selfhost",
    model: "qwen.gguf",
    fetch,
    sleep: () => Promise.resolve(),
    loadingRetryDelaysMs: [0],
    emptyRetryDelaysMs: [0],
    transientRetryDelaysMs: [0],
  };
}

Deno.test("chat provider fetch waits for a loading model", async () => {
  let calls = 0;
  const providerFetch = createChatProviderFetch(testOptions(async () => {
    calls += 1;
    if (calls === 1) {
      return Response.json(
        { error: { message: "Loading model" } },
        { status: 503 },
      );
    }
    return sse(
      'data: {"choices":[{"delta":{"content":"ready"}}]}\n\n' +
        "data: [DONE]\n\n",
    );
  }));

  const response = await providerFetch(request);

  expect(response.status).toBe(200);
  expect(await response.text()).toContain("ready");
  expect(calls).toBe(2);
});

Deno.test("chat provider fetch retries a DONE-only successful stream", async () => {
  let calls = 0;
  const providerFetch = createChatProviderFetch(testOptions(async () => {
    calls += 1;
    if (calls === 1) return sse("data: [DONE]\n\n");
    return sse(
      'data: {"choices":[{"delta":{"tool_calls":[{"id":"call-1"}]}}]}\n\n' +
        "data: [DONE]\n\n",
    );
  }));

  const response = await providerFetch(request);

  expect(response.status).toBe(200);
  expect(await response.text()).toContain("tool_calls");
  expect(calls).toBe(2);
});

Deno.test("chat provider fetch turns repeated empty streams into a provider error", async () => {
  let calls = 0;
  const providerFetch = createChatProviderFetch(testOptions(async () => {
    calls += 1;
    return sse("data: [DONE]\n\n");
  }));

  const response = await providerFetch(request);
  const body = await response.json();

  expect(response.status).toBe(502);
  expect(body.error.type).toBe("empty_provider_stream");
  expect(body.error.message).toContain("after 2 attempts");
  expect(calls).toBe(2);
});

Deno.test("chat provider fetch preserves a usable streaming response", async () => {
  let calls = 0;
  const providerFetch = createChatProviderFetch(testOptions(async () => {
    calls += 1;
    return sse(
      'data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n' +
        'data: {"choices":[{"delta":{"content":"hello"}}]}\n\n' +
        "data: [DONE]\n\n",
    );
  }));

  const response = await providerFetch(request);

  expect(await response.text()).toContain("hello");
  expect(calls).toBe(1);
});

Deno.test("chat provider fetch does not confuse model text with a loading error", async () => {
  let calls = 0;
  const providerFetch = createChatProviderFetch(testOptions(async () => {
    calls += 1;
    return sse(
      'data: {"choices":[{"delta":{"content":"Loading model architecture notes"}}]}\n\n' +
        "data: [DONE]\n\n",
    );
  }));

  const response = await providerFetch(request);

  expect(await response.text()).toContain("Loading model architecture notes");
  expect(calls).toBe(1);
});

Deno.test("chat provider fetch rejects reasoning-only truncated streams", async () => {
  let calls = 0;
  const providerFetch = createChatProviderFetch(testOptions(async () => {
    calls += 1;
    return sse(
      'data: {"choices":[{"delta":{"reasoning_content":"Thinking"}}]}\n\n' +
        'data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\n' +
        "data: [DONE]\n\n",
    );
  }));

  const response = await providerFetch(request);
  const body = await response.json();

  expect(response.status).toBe(502);
  expect(body.error.type).toBe("empty_provider_stream");
  expect(calls).toBe(2);
});

Deno.test("chat provider fetch retries a stream read error before visible output", async () => {
  let calls = 0;
  const providerFetch = createChatProviderFetch(testOptions(async () => {
    calls += 1;
    if (calls === 1) {
      const encoder = new TextEncoder();
      let sentReasoning = false;
      return new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            if (!sentReasoning) {
              sentReasoning = true;
              controller.enqueue(encoder.encode(
                'data: {"choices":[{"delta":{"reasoning_content":"Thinking"}}]}\n\n',
              ));
              return;
            }
            controller.error(new TypeError("network error"));
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      );
    }
    return sse(
      'data: {"choices":[{"delta":{"content":"recovered"}}]}\n\n' +
        "data: [DONE]\n\n",
    );
  }));

  const response = await providerFetch(request);

  expect(await response.text()).toContain("recovered");
  expect(calls).toBe(2);
});
