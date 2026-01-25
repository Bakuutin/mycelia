import { z } from "zod";
import { Resource } from "@/lib/auth/resources.ts";
import { Auth } from "@/lib/auth/core.server.ts";
import { getServerConfig } from "@/lib/config/serverConfig.server.ts";
import { meter, tracer } from "@/lib/telemetry.ts";

const llmRequestCounter = meter.createCounter("llm_requests_total", {
  description: "Total number of LLM requests",
});

const llmRequestDuration = meter.createHistogram(
  "llm_request_duration_seconds",
  {
    description: "Duration of LLM requests",
    unit: "s",
  },
);

const llmErrorsCounter = meter.createCounter("llm_errors_total", {
  description: "Total number of LLM errors",
});

const messageSchema = z.object({
  role: z.enum(["system", "user", "assistant", "function", "tool"]),
  content: z.string().nullable(),
  name: z.string().optional(),
  tool_calls: z.array(z.any()).optional(),
  tool_call_id: z.string().optional(),
});

const toolSchema = z.object({
  type: z.literal("function"),
  function: z.object({
    name: z.string(),
    description: z.string().optional(),
    parameters: z.record(z.string(), z.any()).optional(),
  }),
});

const toolChoiceSchema = z.union([
  z.literal("none"),
  z.literal("auto"),
  z.object({
    type: z.literal("function"),
    function: z.object({
      name: z.string(),
    }),
  }),
]);

const chatCompletionRequestSchema = z.object({
  action: z.literal("completions"),
  model: z.string(),
  messages: z.array(messageSchema),
  temperature: z.number().min(0).max(2).optional(),
  top_p: z.number().min(0).max(1).optional(),
  n: z.number().int().positive().optional(),
  stream: z.boolean().optional(),
  stop: z.union([z.string(), z.array(z.string())]).optional(),
  max_tokens: z.number().int().positive().optional(),
  presence_penalty: z.number().min(-2).max(2).optional(),
  frequency_penalty: z.number().min(-2).max(2).optional(),
  logit_bias: z.record(z.string(), z.number()).optional(),
  tools: z.array(toolSchema).optional(),
  tool_choice: toolChoiceSchema.optional(),
  parallel_tool_calls: z.boolean().optional(),
  response_format: z
    .union([
      z.object({ type: z.literal("text") }),
      z.object({ type: z.literal("json_object") }),
    ])
    .optional(),
});

const llmRequestSchema = z.discriminatedUnion("action", [
  chatCompletionRequestSchema,
]);

type LLMRequest = z.infer<typeof llmRequestSchema>;
type LLMResponse = any | Response;

export class LLMResource implements Resource<LLMRequest, LLMResponse> {
  code = "llm";
  description = "LLM chat completions";
  schemas: {
    request: z.ZodType<LLMRequest>;
    response: z.ZodType<LLMResponse>;
  } = {
    request: llmRequestSchema as z.ZodType<LLMRequest>,
    response: z.any() as z.ZodType<LLMResponse>,
  };

  async getInferenceProvider(): Promise<{ baseUrl: string; apiKey: string; model?: string } | null> {
    // Stateless config: read from env vars first (ushadow pattern)
    const envBaseUrl = Deno.env.get("OPENAI_BASE_URL");
    const envApiKey = Deno.env.get("OPENAI_API_KEY");
    // Model resolution: OPENAI_MODEL (for override) > BASE_MODEL (primary config)
    const envModel = Deno.env.get("OPENAI_MODEL") || Deno.env.get("BASE_MODEL");

    if (envBaseUrl && envApiKey) {
      return {
        baseUrl: envBaseUrl,
        apiKey: envApiKey,
        model: envModel,
      };
    }

    // Fallback to MongoDB config for backward compatibility
    const config = await getServerConfig();
    const provider = config.llm || config.inference;
    if (!provider?.baseUrl || !provider?.apiKey) {
      return null;
    }
    return {
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      model: provider.model,
    };
  }

  /**
   * Resolve model aliases (small/medium/large) to actual model names.
   * Priority: BASE_MODEL env var > inference.mycelia.tech passthrough > MODEL_* env vars
   */
  resolveModelAlias(modelName: string, baseUrl: string): string {
    // Highest priority: explicit BASE_MODEL override
    const baseModelOverride = Deno.env.get('BASE_MODEL');
    if (baseModelOverride) {
      return baseModelOverride;
    }

    // If using Mycelia inference gateway, pass through aliases (they handle it server-side)
    if (baseUrl.includes('inference.mycelia.tech')) {
      return modelName;
    }

    // Resolve aliases to actual model names for direct providers
    const baseModel = Deno.env.get('BASE_MODEL');
    if (!baseModel) {
      // If no BASE_MODEL set, pass through the alias/model name as-is
      return modelName;
    }
    const aliases: Record<string, string> = {
      small: Deno.env.get('MODEL_SMALL') || baseModel,
      medium: Deno.env.get('MODEL_MEDIUM') || baseModel,
      large: Deno.env.get('MODEL_LARGE') || baseModel,
    };

    return aliases[modelName] || modelName;
  }

  async use(input: LLMRequest, auth: Auth): Promise<LLMResponse> {
    const startTime = performance.now();
    const span = tracer.startSpan("llm_resource_use", {
      attributes: {
        "llm.action": input.action,
        "llm.model": input.model,
      },
    });

    try {
      llmRequestCounter.add(1, { action: input.action, model: input.model });

      switch (input.action) {
        case "completions": {
          const { action, ...body } = input;

          const provider = await this.getInferenceProvider();
          if (!provider) {
            llmErrorsCounter.add(1, {
              error_type: "provider_not_configured",
              model: input.model,
            });
            span.setStatus({
              code: 2,
              message: "Inference provider not configured",
            });
            throw new Error("Inference provider not configured. Please configure it in server settings.");
          }

          // Normalize base URL: remove trailing slash, ensure /v1 suffix
          let baseUrl = provider.baseUrl.replace(/\/$/, "");
          if (!baseUrl.endsWith("/v1")) {
            baseUrl = `${baseUrl}/v1`;
          }

          // Resolve model aliases (small/medium/large) to actual model names
          const resolvedModel = this.resolveModelAlias(input.model, baseUrl);

          span.setAttributes({
            "llm.model": resolvedModel,
            "llm.model_requested": input.model,
            "llm.has_api_key": !!provider.apiKey,
          });

          const requestBody = {
            ...body,
            model: resolvedModel,
          };

          const proxyResponse = await fetch(
            `${baseUrl}/chat/completions`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${provider.apiKey}`,
              },
              body: JSON.stringify(requestBody),
            },
          );

          span.setAttributes({
            "llm.response_status": proxyResponse.status,
            "llm.response_ok": proxyResponse.ok,
          });

          if (!proxyResponse.ok) {
            const errorBody = await proxyResponse.text();
            llmErrorsCounter.add(1, {
              error_type: "api_error",
              model: input.model,
              status_code: proxyResponse.status.toString(),
            });
            span.setStatus({
              code: 2,
              message: `API error: ${proxyResponse.status}`,
            });
            throw new Error(`Failed to get model ${input.model}: ${errorBody}`);
          }

          // Check if streaming is requested
          if (input.stream) {
            span.setStatus({ code: 1 }); // Success
            return new Response(proxyResponse.body, {
              headers: {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
              },
            });
          }

          const responseText = await proxyResponse.text();

          try {
            const jsonResponse = JSON.parse(responseText);
            span.setStatus({ code: 1 }); // Success
            return jsonResponse;
          } catch (parseError) {
            llmErrorsCounter.add(1, {
              error_type: "json_parse_error",
              model: input.model,
            });
            const errorMessage = parseError instanceof Error
              ? parseError.message
              : "Unknown parse error";
            span.setStatus({
              code: 2,
              message: `JSON parse error: ${errorMessage}`,
            });
            throw new Error(
              `Invalid JSON response from model: ${errorMessage}`,
            );
          }
        }
        default:
          llmErrorsCounter.add(1, {
            error_type: "unknown_action",
            action: input.action,
          });
          span.setStatus({ code: 2, message: "Unknown action" });
          throw new Error("Unknown action");
      }
    } catch (error) {
      span.recordException(error as Error);
      throw error;
    } finally {
      const duration = (performance.now() - startTime) / 1000;
      llmRequestDuration.record(duration, {
        action: input.action,
        model: input.model,
      });
      span.setAttributes({ "llm.duration_seconds": duration });
      span.end();
    }
  }

  extractActions(input: LLMRequest) {
    return [{
      path: ["llm", "chat"],
      actions: [input.action],
    }];
  }
}

export async function getLLMResource(
  auth: Auth,
): Promise<(input: LLMRequest) => Promise<LLMResponse>> {
  return auth.getResource("llm");
}
