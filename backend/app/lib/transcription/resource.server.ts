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
]);

type TranscriptionRequest = z.infer<typeof transcriptionRequestSchema>;
type TranscriptionResponse = any | Response;

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

  async getInferenceProvider(): Promise<
    {
      baseUrl: string;
      apiKey: string;
      model?: string;
      source: "stt_env" | "transcription_config" | "inference_config";
    } | null
  > {
    const sttBaseUrl = Deno.env.get("STT_SERVER_URL")?.trim();
    const sttApiKey = Deno.env.get("PROXY_API_KEY")?.trim();

    if (sttBaseUrl || sttApiKey) {
      if (!sttBaseUrl || !sttApiKey) {
        throw new Error(
          "STT_SERVER_URL and PROXY_API_KEY must both be set for dedicated STT.",
        );
      }

      let configuredModel: string | undefined;
      try {
        configuredModel = (await getServerConfig()).transcription?.model
          ?.trim();
      } catch {
        // Environment-only and isolated test deployments may not expose the
        // config resource. The STT_MODEL fallback remains valid there.
      }
      return {
        baseUrl: sttBaseUrl,
        apiKey: sttApiKey,
        // URL and credentials may remain environment-managed while the model
        // is selected from the web UI. An explicit saved selection wins.
        model: configuredModel || Deno.env.get("STT_MODEL")?.trim() ||
          "whisper",
        source: "stt_env",
      };
    }

    const config = await getServerConfig();
    const provider = config.transcription || config.inference;
    if (!provider?.baseUrl || !provider?.apiKey) {
      return null;
    }
    return {
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      model: provider.model,
      source: config.transcription
        ? "transcription_config"
        : "inference_config",
    };
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
          let models: string[] = [];
          if (response.ok) {
            try {
              const parsed = JSON.parse(body);
              const entries = Array.isArray(parsed?.data)
                ? parsed.data
                : Array.isArray(parsed?.models)
                ? parsed.models
                : [];
              const modelIds: string[] = entries.map((entry: unknown) => {
                if (typeof entry === "string") return entry;
                if (!entry || typeof entry !== "object") return "";
                const candidate = entry as Record<string, unknown>;
                return [candidate.id, candidate.model, candidate.name].find(
                  (value): value is string => typeof value === "string",
                ) || "";
              }).map((model: string) => model.trim().replace(/^models\//, ""))
                .filter((model: string): model is string => Boolean(model));
              models = [...new Set<string>(modelIds)].sort();
            } catch {
              models = [];
            }
          }

          const message = response.ok
            ? models.length > 0
              ? `Found ${models.length} STT model${
                models.length === 1 ? "" : "s"
              }`
              : "The STT server responded, but advertised no named models"
            : body.trim().replace(/\s+/g, " ").slice(0, 300) ||
              `HTTP ${response.status}`;
          return {
            success: response.ok && models.length > 0,
            status: response.status,
            message,
            models,
            modelsUrl,
            configuredModel: configured?.model,
          };
        }
        case "transcribe": {
          const provider = await this.getInferenceProvider();
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
          formData.append("model", provider.model || "whisper");

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
              provider: provider.source === "stt_env"
                ? "remote_openai_compatible"
                : "configured_inference",
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
