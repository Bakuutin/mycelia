import { expect } from "@std/expect";
import { withFixtures } from "@/tests/fixtures.server.ts";
import { getServerAuth } from "@/lib/auth/core.server.ts";
import { getConfigResource as getConfigResourceFn } from "@/lib/config/resource.server.ts";
import { TranscriptionResource } from "./resource.server.ts";

function withEnv(
  name: string,
  value: string | undefined,
): () => void {
  const previous = Deno.env.get(name);
  if (value === undefined) {
    Deno.env.delete(name);
  } else {
    Deno.env.set(name, value);
  }

  return () => {
    if (previous === undefined) {
      Deno.env.delete(name);
    } else {
      Deno.env.set(name, previous);
    }
  };
}

Deno.test(
  "transcription provider prefers dedicated transcription config",
  withFixtures(["Mongo"], async () => {
    const restoreDedicatedBaseUrl = withEnv(
      "TRANSCRIPTION_BASE_URL",
      undefined,
    );
    const restoreDedicatedApiKey = withEnv("TRANSCRIPTION_API_KEY", undefined);
    const restoreOpenAiBaseUrl = withEnv("OPENAI_BASE_URL", undefined);
    const restoreOpenAiApiKey = withEnv("OPENAI_API_KEY", undefined);
    const resource = new TranscriptionResource();
    try {
      const configResource = await getConfigResourceFn(await getServerAuth());
      await configResource({
        action: "patch",
        path: "inference",
        updates: {
          baseUrl: "https://shared.example",
          apiKey: "shared-key",
        },
      });
      await configResource({
        action: "patch",
        path: "transcription",
        updates: {
          baseUrl: "https://transcription.example",
          apiKey: "transcription-key",
        },
      });

      const provider = await resource.getInferenceProvider();

      expect(provider).toEqual({
        baseUrl: "https://transcription.example",
        apiKey: "transcription-key",
      });
    } finally {
      restoreOpenAiApiKey();
      restoreOpenAiBaseUrl();
      restoreDedicatedApiKey();
      restoreDedicatedBaseUrl();
    }
  }),
);

Deno.test(
  "transcription provider falls back to shared inference config",
  withFixtures(["Mongo"], async () => {
    const restoreDedicatedBaseUrl = withEnv(
      "TRANSCRIPTION_BASE_URL",
      undefined,
    );
    const restoreDedicatedApiKey = withEnv("TRANSCRIPTION_API_KEY", undefined);
    const restoreOpenAiBaseUrl = withEnv("OPENAI_BASE_URL", undefined);
    const restoreOpenAiApiKey = withEnv("OPENAI_API_KEY", undefined);
    const resource = new TranscriptionResource();
    try {
      const configResource = await getConfigResourceFn(await getServerAuth());
      await configResource({
        action: "patch",
        path: "inference",
        updates: {
          baseUrl: "https://shared.example",
          apiKey: "shared-key",
        },
      });

      const provider = await resource.getInferenceProvider();

      expect(provider).toEqual({
        baseUrl: "https://shared.example",
        apiKey: "shared-key",
      });
    } finally {
      restoreOpenAiApiKey();
      restoreOpenAiBaseUrl();
      restoreDedicatedApiKey();
      restoreDedicatedBaseUrl();
    }
  }),
);

Deno.test(
  "transcription env vars override config",
  withFixtures(["Mongo"], async () => {
    const restoreBaseUrl = withEnv(
      "TRANSCRIPTION_BASE_URL",
      "http://localhost:9000",
    );
    const restoreApiKey = withEnv("TRANSCRIPTION_API_KEY", "local-whisper");

    try {
      const resource = new TranscriptionResource();
      const provider = await resource.getInferenceProvider();

      expect(provider).toEqual({
        baseUrl: "http://localhost:9000",
        apiKey: "local-whisper",
      });
    } finally {
      restoreApiKey();
      restoreBaseUrl();
    }
  }),
);
