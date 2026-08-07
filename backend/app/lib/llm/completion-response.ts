export const LLM_INVALID_RESPONSE_CODE = "LLM_INVALID_RESPONSE";
export const LLM_EMPTY_RESPONSE_CODE = "LLM_EMPTY_RESPONSE";
export const LLM_TRUNCATED_RESPONSE_CODE = "LLM_TRUNCATED_RESPONSE";

export interface CompletionResponseContext {
  requestedModel: string;
  resolvedModel?: string;
  purpose?: string;
}

function describeResponseShape(response: unknown): string {
  if (!response || typeof response !== "object") {
    return response === null ? "null" : typeof response;
  }

  const record = response as Record<string, unknown>;
  const responseKeys = Object.keys(record).slice(0, 12).join(", ") || "none";
  const choices = Array.isArray(record.choices) ? record.choices : [];
  const firstChoice = choices[0];
  const choiceKeys = firstChoice && typeof firstChoice === "object"
    ? Object.keys(firstChoice as Record<string, unknown>).slice(0, 12).join(
      ", ",
    )
    : "none";
  const finishReason = firstChoice && typeof firstChoice === "object"
    ? (firstChoice as Record<string, unknown>).finish_reason
    : undefined;
  const finishReasonDescription = finishReason === undefined
    ? ""
    : `; finish_reason: ${JSON.stringify(finishReason)}`;
  const usage = record.usage && typeof record.usage === "object"
    ? record.usage as Record<string, unknown>
    : undefined;
  const usageDescription = usage
    ? `; prompt_tokens: ${JSON.stringify(usage.prompt_tokens)}; completion_tokens: ${JSON.stringify(usage.completion_tokens)}`
    : "";

  return `response keys: ${responseKeys}; first choice keys: ${choiceKeys}${finishReasonDescription}${usageDescription}`;
}

function getContextDescription(context: CompletionResponseContext): string {
  const resolved = context.resolvedModel &&
      context.resolvedModel !== context.requestedModel
    ? `, resolved to "${context.resolvedModel}"`
    : "";
  const purpose = context.purpose ? ` for ${context.purpose}` : "";
  return `requested model "${context.requestedModel}"${resolved}${purpose}`;
}

/**
 * Normalize the common legacy `choices[0].text` shape and reject successful
 * HTTP responses that do not satisfy the OpenAI chat-completions contract.
 */
export function normalizeChatCompletionResponse<T>(
  response: T,
  context: CompletionResponseContext,
): T {
  const record = response as Record<string, unknown> | null;
  const choices = Array.isArray(record?.choices) ? record.choices : [];
  const firstChoice = choices[0] as Record<string, unknown> | undefined;

  if (!firstChoice) {
    throw new Error(
      `${LLM_INVALID_RESPONSE_CODE}: Provider returned HTTP 200 without a completion choice (${
        getContextDescription(context)
      }; ${
        describeResponseShape(response)
      }). Verify that the configured endpoint and model support OpenAI-compatible chat completions.`,
    );
  }

  if (
    firstChoice.message && typeof firstChoice.message === "object"
  ) {
    return response;
  }

  if (typeof firstChoice.text === "string") {
    firstChoice.message = {
      role: "assistant",
      content: firstChoice.text,
    };
    return response;
  }

  throw new Error(
    `${LLM_INVALID_RESPONSE_CODE}: Provider returned HTTP 200, but choices[0].message was missing (${
      getContextDescription(context)
    }; ${
      describeResponseShape(response)
    }). Verify that the configured endpoint and model support OpenAI-compatible chat completions.`,
  );
}

/**
 * Fail loudly when the provider stopped generating because the output-token
 * budget ran out. A truncated response is a configuration error (the worker's
 * maxTokens is too small for this prompt), and for structured calls the
 * truncated JSON would otherwise surface as a confusing parse failure.
 */
export function assertCompletionNotTruncated(
  response: unknown,
  context: CompletionResponseContext & { maxTokens?: number },
): void {
  const record = response as Record<string, unknown> | null;
  const choices = Array.isArray(record?.choices) ? record.choices : [];
  const firstChoice = choices[0] as Record<string, unknown> | undefined;
  if (!firstChoice || firstChoice.finish_reason !== "length") return;

  const usage = record?.usage && typeof record.usage === "object"
    ? record.usage as Record<string, unknown>
    : undefined;
  const outputTokens = typeof usage?.completion_tokens === "number"
    ? usage.completion_tokens
    : undefined;

  throw new Error(
    `${LLM_TRUNCATED_RESPONSE_CODE}: finish_reason "length"${
      outputTokens != null ? ` after ${outputTokens} output tokens` : ""
    } (max_tokens=${context.maxTokens ?? "unset"}; ${
      getContextDescription(context)
    }). Raise the worker's maxTokens setting or shorten the prompt.`,
  );
}

export function getChatCompletionText(
  response: unknown,
  context: CompletionResponseContext & { maxTokens?: number },
): string {
  normalizeChatCompletionResponse(response, context);
  // An empty-but-truncated response must report truncation, not emptiness.
  assertCompletionNotTruncated(response, context);

  const content = (response as {
    choices: Array<{ message: { content?: unknown } }>;
  }).choices[0].message.content;

  if (typeof content === "string" && content.trim()) {
    return content;
  }

  if (Array.isArray(content)) {
    const text = content
      .filter((part) =>
        part && typeof part === "object" &&
        (part as Record<string, unknown>).type === "text" &&
        typeof (part as Record<string, unknown>).text === "string"
      )
      .map((part) => (part as { text: string }).text)
      .join("");
    if (text.trim()) return text;
  }

  throw new Error(
    `${LLM_EMPTY_RESPONSE_CODE}: Provider returned a completion without assistant text (${
      getContextDescription(context)
    }; ${
      describeResponseShape(response)
    }). The model may have been blocked, exhausted its output budget, or returned only unsupported content.`,
  );
}
