import { create } from "zustand";
import _ from "lodash";
import { useEffect, useMemo } from "react";
import { EventItem } from "@/types/events.ts";
import { callResource } from "@/lib/api";
type EventsState = {
  items: EventItem[];
  setItems: (items: EventItem[] | ((items: EventItem[]) => EventItem[])) => void;
};

export const useEventsStore = create<EventsState>((set) => ({
  items: [],
  setItems: (items) => {
    if (typeof items === "function") {
      set((state) => ({ items: items(state.items) }));
    } else {
      set({ items });
    }
  }
}));

async function fetchEvents(): Promise<EventItem[]> {
  return callResource("tech.mycelia.mongo", {
    action: "find",
    collection: "events",
    query: {},
    options: { sort: { start: 1 } },
  });
}

export function useEvents() {
  const { items, setItems } = useEventsStore();

  useEffect(() => {
    const run = _.debounce(async () => {
      setItems(await fetchEvents());
    }, 250);
    run();
    return () => run.cancel();
  }, []);

  const byParent = useMemo(() => {
    const groups = new Map<string | undefined, EventItem[]>();
    for (const item of items) {
      const key = item.parentId;
      const arr = groups.get(key) ?? [];
      arr.push(item);
      groups.set(key, arr);
    }
    return groups;
  }, [items]);

  return { items, byParent };
}


