import type { MediaRecognitionProfile } from "@myceliasdk/media.ts";

type GoogleProfile = Extract<
  MediaRecognitionProfile,
  { providerType: "google-cloud" }
>;

export const GCP_PROJECT_ID_PATTERN = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
export const DOCUMENT_AI_PROCESSOR_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;

export function assertGcpProjectId(projectId: string): string {
  if (!GCP_PROJECT_ID_PATTERN.test(projectId)) {
    throw new Error("Invalid Google Cloud project ID");
  }
  return projectId;
}

export function assertDocumentAiProcessorId(processorId: string): string {
  if (!DOCUMENT_AI_PROCESSOR_ID_PATTERN.test(processorId)) {
    throw new Error("Invalid Document AI processor ID");
  }
  return processorId;
}

export function googleVertexModelUrl(
  projectId: string,
  modelId: string,
  method: "generateContent" | "predict",
): string {
  const project = assertGcpProjectId(projectId);
  return `https://aiplatform.eu.rep.googleapis.com/v1/projects/${project}/locations/eu/publishers/google/models/${
    encodeURIComponent(modelId)
  }:${method}`;
}

export function googleVisionEuAnnotateUrl(projectId: string): string {
  const project = assertGcpProjectId(projectId);
  return `https://eu-vision.googleapis.com/v1/projects/${project}/locations/eu/images:annotate`;
}

export function googleDocumentAiProcessUrl(profile: GoogleProfile): string {
  const project = assertGcpProjectId(profile.projectId);
  const processor = assertDocumentAiProcessorId(
    profile.documentAiProcessorId ?? "",
  );
  return `https://eu-documentai.googleapis.com/v1/projects/${project}/locations/eu/processors/${processor}/processorVersions/${
    encodeURIComponent(profile.documentAiProcessorVersion)
  }:process`;
}
