import React, { useEffect } from "react";
import { useFetcher } from "@remix-run/react";
import { create } from "zustand";
import _ from "lodash";

export interface Chunk {
  start: Date;
  buffer: AudioBuffer;
  _id: string;
}

export interface DateStore {
  isPlaying: boolean;
  currentDate: Date | null;
  startDate: Date | null;
  chunks: Chunk[];
  currentChunk: Chunk | null;
  volume: number;
  audioContext: AudioContext | null;
  sourceNode: AudioBufferSourceNode | null;
  gainNode: GainNode | null;
  isCreatingSource: boolean;
  rafId: number | null;
  baselineStartDate: Date | null;
  baselineStartCtxTime: number | null;
  setIsPlaying: (isPlaying: boolean) => void;
  toggleIsPlaying: () => void;
  updateDate: (date: Date) => void;
  resetDate: (date: Date | null) => void;
  appendChunks: (chunks: Chunk[]) => void;
  popChunk: () => Promise<Chunk | null>;
  setVolume: (volume: number) => void;
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

export const useDateStore = create<DateStore>((set) => ({
  currentDate: null,
  startDate: null,
  chunks: [],
  currentChunk: null,
  isPlaying: false,
  volume: 1,
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
    set({ currentDate: date, chunks: [], startDate: date, currentChunk: null });
  },
  appendChunks(chunks: Chunk[]) {
    console.log("Appending chunks", chunks.map((chunk) => chunk.start));
    set((state) => {
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
  setSourceNode: (node: AudioBufferSourceNode | null) => set({ sourceNode: node }),
  setGainNode: (node: GainNode | null) => set({ gainNode: node }),
  setIsCreatingSource: (isCreating: boolean) => set({ isCreatingSource: isCreating }),
  setRafId: (id: number | null) => set({ rafId: id }),
  setBaselines: (date: Date, ctxTime: number) => set({ baselineStartDate: date, baselineStartCtxTime: ctxTime }),
  clearBaselines: () => set({ baselineStartDate: null, baselineStartCtxTime: null }),
  update(
    data: Partial<DateStore> | ((state: DateStore) => Partial<DateStore>),
  ) {
    set(data);
  },
  setVolume: (volume: number) => set({ volume }),
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
    audioContext,
    setAudioContext,
    sourceNode,
    setSourceNode,
    gainNode,
    setGainNode,
    isCreatingSource,
    setIsCreatingSource,
    rafId,
    setRafId,
    baselineStartDate,
    baselineStartCtxTime,
  } = useDateStore();
  const fetcher = useFetcher();
  const preloadLimit = 20; // Number of segments to preload

  const ensureAudioContext = () => {
    if (!audioContext) {
      const newAudioContext =
        new (globalThis.AudioContext || (window as any).webkitAudioContext)();
      setAudioContext(newAudioContext);
    }
  };

  const {
    isPlaying,
    volume,
    currentDate,
    updateDate,
    appendChunks,
    chunks,
    popChunk,
    startDate,
  } = useDateStore();

  if (isPlaying) {
    ensureAudioContext();
  }

  const fetchAndDecodeBuffers = async () => {
    if (fetcher.state !== "idle") return;
    const prev = chunks[chunks.length - 1];
    const start = prev ? prev.start : currentDate;
    if (!start) return;

    const lastId = prev ? prev._id : null;
    fetcher.load(
      `/data/audio?start=${start.toISOString()}&limit=${preloadLimit}${
        lastId ? `&lastId=${lastId}` : ""
      }`,
    );
  };

  useEffect(() => {
    if (
      fetcher.data &&
      Array.isArray((fetcher.data as { segments: any[] }).segments)
    ) {
      const segments: any[] = (fetcher.data as { segments: any[] }).segments;

      for (const segment of segments) {
        audioContext!.decodeAudioData(base64ToArrayBuffer(segment.data)).then(
          (audioBuffer) => {
            appendChunks([{
              buffer: audioBuffer,
              start: new Date(segment.start),
              _id: segment._id,
            }]);
          },
        );
      }
    }
  }, [fetcher.data]);

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

  const createBufferSource = async () => {
    if (
      !audioContext || chunks.length === 0 || isCreatingSource
    ) return;

    setIsCreatingSource(true);

    const bufferSource = audioContext.createBufferSource();
    setSourceNode(bufferSource);

    const chunk = await popChunk();
    if (!chunk) {
      setIsCreatingSource(false);
      return;
    }
    console.log("Playing", chunk.start.toISOString());
    bufferSource.buffer = chunk.buffer;
    bufferSource.connect(gainNode!);

    const when = audioContext.currentTime;
    bufferSource.start(when);

    useDateStore.getState().setBaselines(chunk.start, when);
    updateDate(chunk.start);

    bufferSource.onended = () => {
      setSourceNode(null);
      setIsCreatingSource(false);
    };

    setIsCreatingSource(false);
  };

  useEffect(() => {
    if (sourceNode) {
      sourceNode.stop();
      setSourceNode(null);
    }
  }, [startDate]);

  useEffect(() => {
    if (!audioContext) return;

    if (isPlaying && chunks.length && !sourceNode) {
      createBufferSource();
    }

    if (!isPlaying && sourceNode) {
      sourceNode.stop();
      setSourceNode(null);
    }
  }, [isPlaying, chunks, sourceNode, audioContext]);

  useEffect(() => {
    if (isPlaying && chunks.length < 3) {
      fetchAndDecodeBuffers();
    }
  }, [isPlaying, chunks]);

  useEffect(() => {
    if (!audioContext) return;

    let frameId: number | null = null;

    if (!isPlaying) {
      if (frameId) cancelAnimationFrame(frameId);
      return;
    }

    const tick = () => {
      const { baselineStartDate, baselineStartCtxTime } = useDateStore.getState();
      if (baselineStartDate && baselineStartCtxTime !== null) {
        const elapsed = audioContext.currentTime - baselineStartCtxTime;
        const newDate = new Date(baselineStartDate.getTime() + elapsed * 1000);
        updateDate(newDate);
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
