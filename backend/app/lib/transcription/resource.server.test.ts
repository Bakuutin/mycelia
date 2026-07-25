import { expect } from "@std/expect";
import { TranscriptionResource } from "./resource.server.ts";
import type { Auth } from "@/lib/auth/core.server.ts";

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    Deno.env.delete(name);
  } else {
    Deno.env.set(name, value);
  }
}

Deno.test("dedicated STT environment drives transcription and records the reported model", async () => {
  const previous = {
    url: Deno.env.get("STT_SERVER_URL"),
    key: Deno.env.get("PROXY_API_KEY"),
    model: Deno.env.get("STT_MODEL"),
  };

  Deno.env.set("STT_SERVER_URL", "http://stt.example:8001/");
  Deno.env.set("PROXY_API_KEY", "test-key");
  Deno.env.set("STT_MODEL", "whisper");

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    expect(String(input)).toBe(
      "http://stt.example:8001/v1/audio/transcriptions",
    );
    expect(
      (init?.headers as Record<string, string>).Authorization,
    ).toBe("Bearer test-key");
    expect((init?.body as FormData).get("model")).toBe("whisper");
    expect((init?.body as FormData).get("language")).toBe(null);

    return new Response(JSON.stringify({ text: "hello", segments: [] }), {
      headers: { "X-Whisper-Model": "large-v3-turbo" },
    });
  };

  try {
    const resource = new TranscriptionResource();
    const result = await resource.use({
      action: "transcribe",
      file: new Uint8Array([1, 2, 3]),
      fileName: "sample.wav",
      fileType: "audio/wav",
      language: "auto",
    }, {} as Auth) as Record<string, any>;

    expect(result.metadata).toEqual({
      model: "large-v3-turbo",
      provider: "remote_openai_compatible",
    });
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv("STT_SERVER_URL", previous.url);
    restoreEnv("PROXY_API_KEY", previous.key);
    restoreEnv("STT_MODEL", previous.model);
  }
});

Deno.test("dedicated STT configuration rejects a missing proxy key", async () => {
  const previousUrl = Deno.env.get("STT_SERVER_URL");
  const previousKey = Deno.env.get("PROXY_API_KEY");

  Deno.env.set("STT_SERVER_URL", "http://stt.example:8001");
  Deno.env.delete("PROXY_API_KEY");

  try {
    const resource = new TranscriptionResource();
    let message = "";
    try {
      await resource.getInferenceProvider();
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toBe(
      "STT_SERVER_URL and PROXY_API_KEY must both be set for dedicated STT.",
    );
  } finally {
    restoreEnv("STT_SERVER_URL", previousUrl);
    restoreEnv("PROXY_API_KEY", previousKey);
  }
});
