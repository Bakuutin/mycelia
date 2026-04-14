import {
  convertToModelMessages,
  validateUIMessages,
  type ModelMessage,
  type ToolSet,
  type UIMessage,
} from "ai";

type LegacyToolCallPart = {
  type: "tool-call";
  toolCallId: string;
  toolName: string;
  input?: unknown;
  providerExecuted?: boolean;
  providerOptions?: Record<string, unknown>;
};

type LegacyToolResultPart = {
  type: "tool-result";
  toolCallId: string;
  toolName: string;
  output?: unknown;
  providerExecuted?: boolean;
  providerOptions?: Record<string, unknown>;
};

type LegacyToolApprovalRequestPart = {
  type: "tool-approval-request";
  approvalId: string;
  toolCallId: string;
};

type LegacyToolApprovalResponsePart = {
  type: "tool-approval-response";
  approvalId: string;
  approved: boolean;
  reason?: string;
};

type LegacyTextPart = {
  type: "text";
  text: string;
  providerOptions?: Record<string, unknown>;
};

type LegacyMessagePart =
  | LegacyToolApprovalRequestPart
  | LegacyToolApprovalResponsePart
  | LegacyToolCallPart
  | LegacyToolResultPart
  | LegacyTextPart
  | { type: "reasoning"; text: string; providerOptions?: Record<string, unknown> }
  | { type: "file"; mediaType: string; filename?: string; data?: string; url?: string }
  | { type: "step-start" }
  | { type: string; [key: string]: unknown };

function ensureMessageId(message: Record<string, unknown>) {
  return typeof message.id === "string" && message.id.length > 0
    ? message.id
    : crypto.randomUUID();
}

function normalizeToolOutput(output: unknown) {
  if (
    output &&
    typeof output === "object" &&
    "type" in output &&
    "value" in output
  ) {
    return (output as { value: unknown }).value;
  }

  return output;
}

function getToolErrorText(output: unknown) {
  if (
    output &&
    typeof output === "object" &&
    "type" in output &&
    "value" in output &&
    (output as { type: string }).type === "error-text"
  ) {
    return String((output as { value: unknown }).value ?? "Tool execution failed.");
  }

  return undefined;
}

function isUiToolPart(part: Record<string, unknown>) {
  return (
    typeof part.type === "string" &&
    (part.type.startsWith("tool-") || part.type === "dynamic-tool") &&
    typeof part.state === "string"
  );
}

function isUiMessagePart(part: unknown) {
  if (!part || typeof part !== "object") return false;
  const candidate = part as Record<string, unknown>;
  const type = candidate.type;

  if (typeof type !== "string") return false;
  if (type === "text" || type === "reasoning" || type === "file" || type === "step-start") {
    return true;
  }

  if (type.startsWith("data-")) {
    return true;
  }

  return isUiToolPart(candidate);
}

export function legacyContentToUIParts(content: unknown): UIMessage["parts"] {
  if (!Array.isArray(content)) {
    return [];
  }

  const legacyParts = content as LegacyMessagePart[];
  const toolResultsById = new Map<string, LegacyToolResultPart>();
  const approvalRequestsByToolCallId = new Map<string, LegacyToolApprovalRequestPart>();
  const approvalResponsesById = new Map<string, LegacyToolApprovalResponsePart>();

  for (const part of legacyParts) {
    if (
      part?.type === "tool-result" &&
      typeof part.toolCallId === "string" &&
      typeof part.toolName === "string"
    ) {
      toolResultsById.set(part.toolCallId, part as LegacyToolResultPart);
    } else if (
      part?.type === "tool-approval-request" &&
      typeof part.toolCallId === "string" &&
      typeof part.approvalId === "string"
    ) {
      approvalRequestsByToolCallId.set(
        part.toolCallId,
        part as LegacyToolApprovalRequestPart,
      );
    } else if (
      part?.type === "tool-approval-response" &&
      typeof part.approvalId === "string" &&
      typeof part.approved === "boolean"
    ) {
      approvalResponsesById.set(
        part.approvalId,
        part as LegacyToolApprovalResponsePart,
      );
    }
  }

  const uiParts: UIMessage["parts"] = [];

  for (const part of legacyParts) {
    if (!part || typeof part !== "object") continue;

    if (part.type === "text" && typeof part.text === "string") {
      uiParts.push({
        type: "text",
        text: part.text,
      });
      continue;
    }

    if (part.type === "reasoning" && typeof part.text === "string") {
      uiParts.push({
        type: "reasoning",
        text: part.text,
      });
      continue;
    }

    if (part.type === "step-start") {
      uiParts.push({ type: "step-start" });
      continue;
    }

    if (
      part.type === "file" &&
      typeof (part as { mediaType?: unknown }).mediaType === "string"
    ) {
      uiParts.push({
        type: "file",
        mediaType: (part as { mediaType: string }).mediaType,
        filename: typeof (part as { filename?: unknown }).filename === "string"
          ? (part as { filename?: string }).filename
          : undefined,
        url: String(
          (part as { url?: unknown; data?: unknown }).url ??
            (part as { url?: unknown; data?: unknown }).data ??
            "",
        ),
      });
      continue;
    }

    if (
      part.type !== "tool-call" ||
      typeof part.toolCallId !== "string" ||
      typeof part.toolName !== "string"
    ) {
      continue;
    }

    const toolType = `tool-${part.toolName}`;
    const result = toolResultsById.get(part.toolCallId);
    const approvalRequest = approvalRequestsByToolCallId.get(part.toolCallId);
    const approvalResponse = approvalRequest
      ? approvalResponsesById.get(approvalRequest.approvalId)
      : undefined;
    const errorText = result ? getToolErrorText(result.output) : undefined;

    if (result) {
      uiParts.push({
        type: toolType,
        toolCallId: part.toolCallId,
        input: part.input,
        output: errorText ? undefined : normalizeToolOutput(result.output),
        errorText,
        providerExecuted: part.providerExecuted ?? result.providerExecuted,
        state: errorText ? "output-error" : "output-available",
        ...(approvalRequest
          ? {
            approval: {
              id: approvalRequest.approvalId,
              approved: approvalResponse?.approved ?? true,
              ...(approvalResponse?.reason
                ? { reason: approvalResponse.reason }
                : {}),
            },
          }
          : {}),
      } as UIMessage["parts"][number]);
      continue;
    }

    if (approvalRequest && approvalResponse?.approved === false) {
      uiParts.push({
        type: toolType,
        toolCallId: part.toolCallId,
        input: part.input,
        providerExecuted: part.providerExecuted,
        state: "output-denied",
        approval: {
          id: approvalRequest.approvalId,
          approved: false,
          ...(approvalResponse.reason ? { reason: approvalResponse.reason } : {}),
        },
      } as UIMessage["parts"][number]);
      continue;
    }

    if (approvalRequest && approvalResponse) {
      uiParts.push({
        type: toolType,
        toolCallId: part.toolCallId,
        input: part.input,
        providerExecuted: part.providerExecuted,
        state: "approval-responded",
        approval: {
          id: approvalRequest.approvalId,
          approved: approvalResponse.approved,
          ...(approvalResponse.reason ? { reason: approvalResponse.reason } : {}),
        },
      } as UIMessage["parts"][number]);
      continue;
    }

    if (approvalRequest) {
      uiParts.push({
        type: toolType,
        toolCallId: part.toolCallId,
        input: part.input,
        providerExecuted: part.providerExecuted,
        state: "approval-requested",
        approval: {
          id: approvalRequest.approvalId,
        },
      } as UIMessage["parts"][number]);
      continue;
    }

    uiParts.push({
      type: toolType,
      toolCallId: part.toolCallId,
      input: part.input,
      providerExecuted: part.providerExecuted,
      state: "input-available",
    } as UIMessage["parts"][number]);
  }

  return uiParts;
}

export function compatibleContentToUIParts(content: unknown): UIMessage["parts"] {
  if (typeof content === "string") {
    return content.length > 0 ? [{ type: "text", text: content }] : [];
  }

  if (!Array.isArray(content)) {
    return [];
  }

  const normalizedParts: UIMessage["parts"] = [];
  for (const part of content) {
    if (typeof part === "string") {
      normalizedParts.push({ type: "text", text: part });
      continue;
    }

    if (isUiMessagePart(part)) {
      normalizedParts.push(part as UIMessage["parts"][number]);
    }
  }

  return normalizedParts.length > 0 ? normalizedParts : legacyContentToUIParts(content);
}

export function normalizeIncomingChatMessages(messages: unknown): UIMessage[] {
  if (!Array.isArray(messages)) {
    return [];
  }

  return messages
    .filter((message) => message && typeof message === "object")
    .map((message) => {
      const candidate = message as Record<string, unknown>;
      const role = candidate.role;
      if (role !== "system" && role !== "user" && role !== "assistant") {
        throw new Error(`Unsupported chat message role: ${String(role)}`);
      }

      const rawParts = Array.isArray(candidate.parts)
        ? compatibleContentToUIParts(candidate.parts)
        : compatibleContentToUIParts(candidate.content);

      return {
        id: ensureMessageId(candidate),
        role,
        ...(candidate.metadata !== undefined ? { metadata: candidate.metadata } : {}),
        parts: rawParts.length > 0 ? rawParts : [{ type: "text", text: "" }],
      } as UIMessage;
    });
}

export async function convertIncomingChatMessagesToModelMessages(
  messages: unknown,
  tools: ToolSet,
) {
  const normalizedMessages = normalizeIncomingChatMessages(messages);
  const validatedMessages = await validateUIMessages({
    messages: normalizedMessages,
    tools: tools as any,
  });

  return {
    uiMessages: validatedMessages,
    modelMessages: await convertToModelMessages(validatedMessages, { tools: tools as any }),
  } satisfies {
    uiMessages: UIMessage[];
    modelMessages: ModelMessage[];
  };
}

export function extractTextFromUIParts(parts: readonly UIMessage["parts"][number][]) {
  return parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n\n");
}
