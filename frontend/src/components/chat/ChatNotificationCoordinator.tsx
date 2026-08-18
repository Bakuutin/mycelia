import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { callResource } from "@/lib/api";
import { useWebSocketSubscription } from "@/hooks/useWebSocket";
import {
  type NotificationType,
  selectUnreadCount,
  useNotificationStore,
} from "@/stores/notificationStore";
import { type ChatRunEvent, shouldNotifyForChatEvent } from "@/lib/chat";

const BASE_TITLE = "Mycelia";

function eventPresentation(state: ChatRunEvent["state"]): {
  type: NotificationType;
  title: string;
  description: string;
} {
  if (state === "completed") {
    return {
      type: "success",
      title: "Chat response ready",
      description: "Mycelia finished answering.",
    };
  }
  if (state === "needs_approval") {
    return {
      type: "warning",
      title: "Chat needs approval",
      description: "A tool action is waiting for your confirmation.",
    };
  }
  if (state === "interrupted") {
    return {
      type: "warning",
      title: "Chat response interrupted",
      description: "The response stopped before completion.",
    };
  }
  return {
    type: "error",
    title: "Chat response failed",
    description: "Open the chat to review the error and retry.",
  };
}

export function ChatNotificationCoordinator() {
  const location = useLocation();
  const navigate = useNavigate();
  const addNotification = useNotificationStore((state) =>
    state.addNotification
  );
  const showPopups = useNotificationStore((state) => state.showPopups);
  const browserNotificationsEnabled = useNotificationStore(
    (state) => state.browserNotificationsEnabled,
  );
  const unreadCount = useNotificationStore(selectUnreadCount);
  const activeChatId = location.pathname.match(/^\/chat\/([a-f0-9]{24})$/i)
    ?.[1];

  useEffect(() => {
    document.title = unreadCount > 0
      ? `(${unreadCount}) ${BASE_TITLE}`
      : BASE_TITLE;
    return () => {
      document.title = BASE_TITLE;
    };
  }, [unreadCount]);

  useWebSocketSubscription("chat:self", (event) => {
    if (event?.event !== "chat.run.changed") return;
    const data = event.data as ChatRunEvent;
    const hidden = document.visibilityState === "hidden";
    const shouldNotify = shouldNotifyForChatEvent({
      state: data.state,
      eventChatId: data.chatId,
      activeChatId,
      documentHidden: hidden,
    });

    if (!shouldNotify) {
      if (
        data.chatId === activeChatId &&
        ["completed", "failed", "needs_approval", "interrupted"].includes(
          data.state,
        )
      ) {
        void callResource("chat", { action: "markRead", chatId: data.chatId });
      }
      return;
    }

    const dedupeKey = `chat:${data.runId}:${data.state}`;
    if (
      useNotificationStore.getState().notifications.some((item) =>
        item.dedupeKey === dedupeKey
      )
    ) return;

    const presentation = eventPresentation(data.state);
    const path = `/chat/${data.chatId}`;
    addNotification({
      ...presentation,
      dedupeKey,
      action: { label: "Open chat", path },
    });

    if (!hidden && showPopups) {
      const toastFn = presentation.type === "error"
        ? toast.error
        : presentation.type === "warning"
        ? toast.warning
        : toast.success;
      toastFn(presentation.title, {
        description: presentation.description,
        action: { label: "Open", onClick: () => navigate(path) },
        duration: 10_000,
      });
    }

    if (
      hidden && browserNotificationsEnabled &&
      "Notification" in window && Notification.permission === "granted"
    ) {
      const notification = new Notification(presentation.title, {
        body: presentation.description,
        tag: dedupeKey,
      });
      notification.onclick = () => {
        window.focus();
        navigate(path);
        notification.close();
      };
    }
  });

  return null;
}
