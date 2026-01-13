import { create } from "zustand";
import type { Chat, Message } from "@myceliasdk/messengers.ts";

interface MessengerState {
  chats: Chat[];
  messages: Message[];
  loadingChats: boolean;
  loadingMessages: boolean;
  hasMore: boolean;
  oldestMessageTimestamp: Date | null;
  selectedChatId: string | null;
  
  setChats: (chats: Chat[]) => void;
  setMessages: (messages: Message[]) => void;
  addMessages: (messages: Message[]) => void;
  setLoadingChats: (loading: boolean) => void;
  setLoadingMessages: (loading: boolean) => void;
  setHasMore: (hasMore: boolean) => void;
  setOldestMessageTimestamp: (timestamp: Date | null) => void;
  setSelectedChatId: (chatId: string | null) => void;
  resetMessages: () => void;
  reset: () => void;
}

const initialState = {
  chats: [],
  messages: [],
  loadingChats: false,
  loadingMessages: false,
  hasMore: false,
  oldestMessageTimestamp: null,
  selectedChatId: null,
};

export const useMessengerStore = create<MessengerState>((set) => ({
  ...initialState,

  setChats: (chats) => set({ chats }),

  setMessages: (messages) => set({ messages }),

  addMessages: (newMessages) =>
    set((state) => ({ messages: [...newMessages, ...state.messages] })),

  setLoadingChats: (loading) => set({ loadingChats: loading }),

  setLoadingMessages: (loading) => set({ loadingMessages: loading }),

  setHasMore: (hasMore) => set({ hasMore }),

  setOldestMessageTimestamp: (timestamp) =>
    set({ oldestMessageTimestamp: timestamp }),

  setSelectedChatId: (chatId) => set({ selectedChatId: chatId }),

  resetMessages: () =>
    set({
      messages: [],
      hasMore: false,
      oldestMessageTimestamp: null,
      loadingMessages: false,
    }),

  reset: () => set(initialState),
}));


