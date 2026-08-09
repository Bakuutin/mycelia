import { expect } from "@std/expect";
import {
  type ResolvedTranscriptionProvider,
  TranscriptionResource,
} from "./resource.server.ts";
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
    expect(typeof (init?.body as FormData).get("model")).toBe("string");
    expect((init?.body as FormData).get("language")).toBe(null);

    return new Response(JSON.stringify({ text: "hello", segments: [] }), {
      headers: {
        "X-Whisper-Model": "large-v3-turbo",
        "X-Whisper-VAD-Filter": "true",
      },
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
      requestedModel: "whisper",
      reportedModel: "large-v3-turbo",
      provider: "openai_compatible",
      providerProfileId: "environment",
      providerProfileName: "Environment STT",
      providerSource: "stt_env",
      providerBaseUrl: "http://stt.example:8001/",
      whisperVadFilter: true,
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

Deno.test("transcription uses the snapshotted profile and model", async () => {
  class ProfileResource extends TranscriptionResource {
    override getInferenceProvider(
      profileId?: string,
    ): Promise<ResolvedTranscriptionProvider> {
      expect(profileId).toBe("cloud-stt");
      return Promise.resolve({
        id: "cloud-stt",
        name: "Cloud STT",
        baseUrl: "https://stt.example.com",
        apiKey: "cloud-key",
        model: "current-model",
        priority: 20,
        concurrency: 2,
        enabled: true,
        source: "transcription_profile",
      });
    }
  }

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    expect(String(input)).toBe(
      "https://stt.example.com/v1/audio/transcriptions",
    );
    expect((init?.body as FormData).get("model")).toBe("snapshotted-model");
    return Promise.resolve(
      new Response(JSON.stringify({ text: "hello", segments: [] })),
    );
  };

  try {
    const result = await new ProfileResource().use({
      action: "transcribe",
      file: new Uint8Array([1]),
      providerProfileId: "cloud-stt",
      model: "snapshotted-model",
    }, {} as Auth) as Record<string, any>;
    expect(result.metadata.providerProfileId).toBe("cloud-stt");
    expect(result.metadata.providerProfileName).toBe("Cloud STT");
    expect(result.metadata.model).toBe("snapshotted-model");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("STT models probe reports normalized selectable models", async () => {
  const previous = {
    url: Deno.env.get("STT_SERVER_URL"),
    key: Deno.env.get("PROXY_API_KEY"),
    model: Deno.env.get("STT_MODEL"),
  };
  Deno.env.set("STT_SERVER_URL", "http://stt.example:8001");
  Deno.env.set("PROXY_API_KEY", "test-key");
  Deno.env.set("STT_MODEL", "large-v3");

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: string | URL | Request) => {
    expect(String(input)).toBe("http://stt.example:8001/v1/models");
    return new Response(JSON.stringify({
      data: [
        { id: "models/large-v3" },
        { model: "large-v3-turbo" },
        "large-v3",
      ],
    }));
  };

  try {
    const result = await new TranscriptionResource().use(
      { action: "models" },
      {} as Auth,
    ) as Record<string, any>;
    expect(result.success).toBe(true);
    expect(result.models).toEqual(["large-v3", "large-v3-turbo"]);
    expect(result.configuredModel).toBe("large-v3");
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv("STT_SERVER_URL", previous.url);
    restoreEnv("PROXY_API_KEY", previous.key);
    restoreEnv("STT_MODEL", previous.model);
  }
});

Deno.test("STT models probe accepts a healthy provider without models route", async () => {
  const previous = {
    url: Deno.env.get("STT_SERVER_URL"),
    key: Deno.env.get("PROXY_API_KEY"),
    model: Deno.env.get("STT_MODEL"),
  };
  Deno.env.set("STT_SERVER_URL", "http://argmax.example:10301");
  Deno.env.set("PROXY_API_KEY", "test-key");
  Deno.env.set("STT_MODEL", "large-v3-v20240930_626MB");

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/v1/models") || url.endsWith("/v1/stt/status")) {
      return Promise.resolve(new Response("Not Found", { status: 404 }));
    }
    expect(url).toBe("http://argmax.example:10301/health");
    return Promise.resolve(new Response('{"status":"ok"}'));
  };

  try {
    const result = await new TranscriptionResource().use(
      { action: "models" },
      {} as Auth,
    ) as Record<string, any>;
    expect(result.success).toBe(true);
    expect(result.status).toBe(200);
    expect(result.models).toEqual(["large-v3-v20240930_626MB"]);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv("STT_SERVER_URL", previous.url);
    restoreEnv("PROXY_API_KEY", previous.key);
    restoreEnv("STT_MODEL", previous.model);
  }
});

Deno.test("STT models probe uses the provider-reported model from STT status", async () => {
  const previous = {
    url: Deno.env.get("STT_SERVER_URL"),
    key: Deno.env.get("PROXY_API_KEY"),
  };
  Deno.env.set("STT_SERVER_URL", "http://stt.example:8001");
  Deno.env.set("PROXY_API_KEY", "test-key");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/v1/models")) {
      return Promise.resolve(new Response("Not Found", { status: 404 }));
    }
    expect(url).toBe("http://stt.example:8001/v1/stt/status");
    return Promise.resolve(
      new Response(JSON.stringify({
        model: "large-v3-turbo",
      })),
    );
  };

  try {
    const result = await new TranscriptionResource().use(
      { action: "models" },
      {} as Auth,
    ) as Record<string, any>;
    expect(result.success).toBe(true);
    expect(result.models).toEqual(["large-v3-turbo"]);
    expect(result.reportedModel).toBe("large-v3-turbo");
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv("STT_SERVER_URL", previous.url);
    restoreEnv("PROXY_API_KEY", previous.key);
  }
});

Deno.test("STT provider pin does not bypass the route toggle", async () => {
  const resource = new TranscriptionResource();
  const providers = [
    {
      id: "profile-off",
      name: "Disabled route",
      baseUrl: "http://off.example",
      apiKey: "k",
      model: "whisper",
      priority: 10,
      concurrency: 1,
      enabled: false,
      source: "transcription_profile" as const,
    },
    {
      id: "profile-on",
      name: "Enabled route",
      baseUrl: "http://on.example",
      apiKey: "k",
      model: "whisper",
      priority: 20,
      concurrency: 1,
      enabled: true,
      source: "transcription_profile" as const,
    },
  ];
  (resource as any).getInferenceProviders = () => Promise.resolve(providers);

  // Pinned to a disabled route → loud failure, not silent traffic.
  await expect(resource.getInferenceProvider("profile-off")).rejects.toThrow(
    'STT provider "Disabled route" is disabled',
  );
  // Unknown pin keeps its explicit error.
  await expect(resource.getInferenceProvider("missing")).rejects.toThrow(
    "STT provider profile not found",
  );
  // No pin → first enabled route; never a disabled fallback.
  const picked = await resource.getInferenceProvider();
  expect(picked?.id).toBe("profile-on");

  (resource as any).getInferenceProviders = () =>
    Promise.resolve(providers.map((p) => ({ ...p, enabled: false })));
  expect(await resource.getInferenceProvider()).toBeNull();
});
