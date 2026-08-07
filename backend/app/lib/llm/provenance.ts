import { getReasoningTokens } from "./reasoning-usage.ts";

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
  // Reasoning mode this call was made with, and the reasoning tokens the
  // provider reported billing — for quality/cost analysis per mode.
  reasoning?: "off" | "default";
  reasoningTokens?: number;
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
  // Reasoning mode across the job's calls ("mixed" when calls differ) and the
  // total reasoning tokens billed, when reported.
  reasoning?: "off" | "default" | "mixed";
  reasoningTokens?: number;
  // True when calls in this job were served by more than one provider; the
  // top-level fields then describe the most-used provider and byProvider
  // carries the full breakdown.
  mixed?: boolean;
  byProvider?: Array<{
    providerProfileId?: string;
    providerProfileName?: string;
    resolvedModel?: string;
    calls: number;
    // True when this group's calls ran on the configured fallback model.
    fallback?: boolean;
  }>;
};

export function summarizeInferenceUsage(
  provenances: readonly InferenceProvenance[],
): InferenceUsageSummary | undefined {
  const relevant = provenances.filter((provenance) =>
    provenance.resolvedModel || provenance.providerProfileId
  );
  if (relevant.length === 0) return undefined;

  // Batches can hit different providers and models per call (a saturated
  // route overflows by priority; a failed model retries on its fallback).
  // Group by provider AND executed model so partial fallback inside one
  // provider stays visible, and report the most-used group up top instead
  // of pretending the whole job ran on whichever served the last call.
  const groups = new Map<string, {
    last: InferenceProvenance;
    calls: number;
    fallbackCalls: number;
  }>();
  for (const provenance of relevant) {
    const providerKey = provenance.providerProfileId ??
      provenance.providerProfileName ?? provenance.providerBaseUrl ??
      "unknown";
    const key = `${providerKey}::${provenance.resolvedModel ?? ""}`;
    const group = groups.get(key);
    if (group) {
      group.calls += 1;
      group.fallbackCalls += provenance.fallbackUsed ? 1 : 0;
      group.last = provenance;
    } else {
      groups.set(key, {
        last: provenance,
        calls: 1,
        fallbackCalls: provenance.fallbackUsed ? 1 : 0,
      });
    }
  }
  const byProvider = [...groups.values()]
    .sort((a, b) => b.calls - a.calls)
    .map((group) => ({
      providerProfileId: group.last.providerProfileId,
      providerProfileName: group.last.providerProfileName,
      resolvedModel: group.last.resolvedModel,
      calls: group.calls,
      ...(group.fallbackCalls === group.calls ? { fallback: true } : {}),
    }));
  const dominant = byProvider[0];
  const dominantLast = [...groups.values()]
    .sort((a, b) => b.calls - a.calls)[0].last;

  return {
    providerProfileId: dominant.providerProfileId,
    providerProfileName: dominant.providerProfileName,
    providerBaseUrl: dominantLast.providerBaseUrl,
    requestedModel: dominantLast.requestedModel,
    resolvedModel: dominant.resolvedModel,
    responseModel: dominantLast.responseModel,
    fallbackUsed: relevant.some((provenance) => provenance.fallbackUsed),
    failoverUsed: relevant.some((provenance) =>
      (provenance.providerAttempts?.length ?? 0) > 1
    ),
    calls: relevant.length,
    ...((() => {
      const modes = new Set(
        relevant.map((p) => p.reasoning).filter(Boolean),
      );
      if (modes.size === 0) return {};
      return {
        reasoning: modes.size === 1 ? [...modes][0]! : "mixed" as const,
      };
    })()),
    ...(relevant.some((p) => p.reasoningTokens !== undefined)
      ? {
        reasoningTokens: relevant.reduce(
          (sum, p) => sum + (p.reasoningTokens ?? 0),
          0,
        ),
      }
      : {}),
    ...(byProvider.length > 1 ? { mixed: true, byProvider } : {}),
  };
}

type CompletionLike = {
  model?: unknown;
  usage?: unknown;
  mycelia_routing?: {
    requestedModel?: unknown;
    resolvedModel?: unknown;
    fallbackModel?: unknown;
    fallbackUsed?: unknown;
    providerBaseUrl?: unknown;
    providerProfileId?: unknown;
    providerProfileName?: unknown;
    reasoning?: unknown;
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
  const reasoning = routing?.reasoning === "off" || routing?.reasoning === "default"
    ? routing.reasoning
    : undefined;
  const reasoningTokens = getReasoningTokens(completion.usage);

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
    ...(reasoning ? { reasoning } : {}),
    ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
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
