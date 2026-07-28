import { LLMResource } from "@/lib/llm/resource.server.ts";
import { TranscriptionResource } from "@/lib/transcription/resource.server.ts";
import {
  classifyServiceResponse,
  type ExternalServiceHealth,
  type ExternalServiceId,
  getJobServiceDependencies,
  getModelsUrl,
  JOB_SERVICE_DEPENDENCIES,
  normalizeProviderModelId,
} from "./service-health.shared.ts";
export * from "./service-health.shared.ts";

const CACHE_MS = 15_000;
let cached: { checkedAt: number; services: ExternalServiceHealth[] } | null =
  null;

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
    const body = await response.text();
    const models = response.ok ? extractModels(body) : [];
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
      : classifyServiceResponse(response.status, body);
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
      httpStatus: response.status,
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

export async function getExternalServicesHealth(
  force = false,
): Promise<ExternalServiceHealth[]> {
  const now = Date.now();
  if (!force && cached && now - cached.checkedAt < CACHE_MS) {
    return cached.services;
  }

  const transcriptionResource = new TranscriptionResource();
  const llmResource = new LLMResource();
  const [sttProvider, llmProvider] = await Promise.all([
    transcriptionResource.getInferenceProvider().catch(() => null),
    llmResource.getInferenceProvider().catch(() => null),
  ]);

  const services = await Promise.all([
    probeProvider({
      id: "stt",
      label: "Speech-to-text",
      baseUrl: sttProvider?.baseUrl,
      apiKey: sttProvider?.apiKey,
      source: sttProvider?.source,
      model: sttProvider?.model,
    }),
    probeProvider({
      id: "llm",
      label: "LLM inference",
      baseUrl: llmProvider?.baseUrl,
      apiKey: llmProvider?.apiKey,
      source: Deno.env.get("OPENAI_BASE_URL") ? "llm_env" : "server_config",
      providerProfileId: llmProvider?.profileId,
      providerProfileName: llmProvider?.profileName,
      model: llmProvider?.model,
    }),
  ]);

  cached = { checkedAt: now, services };
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
