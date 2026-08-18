import { useCallback, useState } from "react";
import { createDraftChatId } from "@/lib/chat";

export function useStableChatSessionId(routeChatId?: string) {
  const [draftChatId, setDraftChatId] = useState(createDraftChatId);
  const resetDraft = useCallback(() => setDraftChatId(createDraftChatId()), []);
  return {
    draftChatId,
    chatSessionId: routeChatId ?? draftChatId,
    resetDraft,
  };
}
