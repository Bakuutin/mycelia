import { normalizeOpenAIBaseUrl } from "../llm/model-routing.ts";
import type {
  DetectedDiarizatorReadinessMode,
  DiarizatorReadinessMode,
} from "../diarization/provider-routing.ts";

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
  readinessMode?: DiarizatorReadinessMode;
  detectedReadinessMode?: DetectedDiarizatorReadinessMode;
  routes?: Array<{
    providerProfileId: string;
    providerProfileName: string;
    baseUrl?: string;
    status: ExternalServiceStatus;
    enabled: boolean;
    model?: string;
    priority: number;
    // Parallel-slot budget for routes with enqueue reservations (STT/diarization).
    concurrency?: number;
    readinessMode?: DiarizatorReadinessMode;
    detectedReadinessMode?: DetectedDiarizatorReadinessMode;
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

export function getDiarizatorReadyUrl(baseUrl: string): string {
  return `${baseUrl.trim().replace(/\/+$/, "")}/ready`;
}

export function getDiarizatorHealthUrl(baseUrl: string): string {
  return `${baseUrl.trim().replace(/\/+$/, "")}/health`;
}

export function shouldAutoFallbackToDiarizatorHealth(
  readinessMode: DiarizatorReadinessMode,
  readyStatus: number,
): boolean {
  return readinessMode === "auto" && [404, 405].includes(readyStatus);
}

export function classifyAutoLegacyDiarizatorHealth(
  status: number,
  body: string,
): { status: ExternalServiceStatus; message: string } {
  if (status < 200 || status >= 300) {
    return classifyServiceResponse(status, body);
  }
  try {
    const payload = JSON.parse(body) as Record<string, unknown>;
    const service = typeof payload.service === "string"
      ? payload.service.toLowerCase()
      : "";
    const reportedStatus = typeof payload.status === "string"
      ? payload.status.toLowerCase()
      : "";
    const device = typeof payload.device === "string"
      ? payload.device.trim()
      : "";
    if (
      payload.ready === true &&
      ["ok", "healthy"].includes(reportedStatus) &&
      service.includes("diar") &&
      device
    ) {
      return {
        status: "healthy",
        message:
          `Auto-detected legacy /health readiness on ${device}; route is limited to one slot`,
      };
    }
  } catch {
    // The manual Legacy mode remains available for older non-JSON services.
  }
  return {
    status: "unavailable",
    message:
      "The service has no /ready endpoint and /health did not prove model readiness; select Legacy mode to allow a manual liveness fallback",
  };
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
