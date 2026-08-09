import { create } from "zustand";
import { useAudioPlayer } from "@/modules/audio/player";

type StopPlayback = () => void;

interface AudioPlaybackCoordinator {
  activeId: string | null;
  activeStop: StopPlayback | null;
  acquire: (id: string, stop: StopPlayback) => void;
  release: (id: string) => void;
  stopActive: () => void;
}

export const useAudioPlaybackStore = create<AudioPlaybackCoordinator>(
  (set, get) => ({
    activeId: null,
    activeStop: null,
    acquire(id, stop) {
      const current = get();
      if (current.activeId !== id) current.activeStop?.();
      useAudioPlayer.getState().setIsPlaying(false);
      set({ activeId: id, activeStop: stop });
    },
    release(id) {
      if (get().activeId === id) {
        set({ activeId: null, activeStop: null });
      }
    },
    stopActive() {
      get().activeStop?.();
      set({ activeId: null, activeStop: null });
    },
  }),
);

useAudioPlayer.subscribe((state, previous) => {
  if (state.isPlaying && !previous.isPlaying) {
    useAudioPlaybackStore.getState().stopActive();
  }
});
