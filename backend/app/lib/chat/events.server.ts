import { publishEvent } from "@/lib/events/publisher.ts";
import type { ChatRunState } from "@myceliasdk/messengers.ts";

export type ChatEvent =
  | {
    event: "chat.updated";
    data: { chatId: string; reason: string; updatedAt: string };
  }
  | {
    event: "chat.run.changed";
    data: {
      chatId: string;
      runId: string;
      state: ChatRunState;
      updatedAt: string;
      error?: string;
    };
  };

export async function chatUserChannel(principal: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(principal),
  );
  const hash = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `chat:user:${hash}`;
}

export async function publishChatEvent(
  principal: string,
  payload: ChatEvent,
): Promise<void> {
  try {
    await publishEvent(
      await chatUserChannel(principal),
      payload.event,
      payload.data,
    );
  } catch (error) {
    // Canonical Mongo state must still commit when Redis notifications are
    // temporarily unavailable; clients resync after reconnect.
    console.warn("[chat-events] Failed to publish chat update", {
      principal,
      event: payload.event,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function publishChatUpdated(
  principal: string,
  chatId: string,
  reason: string,
): Promise<void> {
  await publishChatEvent(principal, {
    event: "chat.updated",
    data: { chatId, reason, updatedAt: new Date().toISOString() },
  });
}

export async function publishChatRunChanged(
  principal: string,
  chatId: string,
  runId: string,
  state: ChatRunState,
  error?: string,
): Promise<void> {
  await publishChatEvent(principal, {
    event: "chat.run.changed",
    data: {
      chatId,
      runId,
      state,
      updatedAt: new Date().toISOString(),
      ...(error ? { error } : {}),
    },
  });
}
