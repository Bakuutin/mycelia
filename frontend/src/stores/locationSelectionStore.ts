import { create } from "zustand";

interface LocationSelectionState {
  /** Selected location segment id (band click on the Locations track). */
  segmentId: string | null;
  /** Instant the user is asking "where was I?" about. */
  time: Date | null;
  select: (segmentId: string | null, time: Date | null) => void;
  clear: () => void;
}

export const useLocationSelectionStore = create<LocationSelectionState>((
  set,
) => ({
  segmentId: null,
  time: null,
  select: (segmentId, time) => set({ segmentId, time }),
  clear: () => set({ segmentId: null, time: null }),
}));
