import React, { useEffect, useRef } from "react";
import { create } from "zustand";
import _ from "lodash";
import { apiClient } from "@/lib/api.ts";
import { useSettingsStore } from "@/stores/settingsStore.ts";

export interface Chunk {
  start: Date;
  buffer: AudioBuffer;
  _id: string;
}

export interface DateStore {
  isPlaying: boolean;
  currentDate: Date | null;
  startDate: Date | null;
  seekTarget: Date | null;
  seekGeneration: number;
  chunks: Chunk[];
  currentChunk: Chunk | null;
  audioContext: AudioContext | null;
  sourceNode: AudioBufferSourceNode | null;
  gainNode: GainNode | null;
  isCreatingSource: boolean;
  rafId: number | null;
  baselineStartDate: Date | null;
  baselineStartCtxTime: number | null;
  /** Filter playback to a specific audio source (original_id). null = auto/any */
  originalId: string | null;
  setOriginalId: (id: string | null) => void;
  setIsPlaying: (isPlaying: boolean) => void;
  toggleIsPlaying: () => void;
  updateDate: (date: Date) => void;
  resetDate: (date: Date | null) => void;
  appendChunks: (chunks: Chunk[], generation: number) => void;
  popChunk: () => Promise<Chunk | null>;
  setAudioContext: (ctx: AudioContext | null) => void;
  setSourceNode: (node: AudioBufferSourceNode | null) => void;
  setGainNode: (node: GainNode | null) => void;
  setIsCreatingSource: (isCreating: boolean) => void;
  setRafId: (id: number | null) => void;
  setBaselines: (date: Date, ctxTime: number) => void;
  clearBaselines: () => void;
  update: (
    data: Partial<DateStore> | ((state: DateStore) => Partial<DateStore>),
  ) => void;
}

export const useAudioPlayer = create<DateStore>((set) => ({
  currentDate: null,
  startDate: null,
  seekTarget: null,
  seekGeneration: 0,
  originalId: null,
  setOriginalId: (id: string | null) => set({ originalId: id }),
  chunks: [],
  currentChunk: null,
  isPlaying: false,
  audioContext: null,
  sourceNode: null,
  gainNode: null,
  isCreatingSource: false,
  rafId: null,
  baselineStartDate: null,
  baselineStartCtxTime: null,
  setIsPlaying: (isPlaying: boolean) => set({ isPlaying }),
  toggleIsPlaying: () => set((state) => ({ isPlaying: !state.isPlaying })),
  updateDate: (date: Date) => set({ currentDate: date }),
  resetDate(date: Date | null) {
    const state = useAudioPlayer.getState();

    if (state.sourceNode) {
      try {
        state.sourceNode.onended = null; // Prevent async callback
        state.sourceNode.stop();
        state.sourceNode.disconnect();
      } catch (e) {
        // Ignore errors if already stopped
      }
    }

    if (state.rafId !== null) {
      cancelAnimationFrame(state.rafId);
    }

    set({
      currentDate: date,
      chunks: [],
      startDate: date,
      seekTarget: date,
      seekGeneration: state.seekGeneration + 1,
      currentChunk: null,
      baselineStartDate: null,
      baselineStartCtxTime: null,
      sourceNode: null,
      rafId: null,
      isCreatingSource: false,
    });
  },
  appendChunks(chunks: Chunk[], generation: number) {
    set((state) => {
      if (generation !== state.seekGeneration) {
        return {};
      }
      const combined = [...state.chunks, ...chunks];
      combined.sort((a, b) => a.start.getTime() - b.start.getTime());
      return { chunks: combined };
    });
  },
  popChunk() {
    return new Promise<Chunk | null>((resolve) => {
      set((state) => {
        if (state.chunks.length === 0) {
          resolve(null);
          return { currentChunk: null, chunks: [] };
        }
        const [first, ...rest] = state.chunks;
        resolve(first);
        return { chunks: rest, currentChunk: first };
      });
    });
  },
  setAudioContext: (ctx: AudioContext | null) => set({ audioContext: ctx }),
  setSourceNode: (node: AudioBufferSourceNode | null) =>
    set({ sourceNode: node }),
  setGainNode: (node: GainNode | null) => set({ gainNode: node }),
  setIsCreatingSource: (isCreating: boolean) =>
    set({ isCreatingSource: isCreating }),
  setRafId: (id: number | null) => set({ rafId: id }),
  setBaselines: (date: Date, ctxTime: number) =>
    set({ baselineStartDate: date, baselineStartCtxTime: ctxTime }),
  clearBaselines: () =>
    set({ baselineStartDate: null, baselineStartCtxTime: null }),
  update(
    data: Partial<DateStore> | ((state: DateStore) => Partial<DateStore>),
  ) {
    set(data);
  },
}));

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binaryString = globalThis.atob(base64);
  const arrayBuffer = new ArrayBuffer(binaryString.length);
  const uint8Array = new Uint8Array(arrayBuffer);

  for (let i = 0; i < binaryString.length; i++) {
    uint8Array[i] = binaryString.charCodeAt(i);
  }

  return arrayBuffer;
}

export const AudioPlayer: React.FC = () => {
  const {
    appendChunks,
    audioContext,
    chunks,
    currentDate,
    gainNode,
    isCreatingSource,
    isPlaying,
    popChunk,
    setAudioContext,
    setBaselines,
    setGainNode,
    setIsCreatingSource,
    setSourceNode,
    sourceNode,
    startDate,
    updateDate,
  } = useAudioPlayer();

  // Get volume and playbackRate from settings store
  const { volume, playbackRate } = useSettingsStore();
  const preloadLimit = 20; // Number of segments to preload

  useEffect(() => {
    if (isPlaying && !audioContext) {
      const newAudioContext =
        new (globalThis.AudioContext || (window as any).webkitAudioContext)();
      setAudioContext(newAudioContext);
    }
  }, [isPlaying, audioContext]);

  const loadingRef = useRef(false)

  const fetchAndDecodeBuffers = async () => {
    if (loadingRef.current) return;
    if (!audioContext) return;

    const currentGeneration = useAudioPlayer.getState().seekGeneration;

    const prev = chunks[chunks.length - 1];
    const start = prev ? prev.start : currentDate;
    if (!start) return;

    try {
      loadingRef.current = true
      const lastId = prev ? prev._id : null;
      const selectedOriginalId = useAudioPlayer.getState().originalId;
      const resp = await apiClient.get(
        `/data/audio?start=${start.getTime()}&limit=${preloadLimit}${
          lastId ? `&lastId=${lastId}` : ""
        }${selectedOriginalId ? `&original_id=${selectedOriginalId}` : ""}`,
      );

      if (useAudioPlayer.getState().seekGeneration !== currentGeneration) {
        return;
      }

      if (
        resp &&
        Array.isArray((resp as { segments: any[] }).segments)
      ) {
        const segments: any[] = (resp as { segments: any[] }).segments;

        for (const segment of segments) {
          audioContext.decodeAudioData(base64ToArrayBuffer(segment.data)).then(
            (audioBuffer) => {
              appendChunks([{
                buffer: audioBuffer,
                start: new Date(segment.start),
                _id: segment._id,
              }], currentGeneration);
            },
          );
        }
      }
    } finally {
      loadingRef.current = false
    }
  };

  useEffect(() => {
    if (audioContext && !gainNode) {
      const newGainNode = audioContext.createGain();
      newGainNode.gain.value = 1; // Default gain value
      newGainNode.connect(audioContext.destination);
      setGainNode(newGainNode);
    }
  }, [audioContext, gainNode]);

  useEffect(() => {
    if (gainNode) {
      gainNode.gain.value = volume;
    }
  }, [volume, gainNode]);

  useEffect(() => {
    if (sourceNode && audioContext && sourceNode.playbackRate.value !== playbackRate) {
      sourceNode.playbackRate.value = playbackRate;
    }
  }, [playbackRate, sourceNode, audioContext]);

  const createBufferSource = async () => {
    // Read isCreatingSource from store (not closure) to prevent race conditions
    // from React StrictMode double-invocation or rapid re-renders
    const storeIsCreating = useAudioPlayer.getState().isCreatingSource;

    if (
      !audioContext || chunks.length === 0 || storeIsCreating
    ) return;

    setIsCreatingSource(true);

    const { seekTarget } = useAudioPlayer.getState();

    let chunk = await popChunk();
    if (!chunk) {
      setIsCreatingSource(false);
      return;
    }

    if (seekTarget) {
      let chunkEndTime = chunk.start.getTime() + (chunk.buffer.duration * 1000);
      while (chunk && seekTarget.getTime() > chunkEndTime) {
        chunk = await popChunk();
        if (!chunk) {
          setIsCreatingSource(false);
          return;
        }
        chunkEndTime = chunk.start.getTime() + (chunk.buffer.duration * 1000);
      }
    }

    const bufferSource = audioContext.createBufferSource();
    setSourceNode(bufferSource);
    bufferSource.buffer = chunk.buffer;
    bufferSource.connect(gainNode!);

    const when = audioContext.currentTime;
    let offset = 0;
    let actualStartDate = chunk.start;

    if (seekTarget && seekTarget.getTime() > chunk.start.getTime()) {
      offset = (seekTarget.getTime() - chunk.start.getTime()) / 1000;
      if (offset < chunk.buffer.duration) {
        actualStartDate = seekTarget;
      }
    }

    bufferSource.start(when, offset);

    useAudioPlayer.getState().setBaselines(actualStartDate, when);
    useAudioPlayer.getState().update({ seekTarget: null });
    updateDate(actualStartDate);

    bufferSource.onended = () => {
      // Only act if this source is still the current one (identity check).
      // If a new source was created or we manually stopped, this is a no-op.
      const currentSrc = useAudioPlayer.getState().sourceNode;
      if (currentSrc === bufferSource) {
        setSourceNode(null);
        setIsCreatingSource(false);
      }
    };
  };

  useEffect(() => {
    if (sourceNode) {
      sourceNode.onended = null; // Prevent async callback
      sourceNode.stop();
      sourceNode.disconnect();
      setSourceNode(null);
      setIsCreatingSource(false);
    }
  }, [startDate]);

  useEffect(() => {
    if (!audioContext) return;

    if (isPlaying && chunks.length && !sourceNode) {
      createBufferSource();
    }

    if (!isPlaying && sourceNode) {
      const state = useAudioPlayer.getState();
      const pausedDate = state.currentDate;
      // Re-insert the currently-playing chunk so resume can seek within it
      // (AudioBuffers are reusable data; only AudioBufferSourceNodes are single-use)
      const reinsertChunks = state.currentChunk
        ? [state.currentChunk, ...state.chunks]
        : [...state.chunks];
      sourceNode.onended = null; // Prevent async callback
      sourceNode.stop();
      sourceNode.disconnect();
      setSourceNode(null);
      setIsCreatingSource(false);
      // Keep chunks intact, set seekTarget so createBufferSource seeks within the right chunk
      useAudioPlayer.getState().update({
        seekTarget: pausedDate,
        chunks: reinsertChunks,
        baselineStartDate: null,
        baselineStartCtxTime: null,
      });
    }
  }, [isPlaying, chunks, sourceNode, audioContext]);

  useEffect(() => {
    if (isPlaying && chunks.length < 3 && audioContext) {
      fetchAndDecodeBuffers();
    }
  }, [isPlaying, chunks, audioContext]);

  useEffect(() => {
    if (!audioContext) return;

    let frameId: number | null = null;
    let lastUpdateTime = 0;
    const UPDATE_INTERVAL = 50; // Update at ~20fps instead of 60fps for performance

    if (!isPlaying) {
      if (frameId) cancelAnimationFrame(frameId);
      return;
    }

    const tick = (timestamp: number) => {
      // Throttle updates to reduce re-renders
      if (timestamp - lastUpdateTime >= UPDATE_INTERVAL) {
        const { baselineStartDate, baselineStartCtxTime } = useAudioPlayer.getState();
        const currentPlaybackRate = useSettingsStore.getState().playbackRate;
        if (baselineStartDate && baselineStartCtxTime !== null) {
          const elapsed = audioContext.currentTime - baselineStartCtxTime;
          const newDate = new Date(baselineStartDate.getTime() + elapsed * currentPlaybackRate * 1000);
          updateDate(newDate);
        }
        lastUpdateTime = timestamp;
      }
      frameId = requestAnimationFrame(tick);
    };

    frameId = requestAnimationFrame(tick);

    return () => {
      if (frameId) cancelAnimationFrame(frameId);
    };
  }, [isPlaying, audioContext]);

  return null;
};
