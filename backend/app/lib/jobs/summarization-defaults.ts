import type { JobData } from "./types.ts";

export interface ConfiguredSummarizationPrompt {
  id?: string;
  name: string;
  text: string;
}

export interface SummarizationDefaults {
  prompt?: ConfiguredSummarizationPrompt;
  defaultModel?: string;
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Merge summarization defaults while preserving explicit job input.
 *
 * Priority:
 * 1. Explicit job data
 * 2. Configured default prompt text/name (prompt selection only)
 * 3. Summarization worker overrides (including the summary model route)
 * 4. Active inference preset default
 * 5. Worker schema defaults (applied later by validation)
 */
export function applySummarizationDefaults(
  data: JobData,
  workerDefaults: Record<string, unknown> | undefined,
  configured: SummarizationDefaults,
): JobData {
  const merged: JobData = { ...data };
  const usesConfiguredPrompt = !hasText(merged.prompt);

  if (usesConfiguredPrompt && configured.prompt) {
    merged.prompt = configured.prompt.text;
    if (!hasText(merged.promptName)) {
      merged.promptName = configured.prompt.name;
    }
  }

  if (workerDefaults) {
    for (const [key, value] of Object.entries(workerDefaults)) {
      if (!(key in merged) || merged[key] === undefined) {
        merged[key] = value;
      }
    }
  }

  if (!hasText(merged.model) && hasText(configured.defaultModel)) {
    merged.model = configured.defaultModel;
  }

  return merged;
}
