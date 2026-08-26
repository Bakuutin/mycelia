import type { JobInfo } from "@/types/jobs";

export const DIARIZATION_JOB_TYPES = new Set([
  "diarization",
  "enrollment",
  "profileReenrollment",
]);

export function getDiarizationJobRoute(
  job: JobInfo,
): {
  id?: string;
  name: string;
  url?: string;
  modelId?: string;
  modelVersion?: string;
  embeddingSpaceId?: string;
  runtimeProvenanceSource?: string;
} | null {
  if (!DIARIZATION_JOB_TYPES.has(job.type)) return null;
  const url = typeof job.data?.diarizationServerUrl === "string"
    ? job.data.diarizationServerUrl
    : undefined;
  const routingContext = {
    ...(job.data?.routingContext ?? {}),
    ...(job.routingContext ?? {}),
  };
  const id = routingContext?.providerProfileId;
  const hasRuntime = Boolean(
    routingContext?.modelId || routingContext?.modelVersion ||
      routingContext?.embeddingSpaceId,
  );
  const name = routingContext?.providerProfileName ||
    id ||
    (url || hasRuntime ? "Diarizator" : undefined);
  return name
    ? {
      ...(id ? { id } : {}),
      name,
      url,
      ...(routingContext?.modelId ? { modelId: routingContext.modelId } : {}),
      ...(routingContext?.modelVersion
        ? { modelVersion: routingContext.modelVersion }
        : {}),
      ...(routingContext?.embeddingSpaceId
        ? { embeddingSpaceId: routingContext.embeddingSpaceId }
        : {}),
      ...(routingContext?.runtimeProvenanceSource
        ? { runtimeProvenanceSource: routingContext.runtimeProvenanceSource }
        : {}),
    }
    : null;
}
