export type InferenceProviderAttempt = {
  providerProfileId: string;
  providerProfileName?: string;
  providerBaseUrl?: string;
  model?: string;
  fallbackUsed?: boolean;
  error?: string;
};

export type InferenceProvenance = {
  requestedModel: string;
  resolvedModel: string;
  responseModel?: string;
  fallbackModel?: string;
  fallbackUsed: boolean;
  providerBaseUrl?: string;
  providerProfileId?: string;
  providerProfileName?: string;
  // Every provider route tried for this request, in order. More than one
  // entry means provider-level failover happened.
  providerAttempts?: InferenceProviderAttempt[];
  promptCaching?: {
    enabled: boolean;
    sessionId?: string;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  };
};

/**
 * Compact routing summary for a whole job run. Persisted in job results so
 * the jobs list can show which provider and model actually served the job
 * without extra lookups.
 */
export type InferenceUsageSummary = {
  providerProfileId?: string;
  providerProfileName?: string;
  providerBaseUrl?: string;
  requestedModel?: string;
  resolvedModel?: string;
  // Model name the provider itself reported; differs from resolvedModel when
  // a server silently substitutes its loaded model.
  responseModel?: string;
  fallbackUsed?: boolean;
  // True when at least one request was served by a non-primary route.
  failoverUsed?: boolean;
  calls: number;
};

export function summarizeInferenceUsage(
  provenances: readonly InferenceProvenance[],
): InferenceUsageSummary | undefined {
  const relevant = provenances.filter((provenance) =>
    provenance.resolvedModel || provenance.providerProfileId
  );
  if (relevant.length === 0) return undefined;
  const last = relevant[relevant.length - 1];
  return {
    providerProfileId: last.providerProfileId,
    providerProfileName: last.providerProfileName,
    providerBaseUrl: last.providerBaseUrl,
    requestedModel: last.requestedModel,
    resolvedModel: last.resolvedModel,
    responseModel: last.responseModel,
    fallbackUsed: relevant.some((provenance) => provenance.fallbackUsed),
    failoverUsed: relevant.some((provenance) =>
      (provenance.providerAttempts?.length ?? 0) > 1
    ),
    calls: relevant.length,
  };
}

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
    providerAttempts?: unknown;
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
    ...(Array.isArray(routing?.providerAttempts) &&
        routing.providerAttempts.length > 0
      ? {
        providerAttempts: routing.providerAttempts.flatMap(
          (attempt: unknown): InferenceProviderAttempt[] => {
            if (!attempt || typeof attempt !== "object") return [];
            const candidate = attempt as Record<string, unknown>;
            const providerProfileId = optionalString(
              candidate.providerProfileId,
            );
            if (!providerProfileId) return [];
            return [{
              providerProfileId,
              providerProfileName: optionalString(
                candidate.providerProfileName,
              ),
              providerBaseUrl: optionalString(candidate.providerBaseUrl),
              model: optionalString(candidate.model),
              ...(candidate.fallbackUsed === true
                ? { fallbackUsed: true }
                : {}),
              ...(optionalString(candidate.error)
                ? { error: optionalString(candidate.error) }
                : {}),
            }];
          },
        ),
      }
      : {}),
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
