import { create } from "zustand";
import type { Object } from "@/types/objects";

interface SpanningObjectsStore {
  spanningObjects: Object[];
  ongoingObjects: Object[];
  setSpanningObjects: (objects: Object[]) => void;
  setOngoingObjects: (objects: Object[]) => void;
  clear: () => void;
}

export const useSpanningObjectsStore = create<SpanningObjectsStore>((set) => ({
  spanningObjects: [],
  ongoingObjects: [],
  setSpanningObjects: (objects) => set({ spanningObjects: objects }),
  setOngoingObjects: (objects) => set({ ongoingObjects: objects }),
  clear: () => set({ spanningObjects: [], ongoingObjects: [] }),
}));
