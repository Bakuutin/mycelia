import type { Message } from "@myceliasdk/messengers.ts";

const OBJECT_ID_PATTERN = /^[a-f\d]{24}$/i;
const MAX_MESSAGE_ID_LENGTH = 500;

function hasUnsafeMessageIdCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 32 || code === 127;
  });
}

type ResourceCaller = (
  resource: string,
  input: Record<string, unknown>,
) => Promise<unknown>;

export type MessageSurface = "chat" | "messenger";

export interface FoundMessengerMessageWindow {
  state: "found";
  messages: Message[];
  hasMoreOlder: boolean;
  oldestTimestamp: Date | null;
}

export type MessengerMessageWindow = FoundMessengerMessageWindow | {
  state: "unavailable";
  reason: "invalid_id" | "not_found";
};

export function normalizeMessageDeepLinkId(
  value: string | null | undefined,
): string | undefined {
  if (
    !value || !value.trim() || value.length > MAX_MESSAGE_ID_LENGTH ||
    hasUnsafeMessageIdCharacter(value)
  ) return undefined;
  return OBJECT_ID_PATTERN.test(value) ? value.toLowerCase() : value;
}

export function mongoDeepLinkIdReference(
  value: string | null | undefined,
): string | { $oid: string } | undefined {
  const normalized = normalizeMessageDeepLinkId(value);
  if (!normalized) return undefined;
  return OBJECT_ID_PATTERN.test(normalized) ? { $oid: normalized } : normalized;
}

export function messageElementId(
  surface: MessageSurface,
  messageId: string,
): string {
  return `${surface}-message-${messageId}`;
}

export function focusDeepLinkedMessage(
  surface: MessageSurface,
  messageId: string,
  root: Pick<Document, "getElementById"> = document,
): boolean {
  const element = root.getElementById(messageElementId(surface, messageId));
  if (!element) return false;
  const reducedMotion = typeof globalThis.matchMedia === "function" &&
    globalThis.matchMedia("(prefers-reduced-motion: reduce)").matches;
  element.scrollIntoView({
    behavior: reducedMotion ? "auto" : "smooth",
    block: "center",
  });
  element.focus({ preventScroll: true });
  return true;
}

function messageId(message: Message): string {
  return message._id.toString();
}

function timestampMs(message: Message): number {
  const value = new Date(message.timestamp).getTime();
  return Number.isFinite(value) ? value : 0;
}

function uniqueNewestFirst(messages: Message[]): Message[] {
  const byId = new Map<string, Message>();
  for (const message of messages) byId.set(messageId(message), message);
  return [...byId.values()].sort((left, right) =>
    timestampMs(right) - timestampMs(left) ||
    messageId(right).localeCompare(messageId(left))
  );
}

/**
 * Load a bounded context around one canonical message. The exact message is
 * constrained to the selected chat before any neighboring rows are fetched.
 */
export async function loadMessengerMessageWindow(
  callResource: ResourceCaller,
  input: { chatId: string; messageId: string; pageSize?: number },
): Promise<MessengerMessageWindow> {
  const chatReference = mongoDeepLinkIdReference(input.chatId);
  const targetId = normalizeMessageDeepLinkId(input.messageId);
  const messageReference = mongoDeepLinkIdReference(targetId);
  if (!chatReference || !targetId || !messageReference) {
    return { state: "unavailable", reason: "invalid_id" };
  }

  const target = await callResource("mongo", {
    action: "findOne",
    collection: "messages",
    query: {
      _id: messageReference,
      chatId: chatReference,
    },
  }) as Message | null;
  if (!target) return { state: "unavailable", reason: "not_found" };

  const targetTimestamp = new Date(target.timestamp);
  if (!Number.isFinite(targetTimestamp.getTime())) {
    return {
      state: "found",
      messages: [target],
      hasMoreOlder: false,
      oldestTimestamp: null,
    };
  }

  const pageSize = Math.min(
    100,
    Math.max(3, Math.floor(input.pageSize ?? 50)),
  );
  const newerLimit = Math.floor((pageSize - 1) / 2);
  const olderLimit = pageSize - 1 - newerLimit;
  const [newerRaw, olderRaw] = await Promise.all([
    callResource("mongo", {
      action: "find",
      collection: "messages",
      query: {
        chatId: chatReference,
        timestamp: { $gt: targetTimestamp },
      },
      options: {
        sort: { timestamp: 1, _id: 1 },
        limit: newerLimit,
      },
    }),
    callResource("mongo", {
      action: "find",
      collection: "messages",
      query: {
        chatId: chatReference,
        timestamp: { $lt: targetTimestamp },
      },
      options: {
        sort: { timestamp: -1, _id: -1 },
        limit: olderLimit + 1,
      },
    }),
  ]);
  const newer = Array.isArray(newerRaw) ? newerRaw as Message[] : [];
  const older = Array.isArray(olderRaw) ? olderRaw as Message[] : [];
  const messages = uniqueNewestFirst([
    target,
    ...newer.slice(0, newerLimit),
    ...older.slice(0, olderLimit),
  ]);
  const oldest = messages.at(-1);

  return {
    state: "found",
    messages,
    hasMoreOlder: older.length > olderLimit,
    oldestTimestamp: oldest ? new Date(oldest.timestamp) : null,
  };
}
