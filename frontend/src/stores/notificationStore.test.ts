import { beforeEach, describe, expect, it } from "vitest";

const memory = new Map<string, string>();
const storage = {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => memory.set(key, value),
  removeItem: (key: string) => memory.delete(key),
  clear: () => memory.clear(),
  key: (index: number) => [...memory.keys()][index] ?? null,
  get length() {
    return memory.size;
  },
};
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: storage,
});
Object.defineProperty(window, "localStorage", {
  configurable: true,
  value: storage,
});

const { useNotificationStore } = await import("./notificationStore");

describe("notificationStore", () => {
  beforeEach(() => useNotificationStore.getState().clearAll());

  it("deduplicates terminal chat notifications", () => {
    const notification = {
      type: "success" as const,
      title: "Chat response ready",
      dedupeKey: "chat:run-1:completed",
    };
    useNotificationStore.getState().addNotification(notification);
    useNotificationStore.getState().addNotification(notification);
    expect(useNotificationStore.getState().notifications).toHaveLength(1);
  });
});
