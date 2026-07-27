export interface InferenceModel {
  id?: unknown;
}

export function getModelsEndpoint(baseUrl: string): string {
  let normalized = baseUrl.trim().replace(/\/+$/, "");
  if (!normalized.endsWith("/v1")) {
    normalized = `${normalized}/v1`;
  }
  return `${normalized}/models`;
}

export function extractModelIds(models: unknown): string[] {
  if (!Array.isArray(models)) return [];

  const ids = models
    .map((model) => {
      if (typeof model === "string") return model;
      if (
        model && typeof model === "object" && "id" in model &&
        typeof (model as InferenceModel).id === "string"
      ) {
        return (model as InferenceModel).id as string;
      }
      return null;
    })
    .filter((id): id is string => Boolean(id?.trim()))
    .map((id) => id.trim());

  return [...new Set(ids)].sort((a, b) => a.localeCompare(b));
}
