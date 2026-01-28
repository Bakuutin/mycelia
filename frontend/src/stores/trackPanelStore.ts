import { create } from "zustand";
import { persist } from "zustand/middleware";

interface TrackPanelState {
  isOpen: boolean;
  toggle: () => void;
  setOpen: (open: boolean) => void;
}

export const useTrackPanelStore = create<TrackPanelState>()(
  persist(
    (set) => ({
      isOpen: false,
      toggle: () => set((state) => ({ isOpen: !state.isOpen })),
      setOpen: (open) => set({ isOpen: open }),
    }),
    {
      name: "track-panel",
    }
  )
);
