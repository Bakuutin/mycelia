import type { UIMessage } from "ai";

type LegacyToolCallPart = {
  type: "tool-call";
  toolCallId: string;
  toolName: string;
  input?: unknown;
  providerExecuted?: boolean;
};

type LegacyToolResultPart = {
  type: "tool-result";
  toolCallId: string;
  toolName: string;
  output?: unknown;
  providerExecuted?: boolean;
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
};

type LegacyReasoningPart = {
  type: "reasoning";
  text: string;
};

type LegacyStepStartPart = { type: "step-start" };

type LegacyMessagePart =
  | LegacyTextPart
  | LegacyReasoningPart
  | LegacyToolCallPart
  | LegacyToolResultPart
  | LegacyToolApprovalRequestPart
  | LegacyToolApprovalResponsePart
  | LegacyStepStartPart
  | { type: string; [key: string]: unknown };

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
      typeof (part as LegacyToolResultPart).toolCallId === "string" &&
      typeof (part as LegacyToolResultPart).toolName === "string"
    ) {
      toolResultsById.set(
        (part as LegacyToolResultPart).toolCallId,
        part as LegacyToolResultPart,
      );
    } else if (
      part?.type === "tool-approval-request" &&
      typeof (part as LegacyToolApprovalRequestPart).toolCallId === "string" &&
      typeof (part as LegacyToolApprovalRequestPart).approvalId === "string"
    ) {
      approvalRequestsByToolCallId.set(
        (part as LegacyToolApprovalRequestPart).toolCallId,
        part as LegacyToolApprovalRequestPart,
      );
    } else if (
      part?.type === "tool-approval-response" &&
      typeof (part as LegacyToolApprovalResponsePart).approvalId === "string" &&
      typeof (part as LegacyToolApprovalResponsePart).approved === "boolean"
    ) {
      approvalResponsesById.set(
        (part as LegacyToolApprovalResponsePart).approvalId,
        part as LegacyToolApprovalResponsePart,
      );
    }
  }

  const uiParts: UIMessage["parts"] = [];

  for (const part of legacyParts) {
    if (!part || typeof part !== "object") continue;

    if (part.type === "text" && typeof (part as LegacyTextPart).text === "string") {
      uiParts.push({ type: "text", text: (part as LegacyTextPart).text });
      continue;
    }

    if (part.type === "reasoning" && typeof (part as LegacyReasoningPart).text === "string") {
      uiParts.push({ type: "reasoning", text: (part as LegacyReasoningPart).text });
      continue;
    }

    if (part.type === "step-start") {
      uiParts.push({ type: "step-start" });
      continue;
    }

    if (
      part.type !== "tool-call" ||
      typeof (part as LegacyToolCallPart).toolCallId !== "string" ||
      typeof (part as LegacyToolCallPart).toolName !== "string"
    ) {
      continue;
    }

    const toolCallPart = part as LegacyToolCallPart;
    const toolType = `tool-${toolCallPart.toolName}`;
    const result = toolResultsById.get(toolCallPart.toolCallId);
    const approvalRequest = approvalRequestsByToolCallId.get(toolCallPart.toolCallId);
    const approvalResponse = approvalRequest
      ? approvalResponsesById.get(approvalRequest.approvalId)
      : undefined;
    const errorText = result ? getToolErrorText(result.output) : undefined;

    if (result) {
      uiParts.push({
        type: toolType,
        toolCallId: toolCallPart.toolCallId,
        input: toolCallPart.input,
        output: errorText ? undefined : normalizeToolOutput(result.output),
        errorText,
        providerExecuted: toolCallPart.providerExecuted ?? result.providerExecuted,
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
        toolCallId: toolCallPart.toolCallId,
        input: toolCallPart.input,
        providerExecuted: toolCallPart.providerExecuted,
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
        toolCallId: toolCallPart.toolCallId,
        input: toolCallPart.input,
        providerExecuted: toolCallPart.providerExecuted,
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
        toolCallId: toolCallPart.toolCallId,
        input: toolCallPart.input,
        providerExecuted: toolCallPart.providerExecuted,
        state: "approval-requested",
        approval: {
          id: approvalRequest.approvalId,
        },
      } as UIMessage["parts"][number]);
      continue;
    }

    uiParts.push({
      type: toolType,
      toolCallId: toolCallPart.toolCallId,
      input: toolCallPart.input,
      providerExecuted: toolCallPart.providerExecuted,
      state: "input-available",
    } as UIMessage["parts"][number]);
  }

  return uiParts;
}

export function normalizeMessageParts(parts: unknown, content?: unknown): UIMessage["parts"] {
  const source = Array.isArray(parts) ? parts : content;

  if (typeof source === "string") {
    return source.length > 0 ? [{ type: "text", text: source }] : [];
  }

  if (!Array.isArray(source)) {
    return [];
  }

  const normalizedParts: UIMessage["parts"] = [];
  for (const part of source) {
    if (typeof part === "string") {
      normalizedParts.push({ type: "text", text: part });
      continue;
    }

    if (isUiMessagePart(part)) {
      normalizedParts.push(part as UIMessage["parts"][number]);
    }
  }

  return normalizedParts.length > 0 ? normalizedParts : legacyContentToUIParts(source);
}

export function extractTextFromUIParts(parts: readonly UIMessage["parts"][number][]) {
  return parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n\n");
}

export function toUIMessageFromStoredRecord(message: any) {
  const parts = normalizeMessageParts(message.raw?.parts, message.raw?.content ?? message.content);
  const role = message.raw?.role || message.role;
  const content = message.raw?.content ?? message.content;

  return {
    id: message._id.toString(),
    role,
    parts,
    content,
    createdAt: new Date(message.createdAt),
  };
}
