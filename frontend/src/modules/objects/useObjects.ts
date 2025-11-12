import { useEffect } from "react";
import { create } from "zustand";
import { Object } from "@/types/objects.ts";
import { callResource } from "@/lib/api";

type ObjectsState = {
  objects: Object[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  fetchInitial: () => Promise<void>;
};

export const useObjectsStore = create<ObjectsState>((set, get) => ({
  objects: [],
  loading: false,
  error: null,
  refresh: async () => {
    try {
      set({ loading: true, error: null });
      const objects = await fetchObjects();
      set({ objects });
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Failed to fetch objects';
      console.error('Failed to fetch objects:', err);
      set({ error });
    } finally {
      set({loading: false});
    }
  },
  fetchInitial: async () => {
    const state = get();
    if (state.loading || state.objects.length > 0) return;
    set({ loading: true, error: null });
    try {
      const objects = await fetchObjects();
      set({ objects });
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Failed to fetch objects';
      console.error('Failed to fetch objects:', err);
      set({ error });
    } finally {
      set({loading: false});
    }
  }
}));

async function fetchObjects(): Promise<Object[]> {
  return callResource("tech.mycelia.objects", {
    action: "list",
    options: {
      hasTimeRanges: true,
      includeRelationships: true,
      sort: { earliestStart: -1, duration: -1 },
    },
  });
}

export function useObjects() {
  const { objects, loading, error } = useObjectsStore();
  const refresh = useObjectsStore((state) => state.refresh);
  const fetchInitial = useObjectsStore((state) => state.fetchInitial);

  useEffect(() => {
    fetchInitial();
  }, [fetchInitial]);

  return { objects, refresh, loading, error };
}
