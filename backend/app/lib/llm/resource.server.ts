import { z } from "zod";
import { Resource } from "@/lib/auth/resources.ts";
import { Auth } from "@/lib/auth/core.server.ts";
import { getServerConfig } from "@/lib/config/serverConfig.server.ts";
import { meter, tracer } from "@/lib/telemetry.ts";
import {
  getConfiguredFallback,
  normalizeOpenAIBaseUrl,
  resolveConfiguredModel,
  sanitizeProviderBaseUrl,
} from "./model-routing.ts";
import { normalizeChatCompletionResponse } from "./completion-response.ts";
import { getPromptCacheUsage } from "./prompt-cache-usage.ts";

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
  // Sent only to OpenRouter. A stable value makes its provider routing sticky,
  // which keeps a provider-side prompt cache warm across related requests.
  session_id: z.string().trim().min(1).max(128).optional(),
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

const batchRequestItemSchema = z.object({
  custom_id: z.string().trim().min(1).max(256),
  // OpenRouter validates the endpoint-specific body. Keeping this permissive
  // lets the resource support all documented batch API skins without leaking
  // batch transport details into workers.
  body: z.record(z.string(), z.unknown()),
});

const batchSubmitRequestSchema = z.object({
  action: z.literal("batch_submit"),
  endpoint: z.enum([
    "/v1/chat/completions",
    "/v1/responses",
    "/v1/messages",
    "/v1/embeddings",
  ]),
  model: z.string().trim().min(1),
  requests: z.array(batchRequestItemSchema).min(1).max(100),
});

const batchGetRequestSchema = z.object({
  action: z.literal("batch_get"),
  batchId: z.string().trim().min(1),
});

const batchCancelRequestSchema = z.object({
  action: z.literal("batch_cancel"),
  batchId: z.string().trim().min(1),
});

const listModelsRequestSchema = z.object({
  action: z.literal("list"),
});

const llmRequestSchema = z.discriminatedUnion("action", [
  chatCompletionRequestSchema,
  batchSubmitRequestSchema,
  batchGetRequestSchema,
  batchCancelRequestSchema,
  listModelsRequestSchema,
]);

type LLMRequest = z.infer<typeof llmRequestSchema>;
type LLMResponse = any | Response;

function isOpenRouterBaseUrl(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).hostname === "openrouter.ai";
  } catch {
    return false;
  }
}

function readFiniteCost(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return value;
}

/**
 * OpenRouter exposes the final billed amount through its generation metadata
 * endpoint. The chat-completions response intentionally contains token usage,
 * but not necessarily cost, so this is the authoritative fallback when a
 * LiteLLM-compatible response-cost header is unavailable.
 */
async function getOpenRouterGenerationCost(
  baseUrl: string,
  apiKey: string,
  generationId: string | null,
): Promise<number | undefined> {
  if (!generationId || !isOpenRouterBaseUrl(baseUrl)) return undefined;

  try {
    const generationResponse = await fetch(
      `${baseUrl}/generation?id=${encodeURIComponent(generationId)}`,
      { headers: { "Authorization": `Bearer ${apiKey}` } },
    );
    if (!generationResponse.ok) {
      console.warn(
        `[llm] OpenRouter generation metadata unavailable for ${generationId}: HTTP ${generationResponse.status}`,
      );
      return undefined;
    }
    const generation = await generationResponse.json() as {
      data?: { total_cost?: unknown };
    };
    return readFiniteCost(generation.data?.total_cost);
  } catch (error) {
    console.warn(
      `[llm] Failed to fetch OpenRouter generation metadata for ${generationId}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return undefined;
  }
}

export interface InferenceProviderConfig {
  baseUrl: string;
  apiKey: string;
  model?: string;
  chatModel?: string;
  defaultAlias?: "small" | "medium" | "large";
  smallModel?: string;
  mediumModel?: string;
  largeModel?: string;
  profileId?: string;
  profileName?: string;
  fallbackEnabled: boolean;
  fallbackModel?: string;
  promptCachingEnabled: boolean;
  promptCacheSessionPrefix?: string;
}

function getOpenRouterSessionId(
  baseUrl: string,
  provider: InferenceProviderConfig,
  requestedSessionId: string | undefined,
): string | undefined {
  if (
    !requestedSessionId || !provider.promptCachingEnabled ||
    !isOpenRouterPromptCachingBaseUrl(baseUrl)
  ) {
    return undefined;
  }

  const prefix = provider.promptCacheSessionPrefix?.trim() || "mycelia";
  // The request schema limits the suffix to 128 characters, so this stays
  // comfortably below OpenRouter's 256-character session_id limit.
  return `${prefix}:${requestedSessionId}`;
}

function isOpenRouterPromptCachingBaseUrl(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).hostname === "openrouter.ai";
  } catch {
    return false;
  }
}

function getOpenRouterBatchBaseUrl(baseUrl: string): string | null {
  try {
    const url = new URL(baseUrl);
    if (url.hostname !== "openrouter.ai") return null;
    return `${url.protocol}//${url.host}/api/beta/batches`;
  } catch {
    return null;
  }
}

async function readOpenRouterBatchResponse(response: Response): Promise<any> {
  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    // Preserve the useful provider body in a bounded error below.
  }
  if (!response.ok) {
    const detail = typeof parsed === "object" && parsed !== null
      ? JSON.stringify(parsed)
      : text;
    throw new Error(
      `OpenRouter Batch API error (${response.status}): ${detail.slice(0, 1000)}`,
    );
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("OpenRouter Batch API returned an invalid JSON response");
  }
  return parsed;
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
    const envChatModel = Deno.env.get("OPENAI_CHAT_MODEL") ||
      Deno.env.get("CHAT_MODEL");
    const envFallbackModel = Deno.env.get("OPENAI_FALLBACK_MODEL");
    const envFallbackEnabledValue = Deno.env.get("OPENAI_FALLBACK_ENABLED");
    const envFallbackEnabled = envFallbackEnabledValue === "true";
    const envPromptCachingEnabled =
      Deno.env.get("OPENROUTER_PROMPT_CACHING") !==
        "false";
    const envPromptCacheSessionPrefix = Deno.env.get(
      "OPENROUTER_SESSION_PREFIX",
    );

    if (envBaseUrl && envApiKey) {
      return {
        baseUrl: envBaseUrl,
        apiKey: envApiKey,
        model: envModel,
        chatModel: envChatModel || envModel,
        defaultAlias: "medium",
        smallModel: Deno.env.get("MODEL_SMALL"),
        mediumModel: Deno.env.get("MODEL_MEDIUM"),
        largeModel: Deno.env.get("MODEL_LARGE"),
        profileId: "environment",
        profileName: "Environment overrides",
        fallbackEnabled: envFallbackEnabled,
        fallbackModel: envFallbackModel,
        promptCachingEnabled: envPromptCachingEnabled,
        promptCacheSessionPrefix: envPromptCacheSessionPrefix,
      };
    }

    // Fallback to MongoDB config for backward compatibility
    const config = await getServerConfig();
    const activeProfile = config.llmProfiles?.profiles.find((profile) =>
      profile.id === config.llmProfiles?.activeProfileId
    );
    if (activeProfile?.baseUrl && activeProfile.apiKey) {
      const defaultAlias = activeProfile.defaultAlias ?? "medium";
      return {
        baseUrl: activeProfile.baseUrl,
        apiKey: activeProfile.apiKey,
        model: activeProfile.aliases[defaultAlias],
        chatModel: activeProfile.chatModel ||
          activeProfile.aliases[defaultAlias],
        defaultAlias,
        smallModel: activeProfile.aliases.small,
        mediumModel: activeProfile.aliases.medium,
        largeModel: activeProfile.aliases.large,
        profileId: activeProfile.id,
        profileName: activeProfile.name,
        fallbackEnabled: false,
        promptCachingEnabled: activeProfile.promptCaching?.enabled ?? true,
        promptCacheSessionPrefix: activeProfile.promptCaching?.sessionPrefix,
      };
    }
    const provider = config.llm || config.inference;
    if (!provider?.baseUrl || !provider?.apiKey) {
      return null;
    }
    return {
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      model: envModel || provider.model,
      chatModel: envChatModel || provider.chatModel || envModel ||
        provider.model,
      defaultAlias: "medium",
      smallModel: Deno.env.get("MODEL_SMALL"),
      mediumModel: Deno.env.get("MODEL_MEDIUM"),
      largeModel: Deno.env.get("MODEL_LARGE"),
      profileId: "legacy",
      profileName: "Legacy provider",
      fallbackEnabled: envFallbackEnabledValue === undefined
        ? provider.fallbackEnabled ?? false
        : envFallbackEnabled,
      fallbackModel: envFallbackModel || provider.fallbackModel,
      promptCachingEnabled: provider.promptCaching?.enabled ?? true,
      promptCacheSessionPrefix: provider.promptCaching?.sessionPrefix,
    };
  }

  /**
   * Resolve model aliases (small/medium/large) to actual model names.
   * Explicit model IDs stay explicit. Legacy aliases resolve through
   * BASE_MODEL, then MODEL_* mappings, then the configured global model.
   */
  resolveModelAlias(
    modelName: string,
    provider: InferenceProviderConfig,
  ): string {
    return resolveConfiguredModel(modelName, {
      defaultModel: provider.model,
      baseModel: Deno.env.get("BASE_MODEL"),
      smallModel: provider.smallModel || Deno.env.get("MODEL_SMALL"),
      mediumModel: provider.mediumModel || Deno.env.get("MODEL_MEDIUM"),
      largeModel: provider.largeModel || Deno.env.get("MODEL_LARGE"),
    });
  }

  async use(input: LLMRequest, auth: Auth): Promise<LLMResponse> {
    const startTime = performance.now();
    // Track the resolved model for consistent metrics (set after resolution)
    let resolvedModel = input.action === "completions" ? input.model : "n/a";

    const span = tracer.startSpan("llm_resource_use", {
      attributes: {
        "llm.action": input.action,
        "llm.model_requested": input.action === "completions"
          ? input.model
          : undefined,
      },
    });

    try {
      switch (input.action) {
        case "batch_submit":
        case "batch_get":
        case "batch_cancel": {
          const provider = await this.getInferenceProvider();
          if (!provider) {
            throw new Error(
              "Inference provider not configured. Please configure it in server settings.",
            );
          }
          const batchBaseUrl = getOpenRouterBatchBaseUrl(provider.baseUrl);
          if (!batchBaseUrl) {
            throw new Error(
              "OpenRouter Batch API requires an active provider with base URL https://openrouter.ai/api/v1",
            );
          }

          let url = batchBaseUrl;
          let method = "GET";
          let body: Record<string, unknown> | undefined;
          if (input.action === "batch_submit") {
            method = "POST";
            // Property order is intentional: OpenRouter stream-parses batch
            // input and requires endpoint/model before requests.
            body = {
              endpoint: input.endpoint,
              model: this.resolveModelAlias(input.model, provider),
              requests: input.requests,
            };
          } else {
            url = `${batchBaseUrl}/${encodeURIComponent(input.batchId)}`;
            if (input.action === "batch_cancel") {
              method = "POST";
              url += "/cancel";
            }
          }

          const batchResponse = await fetch(url, {
            method,
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${provider.apiKey}`,
            },
            ...(body ? { body: JSON.stringify(body) } : {}),
          });
          return await readOpenRouterBatchResponse(batchResponse);
        }
        case "completions": {
          const {
            action,
            fallbackModel: _fallbackModel,
            session_id: requestedSessionId,
            ...body
          } = input;

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
            throw new Error(
              "Inference provider not configured. Please configure it in server settings.",
            );
          }

          const baseUrl = normalizeOpenAIBaseUrl(provider.baseUrl);
          const sessionId = getOpenRouterSessionId(
            baseUrl,
            provider,
            requestedSessionId,
          );

          // Legacy aliases resolve to the configured global default. Explicit
          // task models remain explicit and are never silently replaced.
          resolvedModel = this.resolveModelAlias(input.model, provider);
          // A caller can explicitly provide a fallback model, or provide an
          // empty string to opt out. Calls that do not declare a policy retain
          // the provider-level fallback for backwards compatibility.
          const requestControlsFallback = input.fallbackModel !== undefined;
          const requestedFallback = requestControlsFallback
            ? input.fallbackModel
            : provider.fallbackModel;
          const configuredFallback = requestedFallback
            ? this.resolveModelAlias(requestedFallback, provider)
            : undefined;
          const fallbackModel = getConfiguredFallback(
            resolvedModel,
            requestControlsFallback
              ? Boolean(requestedFallback?.trim())
              : provider.fallbackEnabled,
            configuredFallback,
          );

          // Record request with resolved model
          llmRequestCounter.add(1, {
            action: input.action,
            model: resolvedModel,
          });

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
              body: JSON.stringify({
                ...body,
                model,
                ...(sessionId ? { session_id: sessionId } : {}),
              }),
            });

          let proxyResponse: Response;
          let primaryError: string | null = null;
          let responseErrorBody: string | null = null;
          let fallbackUsed = false;

          try {
            proxyResponse = await sendRequest(resolvedModel);
            if (!proxyResponse.ok) {
              responseErrorBody = await proxyResponse.text();
              primaryError = `HTTP ${proxyResponse.status}: ${
                responseErrorBody.slice(0, 500)
              }`;
            }
          } catch (error) {
            primaryError = error instanceof Error
              ? error.message
              : String(error);
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
            responseErrorBody = null;
          }

          span.setAttributes({
            "llm.response_status": proxyResponse.status,
            "llm.response_ok": proxyResponse.ok,
          });

          if (!proxyResponse.ok) {
            // The primary response body may already have been read while
            // deciding whether to invoke the configured fallback. Reuse that
            // captured body so the actual provider error is preserved.
            const errorBody = responseErrorBody ?? await proxyResponse.text();
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
            throw new Error(
              `LLM API error (${proxyResponse.status}); requested model "${input.model}" resolved to "${resolvedModel}" at ${baseUrl}: ${
                errorBody.slice(0, 500)
              }${primaryContext}`,
            );
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

            normalizeChatCompletionResponse(jsonResponse, {
              requestedModel: input.model,
              resolvedModel,
            });

            // Persistable routing provenance for workers. This makes it
            // possible to distinguish requested aliases, the model that
            // actually ran, and an explicit fallback retry.
            const promptCacheUsage = getPromptCacheUsage(jsonResponse.usage);
            jsonResponse.mycelia_routing = {
              requestedModel: input.model,
              resolvedModel,
              fallbackModel: fallbackModel || undefined,
              fallbackUsed,
              // Persist only the normalized provider route, never credentials.
              providerBaseUrl: sanitizeProviderBaseUrl(baseUrl),
              providerProfileId: provider.profileId,
              providerProfileName: provider.profileName,
              promptCaching: sessionId
                ? { enabled: true, sessionId, ...promptCacheUsage }
                : { enabled: false },
            };

            // Prefer a cost supplied inline or by LiteLLM. OpenRouter chat
            // completions normally provide neither, but include a generation
            // id whose metadata has the authoritative final billed amount.
            const responseCostHeader = proxyResponse.headers.get(
              "x-litellm-response-cost",
            );
            const inlineCost = readFiniteCost(jsonResponse.usage?.cost);
            const headerCost = responseCostHeader === null
              ? undefined
              : readFiniteCost(Number(responseCostHeader));
            const generationCost = inlineCost === undefined &&
                headerCost === undefined
              ? await getOpenRouterGenerationCost(
                baseUrl,
                provider.apiKey,
                proxyResponse.headers.get("x-generation-id"),
              )
              : undefined;
            const responseCost = inlineCost ?? headerCost ?? generationCost;
            if (responseCost !== undefined) {
              jsonResponse.response_cost = responseCost;
            }

            span.setStatus({ code: 1 }); // Success
            return jsonResponse;
          } catch (parseError) {
            if (
              parseError instanceof Error &&
              (
                parseError.message.startsWith("LLM_INVALID_RESPONSE:") ||
                parseError.message.startsWith("LLM_EMPTY_RESPONSE:")
              )
            ) {
              throw parseError;
            }
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
            const preview = responseText.length > 200
              ? responseText.slice(0, 200) + "..."
              : responseText;
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
            throw new Error(
              "Inference provider not configured. Please configure it in server settings.",
            );
          }

          const baseUrl = normalizeOpenAIBaseUrl(provider.baseUrl);

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
            throw new Error(
              `Failed to fetch models (${modelsResponse.status}): ${
                errorText.slice(0, 200)
              }`,
            );
          }

          const modelsData = await modelsResponse.json();

          // Get category config from env vars
          const categories = {
            small: {
              default: provider.smallModel || Deno.env.get("MODEL_SMALL") ||
                provider.model || "small",
              models: [] as string[],
            },
            medium: {
              default: provider.mediumModel || Deno.env.get("MODEL_MEDIUM") ||
                provider.model ||
                "medium",
              models: [] as string[],
            },
            large: {
              default: provider.largeModel || Deno.env.get("MODEL_LARGE") ||
                provider.model || "large",
              models: [] as string[],
            },
          };

          span.setStatus({ code: 1 });
          return {
            models: modelsData.data || [],
            categories,
            defaultAlias: provider.defaultAlias || "medium",
            defaultModel: this.resolveModelAlias(
              provider.defaultAlias || "medium",
              provider,
            ),
            chatDefaultModel: this.resolveModelAlias(
              provider.chatModel || provider.defaultAlias ||
                provider.model || "medium",
              provider,
            ),
            resolvedAliases: {
              small: this.resolveModelAlias("small", provider),
              medium: this.resolveModelAlias("medium", provider),
              large: this.resolveModelAlias("large", provider),
            },
            providerProfileName: provider.profileName,
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
