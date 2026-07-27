export interface ModelRoutingOptions {
  defaultModel?: string;
  baseModel?: string;
  smallModel?: string;
  mediumModel?: string;
  largeModel?: string;
}

const MODEL_ALIASES = new Set(["small", "medium", "large"]);

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

  if (options.baseModel) return options.baseModel;
  if (!MODEL_ALIASES.has(requested)) return requested;

  const aliasModel = requested === "small"
    ? options.smallModel
    : requested === "medium"
    ? options.mediumModel
    : options.largeModel;

  return aliasModel || options.defaultModel || requested;
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
