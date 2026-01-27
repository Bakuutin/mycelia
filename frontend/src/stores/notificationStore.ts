import { create } from "zustand";
import { persist } from "zustand/middleware";

export type NotificationType = "success" | "error" | "info" | "warning";

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  description?: string;
  timestamp: number;
  read: boolean;
  action?: {
    label: string;
    path: string;
  };
}

interface NotificationState {
  notifications: Notification[];
  showPopups: boolean;
  hideEmptyJobs: boolean;
  maxNotifications: number;
}

interface NotificationActions {
  addNotification: (notification: Omit<Notification, "id" | "timestamp" | "read">) => void;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  removeNotification: (id: string) => void;
  clearAll: () => void;
  setShowPopups: (show: boolean) => void;
  setHideEmptyJobs: (hide: boolean) => void;
}

type NotificationStore = NotificationState & NotificationActions;

const initialState: NotificationState = {
  notifications: [],
  showPopups: true,
  hideEmptyJobs: true,
  maxNotifications: 100,
};

export const useNotificationStore = create<NotificationStore>()(
  persist(
    (set, get) => ({
      ...initialState,

      addNotification: (notification) => {
        const { notifications, maxNotifications } = get();
        const newNotification: Notification = {
          ...notification,
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          timestamp: Date.now(),
          read: false,
        };

        // Keep only the most recent notifications
        const updated = [newNotification, ...notifications].slice(0, maxNotifications);
        set({ notifications: updated });
      },

      markAsRead: (id) => {
        set((state) => ({
          notifications: state.notifications.map((n) =>
            n.id === id ? { ...n, read: true } : n
          ),
        }));
      },

      markAllAsRead: () => {
        set((state) => ({
          notifications: state.notifications.map((n) => ({ ...n, read: true })),
        }));
      },

      removeNotification: (id) => {
        set((state) => ({
          notifications: state.notifications.filter((n) => n.id !== id),
        }));
      },

      clearAll: () => {
        set({ notifications: [] });
      },

      setShowPopups: (show) => {
        set({ showPopups: show });
      },

      setHideEmptyJobs: (hide) => {
        set({ hideEmptyJobs: hide });
      },
    }),
    {
      name: "mycelia-notifications",
      partialize: (state) => ({
        notifications: state.notifications.slice(0, 50), // Persist only last 50
        showPopups: state.showPopups,
        hideEmptyJobs: state.hideEmptyJobs,
      }),
    }
  )
);

// Selector for unread count
export const selectUnreadCount = (state: NotificationStore) =>
  state.notifications.filter((n) => !n.read).length;
