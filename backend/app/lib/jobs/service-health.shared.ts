import { normalizeOpenAIBaseUrl } from "../llm/model-routing.ts";

export type ExternalServiceId = "stt" | "llm" | "diarizator";
export type ExternalServiceStatus =
  | "disabled"
  | "healthy"
  | "loading"
  | "unavailable"
  | "misconfigured";

export interface ExternalServiceHealth {
  id: ExternalServiceId;
  label: string;
  status: ExternalServiceStatus;
  configured: boolean;
  baseUrl?: string;
  modelsUrl?: string;
  source?: string;
  providerProfileId?: string;
  providerProfileName?: string;
  model?: string;
  models?: string[];
  httpStatus?: number;
  latencyMs?: number;
  message: string;
  checkedAt: string;
  usedBy: string[];
  metadata?: Record<string, unknown>;
  routes?: Array<{
    providerProfileId: string;
    providerProfileName: string;
    baseUrl?: string;
    status: ExternalServiceStatus;
    enabled: boolean;
    model?: string;
    priority: number;
    // Parallel-slot budget; STT only. LLM routes have no slot reservation.
    concurrency?: number;
    latencyMs?: number;
    message: string;
  }>;
}

export const JOB_SERVICE_DEPENDENCIES: Record<string, ExternalServiceId[]> = {
  transcription: ["stt"],
  conversation_extractor_merged: ["llm"],
  summarization: ["llm"],
  tagger: ["llm"],
  entity_typing: ["llm"],
  // speakerMatching is pure numpy over stored embeddings — no diarizator needed.
  diarization: ["diarizator"],
  enrollment: ["diarizator"],
  profileReenrollment: ["diarizator"],
};

export function getJobServiceDependencies(
  workerType: string,
): ExternalServiceId[] {
  return JOB_SERVICE_DEPENDENCIES[workerType] ?? [];
}

export function getModelsUrl(baseUrl: string): string {
  return `${normalizeOpenAIBaseUrl(baseUrl)}/models`;
}

export function getProviderHealthUrl(baseUrl: string): string {
  return `${baseUrl.trim().replace(/\/+$/, "")}/health`;
}

export function shouldFallbackToSttHealth(
  serviceId: ExternalServiceId,
  modelsStatus: number,
): boolean {
  return serviceId === "stt" && [404, 405].includes(modelsStatus);
}

export function normalizeProviderModelId(model: string): string {
  return model.trim().replace(/^models\//, "");
}

export function classifyServiceResponse(
  status: number,
  body: string,
): { status: ExternalServiceStatus; message: string } {
  const compact = body.trim().replace(/\s+/g, " ").slice(0, 300);
  if (status >= 200 && status < 300) {
    return { status: "healthy", message: "Connection successful" };
  }
  if (status === 503 && /load(?:ing)?\s+(?:the\s+)?model/i.test(compact)) {
    return {
      status: "loading",
      message: compact || "The model is loading",
    };
  }
  return {
    status: "unavailable",
    message: compact || `Provider returned HTTP ${status}`,
  };
}
