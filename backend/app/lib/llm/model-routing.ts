export interface ModelRoutingOptions {
  defaultModel?: string;
  baseModel?: string;
  smallModel?: string;
  mediumModel?: string;
  largeModel?: string;
}

const MODEL_ALIASES = new Set(["small", "medium", "large"]);

/**
 * Normalize an OpenAI-compatible API base URL.
 *
 * Providers such as Google expose compatibility below a non-v1 path
 * (`/v1beta/openai`). That path is already the API root and must not become
 * `/v1beta/openai/v1`. Bare origins retain the conventional `/v1` default.
 */
export function normalizeOpenAIBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");

  try {
    const url = new URL(trimmed);
    const path = url.pathname.replace(/\/+$/, "");
    if (!path) url.pathname = "/v1";
    else url.pathname = path;
    return url.toString().replace(/\/$/, "");
  } catch {
    return /:\/\/[^/]+$/.test(trimmed) ? `${trimmed}/v1` : trimmed;
  }
}

/**
 * Resolve legacy size aliases without overriding an explicitly selected model.
 * A configured global default is used whenever a caller still requests one of
 * the old small/medium/large aliases.
 */
export function resolveConfiguredModel(
  requestedModel: string,
  options: ModelRoutingOptions,
): string {
  const requested = requestedModel.trim();

  if (!MODEL_ALIASES.has(requested)) return requested;

  const aliasModel = requested === "small"
    ? options.smallModel
    : requested === "medium"
    ? options.mediumModel
    : options.largeModel;

  return options.baseModel || aliasModel || options.defaultModel || requested;
}

export function getConfiguredFallback(
  primaryModel: string,
  fallbackEnabled: boolean,
  fallbackModel?: string,
): string | null {
  const fallback = fallbackModel?.trim();
  if (!fallbackEnabled || !fallback || fallback === primaryModel) return null;
  return fallback;
}

/** Remove credentials and request-specific parts before persisting a route. */
export function sanitizeProviderBaseUrl(baseUrl: string): string {
  try {
    const url = new URL(baseUrl);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "openai-compatible";
  }
}
