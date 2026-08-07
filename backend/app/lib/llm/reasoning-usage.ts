function readFiniteTokenCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

/**
 * Reasoning/thinking tokens billed for a completion, when the provider
 * reports them (OpenAI-style completion_tokens_details, or a flat field).
 * Used to analyze how much of the output budget reasoning consumed and to
 * verify that reasoning "off" actually took effect.
 */
export function getReasoningTokens(usage: unknown): number | undefined {
  if (!usage || typeof usage !== "object") return undefined;
  const value = usage as Record<string, unknown>;
  const details = value.completion_tokens_details as
    | Record<string, unknown>
    | undefined;

  return [
    details?.reasoning_tokens,
    value.reasoning_tokens,
  ].map(readFiniteTokenCount).find((candidate) => candidate !== undefined);
}
