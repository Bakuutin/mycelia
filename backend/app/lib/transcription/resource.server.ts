import { z } from "zod";
import { Buffer } from "node:buffer";
import { Resource } from "@/lib/auth/resources.ts";
import { Auth } from "@/lib/auth/core.server.ts";
import { getRootDB } from "@/lib/mongo/core.server.ts";
import { meter, tracer } from "@/lib/telemetry.ts";
import { zServerConfig } from "@myceliasdk/config.ts";
import { ObjectId, Binary } from "bson";
import { Binary as MongoBinary } from "mongodb";

const SERVER_CONFIG_ID = new ObjectId("000000000000000000000000");

const transcriptionRequestSchema = z.object({
  action: z.literal("transcribe"),
  file: z.any(),
  fileName: z.string().optional(),
  fileType: z.string().optional(),
  language: z.string().optional(),
  prompt: z.string().optional(),
});

type TranscriptionRequest = z.infer<typeof transcriptionRequestSchema>;
type TranscriptionResponse = any | Response;

export class TranscriptionResource implements Resource<TranscriptionRequest, TranscriptionResponse> {
  code = "transcription";
  description = "Audio transcription";
  schemas: {
    request: z.ZodType<TranscriptionRequest>;
    response: z.ZodType<TranscriptionResponse>;
  } = {
    request: transcriptionRequestSchema as z.ZodType<TranscriptionRequest>,
    response: z.any() as z.ZodType<TranscriptionResponse>,
  };

  async getInferenceProvider(): Promise<{ baseUrl: string; apiKey: string; model?: string } | null> {
    // Stateless config: read from env vars first (ushadow pattern)
    const envBaseUrl = Deno.env.get("TRANSCRIPTION_BASE_URL");
    const envApiKey = Deno.env.get("TRANSCRIPTION_API_KEY");
    const envModel = Deno.env.get("TRANSCRIPTION_MODEL");

    if (envBaseUrl && envApiKey) {
      return {
        baseUrl: envBaseUrl,
        apiKey: envApiKey,
        model: envModel || "whisper-1",
      };
    }

    // Fallback to MongoDB config for backward compatibility
    const rootDb = await getRootDB();
    const configDoc = await rootDb.collection("configs").findOne({ _id: SERVER_CONFIG_ID });
    if (!configDoc) {
      return null;
    }
    const config = zServerConfig.parse(configDoc);
    const provider = config.transcription || config.inference;
    if (!provider?.baseUrl || !provider?.apiKey) {
      return null;
    }
    return {
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      model: provider.model,
    };
  }

  async use(input: TranscriptionRequest, auth: Auth): Promise<TranscriptionResponse> {
    const startTime = performance.now();
    const span = tracer.startSpan("transcription_resource_use", {
      attributes: {
        "transcription.action": input.action,
      },
    });

    try {
      switch (input.action) {
        case "transcribe": {
          const provider = await this.getInferenceProvider();
          if (!provider) {
            span.setStatus({
              code: 2,
              message: "Inference provider not configured",
            });
            throw new Error(
              "Inference provider not configured. Please configure it in server settings."
            );
          }

          span.setAttributes({
            "transcription.has_api_key": !!provider.apiKey,
          });

          let fileBuffer: Uint8Array;
          if (input.file instanceof Uint8Array) {
            fileBuffer = input.file;
          } else if (input.file instanceof Buffer ) {
            fileBuffer = new Uint8Array(input.file);
          } else if (input.file?.buffer instanceof Uint8Array) {
            fileBuffer = new Uint8Array(input.file.buffer);
          } else if (input.file && typeof input.file === "object" && "$binary" in input.file) {
            const binary = (input.file as { $binary: { base64: string; subType?: string } }).$binary;
            const decoded = Buffer.from(binary.base64, "base64");
            fileBuffer = new Uint8Array(decoded);
          } else {
            throw new Error(`Invalid file format. Expected Uint8Array, Buffer, or EJSON binary. Got ${typeof input.file}, ${Object.keys(input.file)}`);
          }

          const formData = new FormData();
          const newBuffer = new Uint8Array(fileBuffer);
          const blob = new Blob([newBuffer], { type: input.fileType || "audio/mpeg" });
          const fileName = input.fileName || "audio.mp3";
          const file = new File([blob], fileName, { type: input.fileType || "audio/mpeg" });
          formData.append("file", file);
          // Request verbose_json to get segments with timestamps
          formData.append("response_format", "verbose_json");
          if (input.language) {
            formData.append("language", input.language);
          }
          if (input.prompt) {
            formData.append("prompt", input.prompt);
          }
          // Use configured model, or let server use default
          if (provider.model) {
            formData.append("model", provider.model);
          }

          // Expect standard format: https://api.openai.com/v1
          const baseUrl = provider.baseUrl.replace(/\/$/, "");
          if (!baseUrl.endsWith("/v1")) {
            throw new Error(
              `Invalid TRANSCRIPTION_BASE_URL format. Expected URL ending with /v1 (e.g., https://api.openai.com/v1). Got: ${baseUrl}`
            );
          }

          const proxyResponse = await fetch(
            `${baseUrl}/audio/transcriptions`,
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

