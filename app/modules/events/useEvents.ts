import { create } from "zustand";
import { z } from "zod";
import { EJSON } from "bson";
import _ from "lodash";
import { useEffect, useMemo } from "react";
import { EventItem } from "@/types/events.ts";
import { useTimelineRange } from "@/stores/timelineRange.ts";

type EventsState = {
  items: EventItem[];
  hoveringId: string | null;
  selectedId: string | null;
  editingEvent: EventItem | null;
  setHovering: (id: string | null) => void;
  setSelected: (id: string | null) => void;
  setEditingEvent: (event: EventItem | null) => void;
  setItems: (items: EventItem[] | ((items: EventItem[]) => EventItem[])) => void;
};

export const useEventsStore = create<EventsState>((set) => ({
  items: [],
  hoveringId: null,
  selectedId: null,
  editingEvent: null,
  filters: undefined,
  setHovering: (id) => set({ hoveringId: id }),
  setSelected: (id) => set({ selectedId: id }),
  setEditingEvent: (event) => set({ editingEvent: event }),
  setFilters: (filters) => set({ filters }),
  setItems: (items) => {
    if (typeof items === "function") {
      set((state) => ({ items: items(state.items) }));
    } else {
      set({ items });
    }
  }
}));

async function fetchEvents(): Promise<EventItem[]> {
  const body = {
    action: "find",
    collection: "events",
    query: {},
    options: { sort: { start: 1 } },
  } as const;

  const res = await fetch("/api/resource/tech.mycelia.mongo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(EJSON.serialize(body)),
  });
  if (!res.ok) return [];
  const docs = EJSON.deserialize(await res.json());
  return (docs as EventItem[]);
}

export function useEvents() {
  const { items, setItems } = useEventsStore();

  useEffect(() => {
    const run = _.debounce(async () => {
      const data = await fetchEvents();
      setItems(data);
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


