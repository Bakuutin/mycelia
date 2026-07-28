export interface InferenceModel {
  id?: unknown;
}

export function getModelsEndpoint(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  try {
    const url = new URL(trimmed);
    const path = url.pathname.replace(/\/+$/, "");
    url.pathname = path || "/v1";
    return `${url.toString().replace(/\/$/, "")}/models`;
  } catch {
    const normalized = /:\/\/[^/]+$/.test(trimmed) ? `${trimmed}/v1` : trimmed;
    return `${normalized}/models`;
  }
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
    // Google's OpenAI-compatible models endpoint returns resource names such
    // as `models/gemini-3.5-flash-lite`, while chat/completions accepts the
    // model id without the resource prefix.
    .map((id) => id.trim().replace(/^models\//, ""));

  return [...new Set(ids)].sort((a, b) => a.localeCompare(b));
}
