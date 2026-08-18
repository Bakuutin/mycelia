import { useCallback, useEffect, useRef, useState } from "react";
import { callResource } from "@/lib/api";
import { useWebSocketSubscription } from "@/hooks/useWebSocket";
import type { MemoryChatSummary } from "@/lib/chat";

export function useChatSummaries(
  query: string,
  favoritesOnly: boolean,
) {
  const [items, setItems] = useState<MemoryChatSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string>();
  const [nextCursor, setNextCursor] = useState<string>();
  const requestVersion = useRef(0);

  const refresh = useCallback(async (showLoading = false) => {
    const version = ++requestVersion.current;
    if (showLoading) setLoading(true);
    try {
      const result = await callResource("chat", {
        action: "list",
        limit: 100,
        query: query.trim() || undefined,
        favoritesOnly,
      });
      if (version !== requestVersion.current) return;
      setItems(result.items ?? []);
      setNextCursor(result.nextCursor);
      setError(undefined);
    } catch (refreshError) {
      if (version !== requestVersion.current) return;
      setError(
        refreshError instanceof Error
          ? refreshError.message
          : "Could not load chats",
      );
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [favoritesOnly, query]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    const version = ++requestVersion.current;
    setLoadingMore(true);
    try {
      const result = await callResource("chat", {
        action: "list",
        cursor: nextCursor,
        limit: 100,
        query: query.trim() || undefined,
        favoritesOnly,
      });
      if (version !== requestVersion.current) return;
      setItems((current) => {
        const ids = new Set(current.map((chat) => chat._id.toString()));
        return [
          ...current,
          ...(result.items ?? []).filter((chat: MemoryChatSummary) =>
            !ids.has(chat._id.toString())
          ),
        ];
      });
      setNextCursor(result.nextCursor);
      setError(undefined);
    } catch (loadError) {
      if (version !== requestVersion.current) return;
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Could not load more chats",
      );
    } finally {
      if (version === requestVersion.current) setLoadingMore(false);
    }
  }, [favoritesOnly, loadingMore, nextCursor, query]);

  useEffect(() => {
    const timer = globalThis.setTimeout(() => void refresh(true), 150);
    return () => globalThis.clearTimeout(timer);
  }, [refresh]);

  useWebSocketSubscription("chat:self", (event) => {
    if (
      event?.event === "chat.updated" ||
      event?.event === "chat.run.changed" ||
      event?.event === "resync_required"
    ) {
      void refresh(false);
    }
  });

  const update = useCallback((
    chatId: string,
    updater:
      | Partial<MemoryChatSummary>
      | ((chat: MemoryChatSummary) => MemoryChatSummary),
  ) => {
    setItems((current) =>
      current.map((chat) => {
        if (chat._id.toString() !== chatId) return chat;
        return typeof updater === "function"
          ? updater(chat)
          : { ...chat, ...updater };
      })
    );
  }, []);

  return {
    items,
    setItems,
    loading,
    loadingMore,
    hasMore: Boolean(nextCursor),
    error,
    refresh,
    loadMore,
    update,
  };
}
