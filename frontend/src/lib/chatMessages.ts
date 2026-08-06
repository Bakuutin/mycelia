import type { UIMessage } from "ai";

/**
 * Converts a persisted chat message document (Mongo `messages` collection)
 * into an AI SDK UIMessage.
 *
 * New-format documents carry the full UIMessage in `raw.uiMessage` and are
 * used verbatim. Legacy documents store ModelMessage-style `raw.content`
 * (text / tool-call / tool-result / tool-error parts) and are converted, so
 * that everything `useChat` holds — and resubmits to the backend — is a valid
 * UIMessage that `validateUIMessages` accepts.
 */
export function dbMessageToUIMessage(msg: any): UIMessage & {
  createdAt?: Date;
} {
  const raw = msg.raw ?? {};
  const id = msg._id?.toString?.() ?? String(msg._id ?? crypto.randomUUID());
  const metadata = {
    requestedModel: raw.requestedModel,
    model: raw.model,
    requestId: raw.requestId,
    finishReason: raw.finishReason,
    error: raw.error,
  };

  if (raw.uiMessage && Array.isArray(raw.uiMessage.parts)) {
    return {
      ...raw.uiMessage,
      id,
      metadata: { ...(raw.uiMessage.metadata ?? {}), ...metadata },
      createdAt: msg.createdAt ? new Date(msg.createdAt) : undefined,
    };
  }

  return {
    id,
    role: raw.role === "user" ? "user" : "assistant",
    parts: legacyContentToParts(raw.content),
    metadata,
    createdAt: msg.createdAt ? new Date(msg.createdAt) : undefined,
  };
}

/** Converts legacy ModelMessage-style content into UIMessage parts. */
export function legacyContentToParts(content: unknown): UIMessage["parts"] {
  if (typeof content === "string") {
    return content ? [{ type: "text", text: content }] : [];
  }
  if (!Array.isArray(content)) {
    return [];
  }

  const parts: any[] = [];
  const toolPartsByCallId = new Map<string, any>();

  for (const part of content) {
    if (!part || typeof part !== "object") continue;

    switch (part.type) {
      case "text":
        if (part.text) {
          parts.push({ type: "text", text: part.text });
        }
        break;

      case "tool-call": {
        const toolPart = {
          type: `tool-${part.toolName}`,
          toolCallId: part.toolCallId,
          state: "input-available",
          input: part.input ?? {},
        };
        toolPartsByCallId.set(part.toolCallId, toolPart);
        parts.push(toolPart);
        break;
      }

      case "tool-result": {
        const toolPart = toolPartsByCallId.get(part.toolCallId);
        if (toolPart) {
          toolPart.state = "output-available";
          toolPart.output = part.output;
        }
        // Orphaned results (no matching call in this message) are dropped
        break;
      }

      case "tool-error": {
        const toolPart = toolPartsByCallId.get(part.toolCallId);
        if (toolPart) {
          toolPart.state = "output-error";
          toolPart.errorText = part.error?.errmsg || part.error?.message ||
            (part.error ? JSON.stringify(part.error) : "Tool execution failed");
        }
        break;
      }

      // step-start and other internal markers are not part of UIMessages
      default:
        break;
    }
  }

  return parts as UIMessage["parts"];
}
