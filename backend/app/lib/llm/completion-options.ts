export interface CompletionReasoningOptions {
  reasoning_budget?: number;
  chat_template_kwargs?: Record<string, unknown>;
}

/**
 * Local Qwen GGUF models may spend the whole completion budget on hidden
 * reasoning. Summaries and titles need visible output, so disable thinking for
 * those models using the llama.cpp OpenAI-compatible request options.
 */
export function getSummaryCompletionOptions(
  modelName: string,
): CompletionReasoningOptions {
  const normalized = modelName.trim().toLowerCase();
  if (normalized.includes("qwen") && normalized.endsWith(".gguf")) {
    return {
      reasoning_budget: 0,
      chat_template_kwargs: { enable_thinking: false },
    };
  }

  return {};
}
