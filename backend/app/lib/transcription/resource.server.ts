import { z } from "zod";
import { Buffer } from "node:buffer";
import { Resource } from "@/lib/auth/resources.ts";
import { Auth } from "@/lib/auth/core.server.ts";
import { tracer } from "@/lib/telemetry.ts";
import { getServerConfig } from "@/lib/config/serverConfig.server.ts";
import { normalizeOpenAIBaseUrl } from "@/lib/llm/model-routing.ts";

const transcriptionRequestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("transcribe"),
    file: z.any(),
    fileName: z.string().optional(),
    fileType: z.string().optional(),
    language: z.string().optional(),
    prompt: z.string().optional(),
    providerProfileId: z.string().optional(),
    model: z.string().optional(),
  }),
  z.object({
    action: z.literal("health"),
    baseUrl: z.string().url().optional(),
    apiKey: z.string().optional(),
  }),
  z.object({
    action: z.literal("models"),
    baseUrl: z.string().url().optional(),
    apiKey: z.string().optional(),
  }),
  z.object({
    // The environment route is intentionally inspectable but never editable:
    // its URL, credentials and default model belong to the deployment .env.
    action: z.literal("environment_status"),
  }),
]);

type TranscriptionRequest = z.infer<typeof transcriptionRequestSchema>;
type TranscriptionResponse = any | Response;

export type ResolvedTranscriptionProvider = {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  priority: number;
  concurrency: number;
  enabled: boolean;
  source:
    | "stt_env"
    | "transcription_profile"
    | "transcription_config"
    | "inference_config";
};

function listedModels(body: string): string[] {
  try {
    const parsed = JSON.parse(body);
    const entries: unknown[] = Array.isArray(parsed?.data)
      ? parsed.data
      : Array.isArray(parsed?.models)
      ? parsed.models
      : [];
    const modelIds = entries.map((entry: unknown): string => {
      if (typeof entry === "string") return entry;
      if (!entry || typeof entry !== "object") return "";
      const candidate = entry as Record<string, unknown>;
      return [candidate.id, candidate.model, candidate.name].find(
        (value): value is string => typeof value === "string",
      ) || "";
    }).map((model: string) => model.trim().replace(/^models\//, ""))
      .filter(Boolean);
    return [...new Set(modelIds)].sort();
  } catch {
    return [];
  }
}

function reportedSttModel(body: string): string | undefined {
  try {
    const parsed = JSON.parse(body);
    const candidates = [
      parsed?.model,
      parsed?.loadedModel,
      parsed?.effectiveModel,
      parsed?.asrModel,
    ];
    return candidates.find((value): value is string =>
      typeof value === "string" && value.trim().length > 0
    )?.trim().replace(/^models\//, "");
  } catch {
    return undefined;
  }
}

export class TranscriptionResource
  implements Resource<TranscriptionRequest, TranscriptionResponse> {
  code = "transcription";
  description = "Audio transcription";
  schemas: {
    request: z.ZodType<TranscriptionRequest>;
    response: z.ZodType<TranscriptionResponse>;
  } = {
    request: transcriptionRequestSchema as z.ZodType<TranscriptionRequest>,
    response: z.any() as z.ZodType<TranscriptionResponse>,
  };

  async getInferenceProviders(): Promise<ResolvedTranscriptionProvider[]> {
    let config: Awaited<ReturnType<typeof getServerConfig>> | null = null;
    try {
      config = await getServerConfig();
    } catch {
      // Dedicated environment-only deployments may not expose config storage.
    }

    const sttBaseUrl = Deno.env.get("STT_SERVER_URL")?.trim();
    const sttApiKey = Deno.env.get("PROXY_API_KEY")?.trim();
    const resolveEnvironmentProvider = ():
      | ResolvedTranscriptionProvider
      | null => {
      if (!sttBaseUrl && !sttApiKey) return null;
      if (!sttBaseUrl || !sttApiKey) {
        throw new Error(
          "STT_SERVER_URL and PROXY_API_KEY must both be set for dedicated STT.",
        );
      }
      const legacyConfiguredModel = config?.transcriptionProfiles?.profiles
          ?.length
        ? undefined
        : config?.transcription?.model?.trim();
      return {
        id: "environment",
        name: "Environment STT",
        baseUrl: sttBaseUrl,
        apiKey: sttApiKey,
        // URL and credentials may remain environment-managed while the
        // model is selected from the web UI.
        model: Deno.env.get("STT_MODEL")?.trim() || legacyConfiguredModel ||
          "whisper",
        priority: config?.transcriptionProfiles?.environmentPriority ?? 50,
        concurrency: 1,
        enabled: true,
        source: "stt_env",
      };
    };

    if (config?.transcriptionProfiles?.profiles?.length) {
      const configuredProviders = config.transcriptionProfiles.profiles.map((
        profile,
      ) => ({
        id: profile.id,
        name: profile.name,
        baseUrl: profile.baseUrl,
        apiKey: profile.apiKey,
        model: profile.model,
        priority: profile.priority,
        concurrency: profile.concurrency,
        enabled: profile.enabled,
        source: "transcription_profile" as const,
      }));
      if (!config.transcriptionProfiles.includeEnvironment) {
        return configuredProviders;
      }
      const environmentProvider = resolveEnvironmentProvider();
      return environmentProvider
        ? [environmentProvider, ...configuredProviders]
        : configuredProviders;
    }

    if (sttBaseUrl || sttApiKey) {
      return [resolveEnvironmentProvider()!];
    }

    config ??= await getServerConfig();
    const provider = config.transcription || config.inference;
    if (!provider?.baseUrl || !provider?.apiKey) {
      return [];
    }
    return [{
      id: "legacy",
      name: "Legacy STT route",
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      model: provider.model || "whisper",
      priority: 50,
      concurrency: 1,
      enabled: true,
      source: config.transcription
        ? "transcription_config"
        : "inference_config",
    }];
  }

  async getInferenceProvider(
    profileId?: string,
  ): Promise<ResolvedTranscriptionProvider | null> {
    const providers = await this.getInferenceProviders();
    if (profileId) {
      const provider = providers.find((candidate) =>
        candidate.id === profileId
      );
      if (!provider) {
        throw new Error(`STT provider profile not found: ${profileId}`);
      }
      return provider;
    }
    return providers.find((provider) => provider.enabled) ?? providers[0] ??
      null;
  }

  async use(
    input: TranscriptionRequest,
    auth: Auth,
  ): Promise<TranscriptionResponse> {
    const startTime = performance.now();
    const span = tracer.startSpan("transcription_resource_use", {
      attributes: {
        "transcription.action": input.action,
      },
    });

    try {
      switch (input.action) {
        case "environment_status": {
          let config: Awaited<ReturnType<typeof getServerConfig>> | null = null;
          try {
            config = await getServerConfig();
          } catch {
            // Configuration storage is optional for environment-only installs.
          }
          const baseUrl = Deno.env.get("STT_SERVER_URL")?.trim();
          const hasApiKey = Boolean(Deno.env.get("PROXY_API_KEY")?.trim());
          const configured = Boolean(baseUrl && hasApiKey);
          const profilesConfigured = Boolean(
            config?.transcriptionProfiles?.profiles?.length,
          );
          return {
            configured,
            enabled: profilesConfigured
              ? Boolean(config?.transcriptionProfiles?.includeEnvironment)
              : configured,
            baseUrl: baseUrl?.replace(/\/+$/, ""),
            model: Deno.env.get("STT_MODEL")?.trim() ||
              (!profilesConfigured
                ? config?.transcription?.model?.trim()
                : undefined) ||
              "whisper",
            priority: config?.transcriptionProfiles?.environmentPriority ?? 50,
            concurrency: 1,
            message: configured
              ? "Deployment-managed route; URL, key and model are read-only here."
              : "STT_SERVER_URL and PROXY_API_KEY are not both configured in the backend environment.",
          };
        }
        case "health": {
          const configured = await this.getInferenceProvider();
          const baseUrl = input.baseUrl?.trim() || configured?.baseUrl;
          const apiKey = input.apiKey ?? configured?.apiKey;
          if (!baseUrl || !apiKey) {
            throw new Error("STT provider URL and API key are required");
          }
          const healthUrl = `${baseUrl.replace(/\/+$/, "")}/health`;
          const response = await fetch(healthUrl, {
            headers: { Authorization: `Bearer ${apiKey}` },
            signal: AbortSignal.timeout(5_000),
          });
          const body = await response.text();
          return {
            success: response.ok,
            status: response.status,
            message: body.trim().replace(/\s+/g, " ").slice(0, 300) ||
              `HTTP ${response.status}`,
            baseUrl: baseUrl.replace(/\/+$/, ""),
          };
        }
        case "models": {
          const configured = await this.getInferenceProvider();
          const baseUrl = input.baseUrl?.trim() || configured?.baseUrl;
          const apiKey = input.apiKey ?? configured?.apiKey;
          if (!baseUrl || !apiKey) {
            throw new Error("STT provider URL and API key are required");
          }

          const modelsUrl = `${normalizeOpenAIBaseUrl(baseUrl)}/models`;
          const response = await fetch(modelsUrl, {
            headers: { Authorization: `Bearer ${apiKey}` },
            signal: AbortSignal.timeout(5_000),
          });
          const body = await response.text();
          let models = response.ok ? listedModels(body) : [];
          let reportedModel = response.ok ? reportedSttModel(body) : undefined;

          let usedHealthFallback = false;
          let effectiveStatus = response.status;
          if ([404, 405].includes(response.status)) {
            const statusResponse = await fetch(
              `${baseUrl.replace(/\/+$/, "")}/v1/stt/status`,
              {
                headers: { Authorization: `Bearer ${apiKey}` },
                signal: AbortSignal.timeout(5_000),
              },
            );
            effectiveStatus = statusResponse.status;
            const statusBody = await statusResponse.text();
            reportedModel = statusResponse.ok
              ? reportedSttModel(statusBody)
              : undefined;
            if (reportedModel) {
              models = [reportedModel];
              usedHealthFallback = true;
            } else {
              const healthResponse = await fetch(
                `${baseUrl.replace(/\/+$/, "")}/health`,
                {
                  headers: { Authorization: `Bearer ${apiKey}` },
                  signal: AbortSignal.timeout(5_000),
                },
              );
              effectiveStatus = healthResponse.status;
              if (healthResponse.ok && configured?.model) {
                models = [configured.model];
                usedHealthFallback = true;
              }
            }
          }

          const message = usedHealthFallback
            ? reportedModel
              ? `Provider reports loaded model ${reportedModel}`
              : "Provider is healthy and uses the configured STT model"
            : response.ok
            ? models.length > 0
              ? `Found ${models.length} STT model${
                models.length === 1 ? "" : "s"
              }`
              : "The STT server responded, but advertised no named models"
            : body.trim().replace(/\s+/g, " ").slice(0, 300) ||
              `HTTP ${response.status}`;
          return {
            success: (response.ok || usedHealthFallback) && models.length > 0,
            status: effectiveStatus,
            message,
            models,
            modelsUrl,
            configuredModel: configured?.model,
            reportedModel,
          };
        }
        case "transcribe": {
          const provider = await this.getInferenceProvider(
            input.providerProfileId,
          );
          if (!provider) {
            span.setStatus({
              code: 2,
              message: "Inference provider not configured",
            });
            throw new Error(
              "Inference provider not configured. Please configure it in server settings.",
            );
          }

          span.setAttributes({
            "transcription.has_api_key": !!provider.apiKey,
          });

          let fileBuffer: Uint8Array;
          if (input.file instanceof Uint8Array) {
            fileBuffer = input.file;
          } else if (input.file instanceof Buffer) {
            fileBuffer = new Uint8Array(input.file);
          } else if (input.file?.buffer instanceof Uint8Array) {
            fileBuffer = new Uint8Array(input.file.buffer);
          } else if (
            input.file && typeof input.file === "object" &&
            "$binary" in input.file
          ) {
            const binary =
              (input.file as { $binary: { base64: string; subType?: string } })
                .$binary;
            const decoded = Buffer.from(binary.base64, "base64");
            fileBuffer = new Uint8Array(decoded);
          } else {
            throw new Error(
              `Invalid file format. Expected Uint8Array, Buffer, or EJSON binary. Got ${typeof input
                .file}, ${Object.keys(input.file)}`,
            );
          }

          const formData = new FormData();
          const newBuffer = new Uint8Array(fileBuffer);
          const blob = new Blob([newBuffer], {
            type: input.fileType || "audio/mpeg",
          });
          const fileName = input.fileName || "audio.mp3";
          const file = new File([blob], fileName, {
            type: input.fileType || "audio/mpeg",
          });
          formData.append("file", file);
          // OpenAI-compatible Whisper servers auto-detect language when the
          // field is omitted. Some faster-whisper servers reject the literal
          // value "auto" with a 500 response.
          if (input.language && input.language !== "auto") {
            formData.append("language", input.language);
          }
          if (input.prompt) {
            formData.append("prompt", input.prompt);
          }
          formData.append("model", input.model || provider.model || "whisper");

          const proxyResponse = await fetch(
            provider.baseUrl.replace(/\/$/, "") + "/v1/audio/transcriptions",
            {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${provider.apiKey}`,
              },
              body: formData,
            },
          );

          span.setAttributes({
            "transcription.response_status": proxyResponse.status,
            "transcription.response_ok": proxyResponse.ok,
          });

          if (!proxyResponse.ok) {
            const errorBody = await proxyResponse.text();
            span.setStatus({
              code: 2,
              message: `API error: ${proxyResponse.status}`,
            });
            throw new Error(`Failed to transcribe: ${errorBody}`);
          }

          const responseText = await proxyResponse.text();

          try {
            const jsonResponse = JSON.parse(responseText);
            const reportedModel =
              proxyResponse.headers.get("X-Whisper-Model") ||
              input.model ||
              provider.model ||
              "unknown";
            const vadFilterHeader = proxyResponse.headers.get(
              "X-Whisper-VAD-Filter",
            );
            const whisperVadFilter = vadFilterHeader == null
              ? undefined
              : ["1", "true", "yes", "on"].includes(
                vadFilterHeader.trim().toLowerCase(),
              );
            const responseMetadata = jsonResponse.metadata &&
                typeof jsonResponse.metadata === "object"
              ? jsonResponse.metadata
              : {};
            jsonResponse.metadata = {
              ...responseMetadata,
              model: reportedModel,
              requestedModel: input.model || provider.model || "whisper",
              reportedModel: proxyResponse.headers.get("X-Whisper-Model") ||
                jsonResponse.model || undefined,
              provider: "openai_compatible",
              providerProfileId: provider.id,
              providerProfileName: provider.name,
              providerSource: provider.source,
              providerBaseUrl: provider.baseUrl,
              ...(whisperVadFilter === undefined ? {} : { whisperVadFilter }),
            };
            span.setStatus({ code: 1 });
            return jsonResponse;
          } catch (parseError) {
            const errorMessage = parseError instanceof Error
              ? parseError.message
              : "Unknown parse error";
            span.setStatus({
              code: 2,
              message: `JSON parse error: ${errorMessage}`,
            });
            throw new Error(
              `Invalid JSON response from provider: ${errorMessage}`,
            );
          }
        }
        default:
          span.setStatus({ code: 2, message: "Unknown action" });
          throw new Error("Unknown action");
      }
    } catch (error) {
      span.recordException(error as Error);
      throw error;
    } finally {
      const duration = (performance.now() - startTime) / 1000;
      span.setAttributes({ "transcription.duration_seconds": duration });
      span.end();
    }
  }

  extractActions(input: TranscriptionRequest) {
    return [{
      path: ["transcription", "audio"],
      actions: [input.action],
    }];
  }
}

export async function getTranscriptionResource(
  auth: Auth,
): Promise<(input: TranscriptionRequest) => Promise<TranscriptionResponse>> {
  return auth.getResource("transcription");
}
