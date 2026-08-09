import {
  getLlmProviderInFlight,
  LLMResource,
} from "@/lib/llm/resource.server.ts";
import {
  getEnabledLlmProviders,
  type ResolvedLlmProvider,
} from "@/lib/llm/provider-routing.ts";
import { TranscriptionResource } from "@/lib/transcription/resource.server.ts";
import {
  classifyServiceResponse,
  type ExternalServiceHealth,
  type ExternalServiceId,
  getJobServiceDependencies,
  getModelsUrl,
  getProviderHealthUrl,
  JOB_SERVICE_DEPENDENCIES,
  normalizeProviderModelId,
  shouldFallbackToSttHealth,
} from "./service-health.shared.ts";
export * from "./service-health.shared.ts";

// Worker enqueue decisions still need a recent provider status, but the Jobs
// page must not repeatedly wake otherwise-idle local STT servers. Keep this
// above the trigger intervals (up to ~10 min) so periodic ticks reuse the
// cached verdict instead of live-probing providers every cycle; a stale
// "healthy" self-corrects because provider-shaped job failures call
// invalidateExternalServicesHealthCache() and unhealthy verdicts expire fast.
const CACHE_MS = 15 * 60_000;
// Unhealthy verdicts expire quickly so blocked workers resume within
// seconds of a provider recovering, instead of waiting out the full cache.
const UNHEALTHY_CACHE_MS = 30_000;
let cached: {
  checkedAt: number;
  fingerprint: string;
  services: ExternalServiceHealth[];
} | null = null;

/**
 * Drop the cached verdict so the next check re-probes providers. Called when
 * a running job fails with a provider-shaped error: the cached "healthy" is
 * evidently stale and trusting it would start more jobs doomed to fail.
 */
export function invalidateExternalServicesHealthCache(): void {
  cached = null;
}

function extractModels(body: string): string[] {
  try {
    const parsed = JSON.parse(body);
    const entries: unknown[] = Array.isArray(parsed?.data)
      ? parsed.data
      : Array.isArray(parsed?.models)
      ? parsed.models
      : [];
    const ids = entries
      .map((entry: unknown) =>
        typeof entry === "string"
          ? entry
          : typeof entry === "object" && entry !== null &&
              typeof (entry as { id?: unknown }).id === "string"
          ? (entry as { id: string }).id
          : typeof entry === "object" && entry !== null &&
              typeof (entry as { model?: unknown }).model === "string"
          ? (entry as { model: string }).model
          : typeof entry === "object" && entry !== null &&
              typeof (entry as { name?: unknown }).name === "string"
          ? (entry as { name: string }).name
          : null
      )
      .filter((value: string | null): value is string => Boolean(value))
      .map(normalizeProviderModelId);
    return [
      ...new Set<string>(ids),
    ];
  } catch {
    return [];
  }
}

function extractReportedSttModel(body: string): string | undefined {
  try {
    const parsed = JSON.parse(body);
    const value = [
      parsed?.model,
      parsed?.loadedModel,
      parsed?.effectiveModel,
      parsed?.asrModel,
    ].find((candidate): candidate is string =>
      typeof candidate === "string" && candidate.trim().length > 0
    );
    return value ? normalizeProviderModelId(value) : undefined;
  } catch {
    return undefined;
  }
}

async function probeProvider(input: {
  id: ExternalServiceId;
  label: string;
  baseUrl?: string;
  apiKey?: string;
  source?: string;
  providerProfileId?: string;
  providerProfileName?: string;
  model?: string;
}): Promise<ExternalServiceHealth> {
  const usedBy = Object.entries(JOB_SERVICE_DEPENDENCIES)
    .filter(([, dependencies]) => dependencies.includes(input.id))
    .map(([workerType]) => workerType);
  const checkedAt = new Date().toISOString();

  if (!input.baseUrl || !input.apiKey) {
    return {
      id: input.id,
      label: input.label,
      status: "misconfigured",
      configured: false,
      source: input.source,
      providerProfileId: input.providerProfileId,
      providerProfileName: input.providerProfileName,
      model: input.model,
      message: "Provider URL or API key is not configured",
      checkedAt,
      usedBy,
    };
  }

  const modelsUrl = getModelsUrl(input.baseUrl);
  const startedAt = performance.now();
  try {
    const response = await fetch(modelsUrl, {
      headers: { Authorization: `Bearer ${input.apiKey}` },
      signal: AbortSignal.timeout(5_000),
    });
    let body = await response.text();
    let effectiveResponse = response;
    let usedHealthFallback = false;
    if (shouldFallbackToSttHealth(input.id, response.status)) {
      const statusResponse = await fetch(
        `${input.baseUrl.trim().replace(/\/+$/, "")}/v1/stt/status`,
        {
          headers: { Authorization: `Bearer ${input.apiKey}` },
          signal: AbortSignal.timeout(5_000),
        },
      );
      const statusBody = await statusResponse.text();
      const statusModel = statusResponse.ok
        ? extractReportedSttModel(statusBody)
        : undefined;
      if (statusModel) {
        body = statusBody;
        effectiveResponse = statusResponse;
        usedHealthFallback = true;
      } else {
        effectiveResponse = await fetch(getProviderHealthUrl(input.baseUrl), {
          headers: { Authorization: `Bearer ${input.apiKey}` },
          signal: AbortSignal.timeout(5_000),
        });
        body = await effectiveResponse.text();
        usedHealthFallback = effectiveResponse.ok;
      }
    }
    const models = response.ok
      ? extractModels(body)
      : extractReportedSttModel(body)
      ? [extractReportedSttModel(body)!]
      : [];
    const configuredModel = input.model
      ? normalizeProviderModelId(input.model)
      : undefined;
    const exactModelMissing = input.id === "llm" && response.ok &&
      configuredModel &&
      !["small", "medium", "large"].includes(configuredModel) &&
      models.length > 0 && !models.includes(configuredModel);
    const classification = exactModelMissing
      ? {
        status: "misconfigured" as const,
        message:
          `Configured model "${configuredModel}" is not advertised by this provider`,
      }
      : classifyServiceResponse(effectiveResponse.status, body);
    if (usedHealthFallback) {
      classification.message = models.length > 0
        ? `Connection successful; provider reports loaded model ${models[0]}`
        : "Connection successful; provider uses the configured STT model";
    }
    return {
      id: input.id,
      label: input.label,
      ...classification,
      configured: true,
      baseUrl: input.baseUrl,
      modelsUrl,
      source: input.source,
      providerProfileId: input.providerProfileId,
      providerProfileName: input.providerProfileName,
      model: input.model,
      models,
      httpStatus: effectiveResponse.status,
      latencyMs: Math.round(performance.now() - startedAt),
      checkedAt,
      usedBy,
    };
  } catch (error) {
    return {
      id: input.id,
      label: input.label,
      status: "unavailable",
      configured: true,
      baseUrl: input.baseUrl,
      modelsUrl,
      source: input.source,
      providerProfileId: input.providerProfileId,
      providerProfileName: input.providerProfileName,
      model: input.model,
      latencyMs: Math.round(performance.now() - startedAt),
      message: error instanceof Error ? error.message : String(error),
      checkedAt,
      usedBy,
    };
  }
}

function getDiarizatorBaseUrl(): string {
  return Deno.env.get("DIARIZATION_SERVER_URL") ??
    "http://host.docker.internal:8085";
}

// The diarizator exposes only GET /health — probeProvider's /models + apiKey
// contract doesn't fit, so it gets a dedicated probe.
async function probeDiarizator(): Promise<ExternalServiceHealth> {
  const usedBy = Object.entries(JOB_SERVICE_DEPENDENCIES)
    .filter(([, dependencies]) => dependencies.includes("diarizator"))
    .map(([workerType]) => workerType);
  const checkedAt = new Date().toISOString();
  const baseUrl = getDiarizatorBaseUrl();
  const healthUrl = `${baseUrl.trim().replace(/\/+$/, "")}/health`;
  const startedAt = performance.now();
  try {
    const response = await fetch(healthUrl, {
      signal: AbortSignal.timeout(5_000),
    });
    const body = await response.text();
    return {
      id: "diarizator",
      label: "Diarizator (speaker service)",
      ...classifyServiceResponse(response.status, body),
      configured: true,
      baseUrl,
      httpStatus: response.status,
      latencyMs: Math.round(performance.now() - startedAt),
      checkedAt,
      usedBy,
    };
  } catch (error) {
    return {
      id: "diarizator",
      label: "Diarizator (speaker service)",
      status: "unavailable",
      configured: true,
      baseUrl,
      latencyMs: Math.round(performance.now() - startedAt),
      message: `${
        error instanceof Error ? error.message : String(error)
      } — start it with scripts/start-diarizator.sh`,
      checkedAt,
      usedBy,
    };
  }
}

export async function getExternalServicesHealth(
  force = false,
): Promise<ExternalServiceHealth[]> {
  const transcriptionResource = new TranscriptionResource();
  const llmResource = new LLMResource();
  const [sttProviders, llmProviders] = await Promise.all([
    transcriptionResource.getInferenceProviders().catch(() => []),
    llmResource.getInferenceProviders().catch(() =>
      [] as ResolvedLlmProvider[]
    ),
  ]);
  const fingerprint = JSON.stringify({
    diarizator: getDiarizatorBaseUrl(),
    stt: sttProviders.map((provider) => ({
      id: provider.id,
      enabled: provider.enabled,
      baseUrl: provider.baseUrl,
      model: provider.model,
      concurrency: provider.concurrency,
    })),
    llm: llmProviders.map((provider) => ({
      id: provider.id,
      enabled: provider.enabled,
      baseUrl: provider.baseUrl,
      model: provider.aliases[provider.defaultAlias],
      priority: provider.priority,
    })),
  });
  const now = Date.now();
  if (!force && cached && cached.fingerprint === fingerprint) {
    const cacheTtlMs = cached.services.some((s) => s.status !== "healthy")
      ? UNHEALTHY_CACHE_MS
      : CACHE_MS;
    if (now - cached.checkedAt < cacheTtlMs) {
      return cached.services;
    }
  }

  const enabledSttProviders = sttProviders.filter((provider) =>
    provider.enabled
  );
  const allSttRoutesDisabled = sttProviders.length > 0 &&
    enabledSttProviders.length === 0;
  const sttRouteHealth = await Promise.all(
    enabledSttProviders.map((provider) =>
      probeProvider({
        id: "stt",
        label: provider.name,
        baseUrl: provider.baseUrl,
        apiKey: provider.apiKey,
        source: provider.source,
        providerProfileId: provider.id,
        providerProfileName: provider.name,
        model: provider.model,
      })
    ),
  );
  const healthySttRoutes = sttRouteHealth.filter((route) =>
    route.status === "healthy"
  );
  const hasSttProfileRoutes = sttProviders.some((provider) =>
    provider.source === "transcription_profile"
  );
  const representativeStt = healthySttRoutes[0] ??
    sttRouteHealth.find((route) => route.status === "loading") ??
    sttRouteHealth[0] ?? await probeProvider({
      id: "stt",
      label: "Speech-to-text",
    });
  const sttService: ExternalServiceHealth = {
    ...representativeStt,
    label: enabledSttProviders.length > 1
      ? `Speech-to-text (${enabledSttProviders.length} routes)`
      : "Speech-to-text",
    status: allSttRoutesDisabled
      ? "disabled"
      : healthySttRoutes.length > 0
      ? "healthy"
      : representativeStt.status,
    configured: enabledSttProviders.length > 0,
    providerProfileId: undefined,
    providerProfileName: hasSttProfileRoutes
      ? `${healthySttRoutes.length}/${enabledSttProviders.length} healthy`
      : representativeStt.providerProfileName,
    models: [
      ...new Set(sttRouteHealth.flatMap((route) => route.models ?? [])),
    ],
    message: allSttRoutesDisabled
      ? "All STT routes are disabled for new transcription jobs; no health probe was sent."
      : enabledSttProviders.length > 0
      ? `${healthySttRoutes.length}/${enabledSttProviders.length} enabled STT routes healthy; ` +
        `${
          enabledSttProviders.reduce((sum, provider) =>
            sum + provider.concurrency, 0)
        } total slot(s)`
      : representativeStt.message,
    routes: hasSttProfileRoutes
      ? sttProviders.filter((provider) =>
        provider.source === "transcription_profile"
      ).map((provider) => {
        const route = sttRouteHealth.find((candidate) =>
          candidate.providerProfileId === provider.id
        );
        return {
          providerProfileId: provider.id,
          providerProfileName: provider.name,
          status: provider.enabled
            ? route?.status ?? "unavailable"
            : "disabled",
          enabled: provider.enabled,
          model: route?.models?.[0] || provider.model,
          priority: provider.priority,
          concurrency: provider.concurrency,
          latencyMs: route?.latencyMs,
          message: provider.enabled
            ? route?.message ?? "Provider health is unavailable"
            : "Disabled for new transcription jobs; no health probe was sent.",
        };
      })
      : undefined,
  };

  // Probe every enabled LLM route in parallel; the aggregate mirrors STT.
  // A route with requests in flight is alive by definition — single-slot
  // GPU servers stop answering /models mid-generation, so probing a busy
  // route would misreport it as down and block the very jobs feeding it.
  const enabledLlmProviders = getEnabledLlmProviders(llmProviders);
  const allLlmRoutesDisabled = llmProviders.length > 0 &&
    enabledLlmProviders.length === 0;
  const llmInFlight = getLlmProviderInFlight();
  const llmRouteHealth = await Promise.all(
    enabledLlmProviders.map((provider) => {
      const inFlight = llmInFlight[provider.id] ?? 0;
      if (inFlight > 0) {
        return Promise.resolve<ExternalServiceHealth>({
          id: "llm",
          label: provider.name,
          status: "healthy",
          configured: true,
          baseUrl: provider.baseUrl,
          source: provider.source,
          providerProfileId: provider.id,
          providerProfileName: provider.name,
          model: provider.aliases[provider.defaultAlias],
          message: `Busy: ${inFlight} request(s) in flight; probe skipped`,
          checkedAt: new Date().toISOString(),
          usedBy: [],
        });
      }
      return probeProvider({
        id: "llm",
        label: provider.name,
        baseUrl: provider.baseUrl,
        apiKey: provider.apiKey,
        source: provider.source,
        providerProfileId: provider.id,
        providerProfileName: provider.name,
        model: provider.aliases[provider.defaultAlias],
      });
    }),
  );
  const healthyLlmRoutes = llmRouteHealth.filter((route) =>
    route.status === "healthy"
  );
  const representativeLlm = healthyLlmRoutes[0] ??
    llmRouteHealth.find((route) => route.status === "loading") ??
    llmRouteHealth[0] ?? await probeProvider({
      id: "llm",
      label: "LLM inference",
    });
  const llmService: ExternalServiceHealth = {
    ...representativeLlm,
    label: enabledLlmProviders.length > 1
      ? `LLM inference (${enabledLlmProviders.length} routes)`
      : "LLM inference",
    status: allLlmRoutesDisabled
      ? "disabled"
      : healthyLlmRoutes.length > 0
      ? "healthy"
      : representativeLlm.status,
    configured: enabledLlmProviders.length > 0,
    providerProfileId: enabledLlmProviders.length > 1
      ? undefined
      : representativeLlm.providerProfileId,
    providerProfileName: enabledLlmProviders.length > 1
      ? `${healthyLlmRoutes.length}/${enabledLlmProviders.length} healthy`
      : representativeLlm.providerProfileName,
    models: [
      ...new Set(llmRouteHealth.flatMap((route) => route.models ?? [])),
    ],
    message: allLlmRoutesDisabled
      ? "All LLM routes are disabled; no health probe was sent."
      : enabledLlmProviders.length > 1
      ? `${healthyLlmRoutes.length}/${enabledLlmProviders.length} enabled LLM routes healthy`
      : representativeLlm.message,
    routes: llmProviders.length > 0
      ? llmProviders.map((provider) => {
        const route = llmRouteHealth.find((candidate) =>
          candidate.providerProfileId === provider.id
        );
        return {
          providerProfileId: provider.id,
          providerProfileName: provider.name,
          status: provider.enabled
            ? route?.status ?? "unavailable"
            : "disabled" as const,
          enabled: provider.enabled,
          model: route?.models?.find((model) =>
            model === provider.aliases[provider.defaultAlias]
          ) ?? provider.aliases[provider.defaultAlias] ?? route?.models?.[0],
          priority: provider.priority,
          concurrency: provider.concurrency,
          latencyMs: route?.latencyMs,
          message: provider.enabled
            ? route?.message ?? "Provider health is unavailable"
            : "Disabled for new LLM requests; no health probe was sent.",
        };
      })
      : undefined,
  };

  const diarizatorService = await probeDiarizator();

  const services = [sttService, llmService, diarizatorService];

  cached = { checkedAt: now, fingerprint, services };
  return services;
}

export async function assertJobServicesHealthy(
  workerType: string,
  force = false,
): Promise<void> {
  const dependencies = getJobServiceDependencies(workerType);
  if (dependencies.length === 0) return;

  const services = await getExternalServicesHealth(force);
  const blocked = services.find((service) =>
    dependencies.includes(service.id) && service.status !== "healthy"
  );
  if (!blocked) return;

  throw new Error(
    `Job blocked by ${blocked.label} health check: ${blocked.status}. ${blocked.message}`,
  );
}
