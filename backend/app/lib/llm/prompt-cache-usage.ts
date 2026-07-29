export type PromptCacheUsage = {
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
};

function readFiniteTokenCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

/** Normalise cache token fields returned by OpenRouter-compatible providers. */
export function getPromptCacheUsage(usage: unknown): PromptCacheUsage {
  if (!usage || typeof usage !== "object") return {};
  const value = usage as Record<string, unknown>;
  const details = value.prompt_tokens_details as
    | Record<string, unknown>
    | undefined;

  const cacheReadTokens = [
    value.cached_tokens,
    value.cache_read_tokens,
    value.cache_read_input_tokens,
    details?.cached_tokens,
    details?.cache_read_tokens,
  ].map(readFiniteTokenCount).find((candidate) => candidate !== undefined);
  const cacheWriteTokens = [
    value.cache_write_tokens,
    value.cache_write_input_tokens,
    details?.cache_write_tokens,
  ].map(readFiniteTokenCount).find((candidate) => candidate !== undefined);

  return {
    ...(cacheReadTokens === undefined ? {} : { cacheReadTokens }),
    ...(cacheWriteTokens === undefined ? {} : { cacheWriteTokens }),
  };
}
