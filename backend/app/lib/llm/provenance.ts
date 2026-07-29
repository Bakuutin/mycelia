export type InferenceProvenance = {
  requestedModel: string;
  resolvedModel: string;
  responseModel?: string;
  fallbackModel?: string;
  fallbackUsed: boolean;
  providerBaseUrl?: string;
  providerProfileId?: string;
  providerProfileName?: string;
  promptCaching?: {
    enabled: boolean;
    sessionId?: string;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  };
};

type CompletionLike = {
  model?: unknown;
  mycelia_routing?: {
    requestedModel?: unknown;
    resolvedModel?: unknown;
    fallbackModel?: unknown;
    fallbackUsed?: unknown;
    providerBaseUrl?: unknown;
    providerProfileId?: unknown;
    providerProfileName?: unknown;
    promptCaching?: {
      enabled?: unknown;
      sessionId?: unknown;
      cacheReadTokens?: unknown;
      cacheWriteTokens?: unknown;
    };
  };
};

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

/** Normalize LLM routing metadata into a stable, persistable shape. */
export function getInferenceProvenance(
  completion: CompletionLike,
  requestedModel: string,
  requestedFallback?: string,
): InferenceProvenance {
  const routing = completion.mycelia_routing;
  const responseModel = optionalString(completion.model);
  const resolvedModel = optionalString(routing?.resolvedModel) ??
    responseModel ?? requestedModel;

  return {
    requestedModel: optionalString(routing?.requestedModel) ?? requestedModel,
    resolvedModel,
    responseModel,
    fallbackModel: optionalString(routing?.fallbackModel) ??
      optionalString(requestedFallback),
    fallbackUsed: routing?.fallbackUsed === true,
    providerBaseUrl: optionalString(routing?.providerBaseUrl),
    providerProfileId: optionalString(routing?.providerProfileId),
    providerProfileName: optionalString(routing?.providerProfileName),
    ...(routing?.promptCaching?.enabled === true
      ? {
        promptCaching: {
          enabled: true,
          sessionId: optionalString(routing.promptCaching.sessionId),
          ...(typeof routing.promptCaching.cacheReadTokens === "number"
            ? { cacheReadTokens: routing.promptCaching.cacheReadTokens }
            : {}),
          ...(typeof routing.promptCaching.cacheWriteTokens === "number"
            ? { cacheWriteTokens: routing.promptCaching.cacheWriteTokens }
            : {}),
        },
      }
      : {}),
  };
}
