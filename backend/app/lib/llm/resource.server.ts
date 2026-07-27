import { z } from "zod";
import { Resource } from "@/lib/auth/resources.ts";
import { Auth } from "@/lib/auth/core.server.ts";
import { getServerConfig } from "@/lib/config/serverConfig.server.ts";
import { meter, tracer } from "@/lib/telemetry.ts";
import {
  getConfiguredFallback,
  resolveConfiguredModel,
} from "./model-routing.ts";

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
  fallbackModel: z.string().optional(),
  reasoning_budget: z.number().int().min(-1).optional(),
  chat_template_kwargs: z.record(z.string(), z.unknown()).optional(),
  response_format: z
    .union([
      z.object({ type: z.literal("text") }),
      z.object({ type: z.literal("json_object") }),
      z.object({ type: z.literal("json_schema"), json_schema: z.any() }),
    ])
    .optional(),
});

const listModelsRequestSchema = z.object({
  action: z.literal("list"),
});

const llmRequestSchema = z.discriminatedUnion("action", [
  chatCompletionRequestSchema,
  listModelsRequestSchema,
]);

type LLMRequest = z.infer<typeof llmRequestSchema>;
type LLMResponse = any | Response;

export interface InferenceProviderConfig {
  baseUrl: string;
  apiKey: string;
  model?: string;
  fallbackEnabled: boolean;
  fallbackModel?: string;
}

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

  async getInferenceProvider(): Promise<InferenceProviderConfig | null> {
    // TODO: move env vars logic to getServerConfig,
    // also to allow setting any config value as flattened nested env vars
    // (e.g. MYCELIA__INFERENCE__API_KEY, MYCELIA__INFERENCE__MODEL)

    // Stateless config: read from env vars first (ushadow pattern)
    const envBaseUrl = Deno.env.get("OPENAI_BASE_URL");
    const envApiKey = Deno.env.get("OPENAI_API_KEY");
    // Model resolution: OPENAI_MODEL (for override) > BASE_MODEL (primary config)
    const envModel = Deno.env.get("OPENAI_MODEL") || Deno.env.get("BASE_MODEL");
    const envFallbackModel = Deno.env.get("OPENAI_FALLBACK_MODEL");
    const envFallbackEnabledValue = Deno.env.get("OPENAI_FALLBACK_ENABLED");
    const envFallbackEnabled = envFallbackEnabledValue === "true";

    if (envBaseUrl && envApiKey) {
      return {
        baseUrl: envBaseUrl,
        apiKey: envApiKey,
        model: envModel,
        fallbackEnabled: envFallbackEnabled,
        fallbackModel: envFallbackModel,
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
      model: envModel || provider.model,
      fallbackEnabled: envFallbackEnabledValue === undefined
        ? provider.fallbackEnabled ?? false
        : envFallbackEnabled,
      fallbackModel: envFallbackModel || provider.fallbackModel,
    };
  }

  /**
   * Resolve model aliases (small/medium/large) to actual model names.
   * Priority: BASE_MODEL env var > explicit task model > MODEL_* alias > configured global model
   */
  resolveModelAlias(modelName: string, defaultModel?: string): string {
    return resolveConfiguredModel(modelName, {
      defaultModel,
      baseModel: Deno.env.get("BASE_MODEL"),
      smallModel: Deno.env.get("MODEL_SMALL"),
      mediumModel: Deno.env.get("MODEL_MEDIUM"),
      largeModel: Deno.env.get("MODEL_LARGE"),
    });
  }

  async use(input: LLMRequest, auth: Auth): Promise<LLMResponse> {
    const startTime = performance.now();
    // Track the resolved model for consistent metrics (set after resolution)
    let resolvedModel = input.action === "completions" ? input.model : "n/a";

    const span = tracer.startSpan("llm_resource_use", {
      attributes: {
        "llm.action": input.action,
        "llm.model_requested": input.action === "completions" ? input.model : undefined,
      },
    });

    try {
      switch (input.action) {
        case "completions": {
          const { action, fallbackModel: _fallbackModel, ...body } = input;

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

          // Legacy aliases resolve to the configured global default. Explicit
          // task models remain explicit and are never silently replaced.
          resolvedModel = this.resolveModelAlias(input.model, provider.model);
          // A caller can explicitly provide a fallback model, or provide an
          // empty string to opt out. Calls that do not declare a policy retain
          // the provider-level fallback for backwards compatibility.
          const requestControlsFallback = input.fallbackModel !== undefined;
          const requestedFallback = requestControlsFallback
            ? input.fallbackModel
            : provider.fallbackModel;
          const configuredFallback = requestedFallback
            ? this.resolveModelAlias(requestedFallback, provider.model)
            : undefined;
          const fallbackModel = getConfiguredFallback(
            resolvedModel,
            requestControlsFallback
              ? Boolean(requestedFallback?.trim())
              : provider.fallbackEnabled,
            configuredFallback,
          );

          // Record request with resolved model
          llmRequestCounter.add(1, { action: input.action, model: resolvedModel });

          span.setAttributes({
            "llm.model": resolvedModel,
            "llm.base_url": baseUrl,
            "llm.has_api_key": !!provider.apiKey,
          });

          const sendRequest = (model: string) =>
            fetch(`${baseUrl}/chat/completions`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${provider.apiKey}`,
              },
              body: JSON.stringify({ ...body, model }),
            });

          let proxyResponse: Response;
          let primaryError: string | null = null;
          let fallbackUsed = false;

          try {
            proxyResponse = await sendRequest(resolvedModel);
            if (!proxyResponse.ok) {
              primaryError = `HTTP ${proxyResponse.status}: ${
                (await proxyResponse.text()).slice(0, 500)
              }`;
            }
          } catch (error) {
            primaryError = error instanceof Error ? error.message : String(error);
            proxyResponse = new Response(null, { status: 502 });
          }

          if (primaryError && fallbackModel) {
            console.warn(
              `[llm] Primary model "${resolvedModel}" failed; retrying explicitly configured fallback "${fallbackModel}": ${primaryError}`,
            );
            span.setAttribute("llm.fallback_used", true);
            fallbackUsed = true;
            resolvedModel = fallbackModel;
            proxyResponse = await sendRequest(resolvedModel);
          }

          span.setAttributes({
            "llm.response_status": proxyResponse.status,
            "llm.response_ok": proxyResponse.ok,
          });

          if (!proxyResponse.ok) {
            const errorBody = await proxyResponse.text();
            llmErrorsCounter.add(1, {
              error_type: "api_error",
              model: resolvedModel,
              status_code: proxyResponse.status.toString(),
            });
            span.setStatus({
              code: 2,
              message: `API error: ${proxyResponse.status}`,
            });
            const primaryContext = primaryError
              ? ` Primary model error: ${primaryError}.`
              : "";
            throw new Error(`LLM API error (${proxyResponse.status}) for model "${resolvedModel}" at ${baseUrl}: ${errorBody.slice(0, 500)}${primaryContext}`);
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

            // Persistable routing provenance for workers. This makes it
            // possible to distinguish requested aliases, the model that
            // actually ran, and an explicit fallback retry.
            jsonResponse.mycelia_routing = {
              requestedModel: input.model,
              resolvedModel,
              fallbackModel: fallbackModel || undefined,
              fallbackUsed,
            };

            // Extract cost from litellm response header (x-litellm-response-cost)
            const responseCostHeader = proxyResponse.headers.get("x-litellm-response-cost");
            if (responseCostHeader) {
              const cost = parseFloat(responseCostHeader);
              if (!isNaN(cost)) {
                jsonResponse.response_cost = cost;
              }
            }

            span.setStatus({ code: 1 }); // Success
            return jsonResponse;
          } catch (parseError) {
            llmErrorsCounter.add(1, {
              error_type: "json_parse_error",
              model: resolvedModel,
            });
            const errorMessage = parseError instanceof Error
              ? parseError.message
              : "Unknown parse error";
            span.setStatus({
              code: 2,
              message: `JSON parse error: ${errorMessage}`,
            });
            const preview = responseText.length > 200 ? responseText.slice(0, 200) + '...' : responseText;
            throw new Error(
              `Invalid JSON response from model "${resolvedModel}": ${errorMessage}. Response: ${preview}`,
            );
          }
        }
        case "list": {
          const provider = await this.getInferenceProvider();
          if (!provider) {
            span.setStatus({
              code: 2,
              message: "Inference provider not configured",
            });
            throw new Error("Inference provider not configured. Please configure it in server settings.");
          }

          // Normalize base URL
          let baseUrl = provider.baseUrl.replace(/\/$/, "");
          if (!baseUrl.endsWith("/v1")) {
            baseUrl = `${baseUrl}/v1`;
          }

          // Fetch available models from inference provider
          const modelsResponse = await fetch(`${baseUrl}/models`, {
            headers: { "Authorization": `Bearer ${provider.apiKey}` },
          });

          if (!modelsResponse.ok) {
            const errorText = await modelsResponse.text();
            span.setStatus({
              code: 2,
              message: `Failed to fetch models: ${modelsResponse.status}`,
            });
            throw new Error(`Failed to fetch models (${modelsResponse.status}): ${errorText.slice(0, 200)}`);
          }

          const modelsData = await modelsResponse.json();

          // Get category config from env vars
          const categories = {
            small: {
              default: Deno.env.get("MODEL_SMALL") || provider.model || "small",
              models: [] as string[],
            },
            medium: {
              default: Deno.env.get("MODEL_MEDIUM") || provider.model || "medium",
              models: [] as string[],
            },
            large: {
              default: Deno.env.get("MODEL_LARGE") || provider.model || "large",
              models: [] as string[],
            },
          };

          span.setStatus({ code: 1 });
          return {
            models: modelsData.data || [],
            categories,
          };
        }
        default:
          llmErrorsCounter.add(1, {
            error_type: "unknown_action",
            action: (input as any).action,
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
        model: resolvedModel,
      });
      span.setAttributes({ "llm.duration_seconds": duration });
      span.end();
    }
  }

  extractActions(input: LLMRequest) {
    if (input.action === "list") {
      return [{
        path: ["llm", "models"],
        actions: ["list"],
      }];
    }
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
